"""Búsqueda densa (pgvector, coseno), léxica (tsvector en castellano) e híbrida con RRF.

Las dos vías comparten una sola función de filtros: versiones `lista`, la configuración
del índice pedida (la activa por defecto), tipos de fuente y tema (el tema N y lo que
no tiene tema). Lo que viaja son ids y rangos; el texto se hidrata al final, en una
consulta, conservando el orden de la fusión.
"""

import asyncio
import math
import re
import time
from dataclasses import replace

from sqlalchemy import text

from magister.cerebro.contratos import Consulta, Filtros, Recuperado, ResultadoBusqueda
from magister.datos import repositorio_fuentes as rf
from magister.datos.fuentes import Busqueda
from magister.datos.sesion import nueva_sesion
from magister.config import ajustes
from magister.fuentes import duplicados as dup
from magister.fuentes.embeber import embeber, modelo_listo
from magister.fuentes.fusion import rrf
from magister.fuentes.reranker import reordenar


def _filtros_sql(filtros: Filtros | None) -> tuple[str, dict]:
    condiciones = ["v.estado = 'lista'", "f.config_id = :config_id"]
    valores: dict = {}
    if filtros and filtros.tema_id is not None:
        condiciones.append("(d.tema_id = :tema_id or d.tema_id is null)")
        valores["tema_id"] = filtros.tema_id
    if filtros and filtros.fuente_tipos:
        condiciones.append("fu.tipo = any(:tipos)")
        valores["tipos"] = list(filtros.fuente_tipos)
    if filtros and filtros.version_ids is not None:
        condiciones.append("v.id = any(:version_ids)")
        valores["version_ids"] = list(filtros.version_ids)
    # Una copia marcada como duplicada no ocupa hueco en el top-k.
    condiciones.append("v.duplicado_de is null")
    return " and ".join(condiciones), valores


DESDE = """from fragmentos f
  join versiones v on v.id = f.version_id
  join documentos d on d.id = v.documento_id
  join fuentes fu on fu.id = d.fuente_id"""


