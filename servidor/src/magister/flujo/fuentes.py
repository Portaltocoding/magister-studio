"""Lo que el plan sabe de las fuentes: el índice para planificar y el apoyo por lección.

El `Buscador` llega inyectado; `flujo` no importa `magister.fuentes`.
"""

from magister.cerebro.contratos import Buscador, Consulta, Filtros
from magister.config import ajustes
from magister.datos import conversaciones as dc
from magister.datos import plan as dp
from magister.datos import repositorio_fuentes as rf
from magister.datos.sesion import nueva_sesion

SIN_FUENTES = "(sin fuentes del alumno sobre este tema)"


async def contexto_para_plan(buscador: Buscador | None, tema: str) -> str:
    if buscador is None or not tema:
        return SIN_FUENTES
    async with nueva_sesion() as s:
        fila = await dc.tema_por_nombre(s, tema)
    if fila is not None:
        indice = await buscador.indice_fuentes(fila.id)
        if indice:
            return indice
    r = await buscador.buscar(tema, 8, Filtros(), None)
    titulos = list(dict.fromkeys(x.documento_titulo for x in r.recuperados if x.documento_titulo))
    escalon = r.escalon(ajustes.umbral_fuentes, ajustes.umbral_reranker)
    if r.busqueda_id is not None:
        try:
            await rf.anotar_escalon(r.busqueda_id, escalon)
        except Exception:  # noqa: BLE001 la traza nunca rompe el plan
            pass
    if not titulos or escalon == "nada":
        return SIN_FUENTES
    return "\n".join(f"- {t}" for t in titulos)


async def calcular_apoyo(buscador: Buscador | None, plan_id: int, tema_id: int | None) -> None:
    """Para cada lección, los fragmentos (de los 8 mejores) que de verdad la apoyan y si queda «sin material».
    Solo se guardan los que pasan la puerta: lo demás no llega a los apuntes ni al corrector como «tus fuentes».
    Lo que el research trajo para la lección (anclado por `propuestas`) entra siempre, por objetivo y antes que lo demás."""
    if buscador is None:
        return
    async with nueva_sesion() as s:
        lecciones = await dp.lecciones(s, plan_id)
        anclados = {lec.clave: await rf.versiones_de_leccion(s, plan_id, lec.clave) for lec in lecciones}
    for lec in lecciones:
        consulta = f"{lec.titulo}. " + " ".join(lec.objetivos)
        # El reranker puntúa siempre los 8: aunque uno llegue al coseno, cuenta cuántos apoyan (ADR-0018).
        r = await buscador.buscar(consulta, 8, Filtros(tema_id=tema_id), Consulta(puntuar_reranker=True))
        # Un fragmento apoya si su coseno llega o si el reranker lo puntúa por encima de su umbral (lección en
        # español, fuente en inglés).
        buenos = [
            (x.fragmento_id, x.rango, x.puntuacion)
            for x in r.recuperados
            if r.similitud_densa.get(x.fragmento_id, x.puntuacion) >= ajustes.umbral_apoyo
            or r.puntuacion_reranker.get(x.fragmento_id, float("-inf")) > ajustes.umbral_reranker
        ]
        # Lo que el research trajo para esta lección la apoya aunque esté en otro idioma: lo eligió el juez para ella.
        # Una búsqueda por objetivo dentro de esas versiones, sin umbral, y los 2 mejores de cada uno.
        por_objetivo: list[list[tuple[int, int, float]]] = []
        textos = {x.fragmento_id: x.texto for x in r.recuperados}
        if anclados.get(lec.clave):
            filtro = Filtros(version_ids=anclados[lec.clave])
            for objetivo in lec.objetivos or [lec.titulo]:
                ra = await buscador.buscar(objetivo, ajustes.apoyo_por_objetivo + 1, filtro, None)
                por_objetivo.append([(x.fragmento_id, x.rango, x.puntuacion) for x in ra.recuperados])
                textos.update({x.fragmento_id: x.texto for x in ra.recuperados})
        elegidos = juntar_apoyo(por_objetivo, buenos, textos=textos)
        await rf.guardar_apoyo(plan_id, lec.clave, elegidos, len(elegidos) < ajustes.min_apoyo)


def juntar_apoyo(
    por_objetivo: list[list[tuple[int, int, float]]], buenos: list[tuple[int, int, float]], tope: int | None = None,
    cuantos: int | None = None, textos: dict[int, str] | None = None,
) -> list[tuple[int, int, float]]:
    """Primero los anclados, por turnos entre objetivos (hasta `cuantos` de cada uno, MAGISTER_APOYO_POR_OBJETIVO, sin
    repetir); luego los que pasan la puerta, hasta `tope` en total (MAGISTER_APOYO_TOPE: que un solo objetivo no llene
    los apuntes). Cada fragmento lleva su nuevo rango (1..n), que es el orden en que llega a los apuntes."""
    tope = ajustes.apoyo_tope if tope is None else tope
    cuantos = ajustes.apoyo_por_objetivo if cuantos is None else cuantos
    vistos: set[int] = set()
    salida: list[tuple[int, float]] = []
    aceptados: list[str] = []  # los textos de lo que ya entró (los que se conocen)

    def entra(fid: int) -> bool:
        """Ni el mismo id ni, con `textos`, una casi copia de lo que ya entró (dos búsquedas distintas pueden traer
        trozos casi iguales de dos versiones de un mismo documento: contaban dos veces)."""
        if fid in vistos:
            return False
        vistos.add(fid)
        texto = (textos or {}).get(fid)
        if texto:
            # Excepción a «flujo no importa de fuentes»: `colapsar` es puro (sin base, red ni modelo) y se importa aquí,
            # dentro de la función, para no duplicar el criterio de casi copia del índice.
            from magister.fuentes.duplicados import colapsar

            if aceptados and colapsar([*aceptados, texto])[-1] != len(aceptados):
                return False
            aceptados.append(texto)
        return True

    colas = [list(c) for c in por_objetivo]
    tomados = [0] * len(colas)
    for _ in range(cuantos):
        for i, cola in enumerate(colas):
            while cola and tomados[i] < cuantos:
                fid, _, p = cola.pop(0)
                if entra(fid):
                    salida.append((fid, p))
                    tomados[i] += 1
                    break
    for fid, _, p in buenos:
        if entra(fid):
            salida.append((fid, p))
    return [(fid, n, p) for n, (fid, p) in enumerate(salida[:tope], start=1)]


async def recalcular_apoyo_por_versiones(buscador: Buscador | None, version_ids: list[int]) -> None:
    """Cuando versiones pasan a `lista`, se recalcula (una vez) el apoyo de los planes de sus temas.
    Una versión sin tema (el vault) puede apoyar a cualquier plan."""
    async with nueva_sesion() as s:
        temas = {await rf.tema_de_version(s, v) for v in version_ids}
        planes = await dp.planes_aceptados(s)
    for fila, _ in planes:
        if None in temas or fila.tema_id in temas:
            await calcular_apoyo(buscador, fila.id, fila.tema_id)