def _vector(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


async def _config(indice: str | None) -> tuple[int, dict]:
    async with nueva_sesion() as s:
        c = await rf.configuracion(s, indice)
        if c is None:
            raise ValueError(f"no existe la configuración del índice {indice or '(activa)'}")
        return c.id, c.params


async def buscar_densa(consulta: str, k: int, filtros: Filtros | None, indice: str | None = None) -> list[tuple[int, float]]:
    config_id, params = await _config(indice)
    vec = (await asyncio.to_thread(embeber, [consulta], "consulta", params))[0]
    donde, valores = _filtros_sql(filtros)
    sql = text(
        f"select f.id, 1 - (f.embedding <=> cast(:v as vector)) as p {DESDE} "
        f"where {donde} and f.embedding is not null order by f.embedding <=> cast(:v as vector) limit :k"
    )
    async with nueva_sesion() as s:
        filas = (await s.execute(sql, {**valores, "v": _vector(vec), "k": k, "config_id": config_id})).all()
    return [(int(i), float(p)) for i, p in filas]


_NEGADA = re.compile(r"(?<!\S)-[^\W_]")


def consulta_o(consulta: str) -> str:
    """Las palabras de la consulta unidas con OR, para `to_tsquery`. Solo letras y cifras: nada que la sintaxis de
    tsquery pueda leer como operador. Vacío si la consulta excluye palabras («-mitosis»): entonces solo vale el AND."""
    if _NEGADA.search(consulta):
        return ""
    palabras = [p for p in re.findall(r"[^\W_]+", consulta) if p.lower() != "or"]
    return " | ".join(dict.fromkeys(palabras))


async def buscar_lexica_completa(
    consulta: str, k: int, filtros: Filtros | None, indice: str | None = None,
) -> tuple[list[tuple[int, float]], set[int]]:
    """(pares, los que tienen todas las palabras). Primero los que tienen todas (el AND de `websearch_to_tsquery`) y
    después los que tienen alguna (OR), por `ts_rank_cd`. Antes solo el AND: una pregunta larga («¿qué es el complejo
    sinaptonémico y en qué subfase aparecen los quiasmas?») exigía las cinco palabras en un fragmento y la vía léxica
    salía vacía aunque tus apuntes dijeran «los quiasmas se ven en el diploteno»."""
    config_id, _ = await _config(indice)
    donde, valores = _filtros_sql(filtros)
    o = consulta_o(consulta)
    if o:
        sql = text(
            f"select f.id, ts_rank_cd(f.lexico, qo, 1) as p, f.lexico @@ qa as completo {DESDE}, "
            f"websearch_to_tsquery('spanish', :q) qa, to_tsquery('spanish', :qo) qo "
            f"where {donde} and (f.lexico @@ qa or f.lexico @@ qo) order by completo desc, p desc, f.id limit :k"
        )
    else:
        sql = text(
            f"select f.id, ts_rank_cd(f.lexico, qa, 1) as p, true as completo {DESDE}, websearch_to_tsquery('spanish', :q) qa "
            f"where {donde} and f.lexico @@ qa order by p desc, f.id limit :k"
        )
    async with nueva_sesion() as s:
        filas = (await s.execute(sql, {**valores, "q": consulta, "qo": o, "k": k, "config_id": config_id})).all()
    return [(int(i), float(p)) for i, p, _ in filas], {int(i) for i, _, c in filas if c}


async def buscar_lexica(consulta: str, k: int, filtros: Filtros | None, indice: str | None = None) -> list[tuple[int, float]]:
    return (await buscar_lexica_completa(consulta, k, filtros, indice))[0]


async def hidratar(pares: list[tuple[int, float]]) -> list[Recuperado]:
    if not pares:
        return []
    sql = text(
        f"select f.id, f.texto, d.titulo, d.uri, fu.tipo, v.id {DESDE} where f.id = any(:ids)"
    )
    async with nueva_sesion() as s:
        filas = {r[0]: r for r in (await s.execute(sql, {"ids": [i for i, _ in pares]})).all()}
    salida = []
    for n, (fid, p) in enumerate(pares, start=1):
        if fid in filas:
            _, texto, titulo, uri, tipo, vid = filas[fid]
            salida.append(Recuperado(fid, n, p, texto, titulo, uri, tipo, vid))
    return salida


async def _esperar_modelo(nombre: str | None) -> bool:
    """True si el modelo de embeddings está (o llega en `espera_embeddings_s`); el calentamiento del arranque lo carga."""
    limite = time.perf_counter() + ajustes.espera_embeddings_s
    while not modelo_listo(nombre):
        if time.perf_counter() >= limite:
            return False
        await asyncio.sleep(0.25)
    return True


def _colapsar(recuperados: list[Recuperado]) -> list[Recuperado]:
    """Fuera las copias (casi) iguales de un fragmento mejor colocado (`duplicados.colapsar`), con los rangos de nuevo
    de 1 a n. Así un fichero de relleno aporta un fragmento, no ocho, al chat y al apoyo de una lección."""
    quedan = dup.colapsar([r.texto for r in recuperados])
    return [replace(recuperados[i], rango=n) for n, i in enumerate(quedan, start=1)]


def _como_recuperados(pares: list[tuple[int, float]]) -> list[Recuperado]:
    return [Recuperado(fid, n, p, "", "", "", "", 0) for n, (fid, p) in enumerate(pares, start=1)]


class BuscadorHibrido:
    """Cumple `cerebro.contratos.Buscador`. Deja una traza en `busquedas` en cada llamada."""

    _params: dict | None = None  # los de la configuración de la última búsqueda (para `similitud_frases`)

    async def buscar(
        self,
        consulta: str,
        k: int,
        filtros: Filtros | None = None,
        params: Consulta | None = None,
        consulta_original: str | None = None,
    ) -> ResultadoBusqueda:
        params = params or Consulta()
        t0 = time.perf_counter()
        config_id, config_params = await _config(params.indice)
        densa: list[tuple[int, float]] = []
        lexica: list[tuple[int, float]] = []
        completos: set[int] | None = None
        n = max(params.n_candidatos, k)
        via = params.via
        # Recién arrancado, e5 aún se está cargando: la híbrida no espera más de unos segundos y, si no está, va
        # solo por palabras (la densa sola, la de las evals, sí espera).
        if via == "hibrida" and not await _esperar_modelo(config_params.get("modelo")):
            via = "lexica"
        # Las dos vías no dependen una de otra: a la vez.
        if via == "hibrida":
            densa, (lexica, completos) = await asyncio.gather(buscar_densa(consulta, n, filtros, params.indice),
                                                              buscar_lexica_completa(consulta, n, filtros, params.indice))
        elif via == "densa":
            densa = await buscar_densa(consulta, n, filtros, params.indice)
        else:
            lexica, completos = await buscar_lexica_completa(consulta, n, filtros, params.indice)
        if via == "hibrida":
            fusion = rrf(_como_recuperados(densa), _como_recuperados(lexica))
            pares = [(r.fragmento_id, r.puntuacion) for r in fusion]
        else:
            pares = densa or lexica
        rerank: list[Recuperado] | None = None
        ms_reranker = None
        puntos_reranker: dict[int, float] = {}
        if params.reranker and pares:
            candidatos = await hidratar(pares[: params.n_candidatos])
            if params.colapsar_duplicados:
                candidatos = _colapsar(candidatos)
            t1 = time.perf_counter()
            rerank = await asyncio.to_thread(reordenar, consulta, candidatos)
            ms_reranker = int((time.perf_counter() - t1) * 1000)
            recuperados = rerank[:k]
            puntos_reranker = {r.fragmento_id: r.puntuacion for r in rerank}
        elif params.colapsar_duplicados:
            # Se hidratan los candidatos, no solo k: si hay copias, el hueco lo ocupa el siguiente distinto.
            recuperados = _colapsar(await hidratar(pares[:n]))[:k]
        else:
            recuperados = await hidratar(pares[:k])
        if not params.reranker:
            # Pregunta en español y fuente en inglés: el coseno de e5 se queda en 0,78-0,85 aunque la sección conteste.
            # Solo entonces, el reranker (multilingüe) puntúa estos k: es la segunda puerta de «hay fuentes» (ADR-0018).
            # El apoyo de las lecciones lo pide siempre (`puntuar_reranker`): cuenta fragmento a fragmento.
            mejor = ResultadoBusqueda(recuperados, None, dict(densa), via, lexica_completa=completos).mejor_similitud
            if recuperados and (params.puntuar_reranker or mejor < ajustes.umbral_fuentes):
                t1 = time.perf_counter()
                puntos_reranker = {r.fragmento_id: r.puntuacion for r in await asyncio.to_thread(reordenar, consulta, recuperados)}
                ms_reranker = int((time.perf_counter() - t1) * 1000)
        self._params = config_params
        ms = int((time.perf_counter() - t0) * 1000)
        async with nueva_sesion() as s, s.begin():
            b = Busqueda(
                consulta=consulta_original or consulta,
                consulta_reescrita=consulta if consulta_original and consulta_original != consulta else None,
                config_id=config_id,
                via=via,
                densa=[[i, n + 1] for n, (i, _) in enumerate(densa)],
                lexica=[[i, n + 1] for n, (i, _) in enumerate(lexica)],
                fusion=[[i, n + 1] for n, (i, _) in enumerate(pares[:k])],
                reranker=[[r.fragmento_id, r.rango] for r in rerank] if rerank is not None else None,
                ms=ms,
                ms_reranker=ms_reranker,
            )
            s.add(b)
            await s.flush()
            busqueda_id = b.id
        return ResultadoBusqueda(recuperados, busqueda_id, dict(densa), via, puntos_reranker, completos)

    def similitud_frases(self, afirmacion: str, frases: list[str]) -> list[float]:
        """Coseno de e5 entre una afirmación y cada frase, para comprobar citas entre idiomas (cerebro.citas). Usa el
        modelo y el prefijo de consulta de la última búsqueda, el mismo para los dos lados. Si el modelo aún no está
        cargado, [] (y las citas se comprueban solo por palabras). Es CPU: llámala en un hilo."""
        params = self._params or {}
        if not frases or not modelo_listo(params.get("modelo")):
            return []
        vectores = embeber([afirmacion, *frases], "consulta", params)
        norma = [math.sqrt(sum(x * x for x in v)) or 1.0 for v in vectores]
        a = vectores[0]
        return [sum(x * y for x, y in zip(a, v, strict=True)) / (norma[0] * n) for v, n in zip(vectores[1:], norma[1:], strict=True)]

    async def indice_fuentes(self, tema_id: int | None, max_caracteres: int = 6000) -> str:
        """Títulos de documento y encabezados del tema, para orientar al planificador."""
        donde = "v.estado = 'lista'" + (" and d.tema_id = :tema" if tema_id is not None else "")
        sql = text(
            f"select d.titulo, v.texto from versiones v join documentos d on d.id = v.documento_id "
            f"where {donde} order by d.titulo limit 60"
        )
        async with nueva_sesion() as s:
            filas = (await s.execute(sql, {"tema": tema_id} if tema_id is not None else {})).all()
        lineas: list[str] = []
        for titulo, texto in filas:
            lineas.append(f"- {titulo}")
            for linea in (texto or "").splitlines():
                if linea.startswith(("# ", "## ")):
                    lineas.append(f"  {linea.strip()}")
        salida = "\n".join(lineas)
        return salida[:max_caracteres]
