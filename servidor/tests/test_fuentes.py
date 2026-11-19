from pathlib import Path

import pymupdf
import pytest

from magister.cerebro.contratos import Consulta, Filtros
from magister.datos import repositorio_fuentes as rf
from magister.datos.sesion import nueva_sesion
from magister.fuentes import duplicados as dup
from magister.fuentes import ingesta
from magister.fuentes.buscar import BuscadorHibrido
from magister.fuentes.extraer import extraer
from magister.fuentes.fusion import rrf
from magister.fuentes.trocear import trocear
from magister.fuentes.validar import validar

DATOS = Path(__file__).parent / "datos"


def pdf(ruta: Path, texto: str | None) -> Path:
    doc = pymupdf.open()
    pagina = doc.new_page()
    if texto:
        pagina.insert_textbox(pymupdf.Rect(50, 50, 550, 800), texto, fontsize=11)
    doc.save(ruta)
    return ruta


# Extraer y validar (sin base)


def test_markdown_frontmatter_y_enlaces() -> None:
    e = extraer(str(DATOS / "indices.md"))
    assert e.titulo == "Índices en Postgres"
    assert "tags" not in e.texto and e.metadatos["tags"]
    assert "las transacciones" in e.texto and "[[" not in e.texto


def test_html_con_trafilatura() -> None:
    e = extraer(str(DATOS / "transacciones.html"))
    assert "atomicidad" in e.texto and e.extractor.startswith("trafilatura")


def test_pdf_y_escaneado_a_cuarentena(tmp_path) -> None:
    bueno = extraer(str(pdf(tmp_path / "bueno.pdf", "Una clave primaria identifica cada fila de una tabla. " * 6)))
    assert bueno.extractor.startswith("pymupdf") and not validar(bueno)
    vacio = extraer(str(pdf(tmp_path / "vacio.pdf", None)))
    problemas = validar(vacio)
    assert problemas and problemas[0].codigo == "sin_contenido"


def test_normalizar_y_hash() -> None:
    a = dup.normalizar("Las tran-\nsacciones   son\n\n\n\nútiles")
    assert a == "Las transacciones son\n\nútiles"
    assert dup.hash_texto(a) == dup.hash_texto(a + "\n")


def test_trocear_invariante() -> None:
    for nombre in ("indices.md", "transacciones.html"):
        e = extraer(str(DATOS / nombre))
        texto = dup.normalizar(e.texto)
        trozos = trocear(texto, e.titulo, "pdf", {"tokens": 40, "solape": 8})
        assert len(trozos) > 1
        for t in trozos:
            assert texto[t.inicio : t.fin] == t.texto
            assert t.texto_indexado.endswith(t.texto)


def test_trocear_seccion_larga_que_acaba_en_salto() -> None:
    # Antes, el único «\n\n» caía al final del tramo, el tramo no se partía y la recursión no acababa.
    texto = "## A\n" + "palabra " * 60 + "\n\n## B\nhola"
    trozos = trocear(texto, "Doc", "pdf", {"tokens": 40, "solape": 8})
    assert len(trozos) > 2
    for t in trozos:
        assert texto[t.inicio : t.fin] == t.texto
    assert trozos[-1].texto.endswith("hola")


def test_rrf_ejemplo() -> None:
    from magister.cerebro.contratos import Recuperado

    r = lambda i, n: Recuperado(i, n, 0, "", "", "", "", 0)  # noqa: E731
    fusion = rrf([r(1, 1), r(2, 2), r(3, 3)], [r(2, 1), r(3, 2)])
    assert [x.fragmento_id for x in fusion] == [2, 3, 1]
    assert round(fusion[0].puntuacion, 4) == 0.0325


# Ingesta y búsqueda (con la base de pruebas y embeddings falsos)

pytestmark = pytest.mark.anyio


async def crear_fuente(nombre="apuntes", tipo="vault", confianza=3) -> int:
    async with nueva_sesion() as s:
        return (await rf.crear_fuente(s, nombre, tipo, confianza)).id


async def test_ingerir_dos_veces_no_duplica_y_editar_crea_version(base, tmp_path) -> None:
    fid = await crear_fuente()
    copia = tmp_path / "nota.md"
    copia.write_text((DATOS / "indices.md").read_text(encoding="utf-8"), encoding="utf-8")
    r1 = await ingesta.ingerir_ruta(fid, str(tmp_path))
    r2 = await ingesta.ingerir_ruta(fid, str(tmp_path))
    assert [r.salida for r in r1] == ["nueva"] and [r.salida for r in r2] == ["sin_cambios"]
    copia.write_text(copia.read_text(encoding="utf-8") + "\nUna frase nueva sobre índices GIN.", encoding="utf-8")
    r3 = await ingesta.ingerir_ruta(fid, str(tmp_path))
    assert r3[0].salida == "nueva"
    async with nueva_sesion() as s:
        docs = await rf.documentos_de_fuente(s, fid)
        versiones = await rf.versiones_de_documento(s, docs[0][0].id)
    assert [v.estado for v in versiones] == ["retirada", "pendiente"]


async def test_casi_duplicado_entre_fuentes(base, tmp_path) -> None:
    mia = await crear_fuente("apuntes", "pdf", 3)
    web = await crear_fuente("web", "web", 1)
    texto = (DATOS / "indices.md").read_text(encoding="utf-8")
    (tmp_path / "a.md").write_text(texto, encoding="utf-8")
    (tmp_path / "b.md").write_text(texto.replace("sirve para casi todo", "vale para casi todo"), encoding="utf-8")
    [ra] = await ingesta.ingerir_ruta(mia, str(tmp_path / "a.md"))
    [rb] = await ingesta.ingerir_ruta(web, str(tmp_path / "b.md"))
    async with nueva_sesion() as s:
        from magister.datos.fuentes import Version

        vb = await s.get(Version, rb.version_id)
    assert vb.duplicado_de == ra.version_id


async def test_indexar_y_buscar_por_las_tres_vias(base) -> None:
    fid = await crear_fuente()
    await ingesta.ingerir_ruta(fid, str(DATOS))
    assert await ingesta.procesar_pendientes() == 2
    async with nueva_sesion() as s:
        cuenta = await rf.contar(s)
    assert cuenta["versiones_listas"] == 2 and cuenta["fragmentos"] == cuenta["con_vector"] > 0
    b = BuscadorHibrido()
    lex = await b.buscar("ACID", 5, Filtros(), Consulta(via="lexica"))
    assert lex.recuperados and "ACID" in lex.recuperados[0].texto
    # Sin vía densa no hay coseno: el acierto léxico cuenta como «hay fuentes».
    assert lex.via == "lexica" and lex.mejor_similitud == 1.0
    assert (await b.buscar("zxqwv", 5, Filtros(), Consulta(via="lexica"))).recuperados == []
    densa = await b.buscar("índice parcial", 5, Filtros(), Consulta(via="densa"))
    assert len(densa.recuperados) > 0
    assert [r.rango for r in densa.recuperados] == list(range(1, len(densa.recuperados) + 1))
    hib = await b.buscar("índices parciales", 3, Filtros(), Consulta(reranker=True))
    assert hib.busqueda_id and len(hib.recuperados) <= 3
    assert "Índices" in (await b.indice_fuentes(None))


def test_via_lexica_da_fuentes_si_hay_aciertos() -> None:
    from magister.cerebro.contratos import Recuperado, ResultadoBusqueda

    r = Recuperado(1, 1, 0.003, "ACID", "Doc", "doc.md", "pdf", 1)
    assert ResultadoBusqueda([r], None, {}, "lexica").mejor_similitud == 1.0
    assert ResultadoBusqueda([], None, {}, "lexica").mejor_similitud == 0.0
    # La híbrida sigue mirando el coseno de la vía densa.
    assert ResultadoBusqueda([r], None, {1: 0.4}).mejor_similitud == 0.4


async def test_volver_a_subir_el_mismo_fichero_muestra_la_lista(base) -> None:
    fid = await crear_fuente("Adjuntos del chat", "pdf", 3)
    crudo = (DATOS / "indices.md").read_bytes()
    v1 = await ingesta.recibir(fid, crudo, "indices.md", "subida/indices.md", None, "md")
    await ingesta.procesar_pendientes()
    v2 = await ingesta.recibir(fid, crudo, "indices.md", "subida/indices.md", None, "md")
    await ingesta.procesar_pendientes()
    async with nueva_sesion() as s:
        from magister.datos.fuentes import Version

        repetida = await s.get(Version, v2)
        assert (repetida.estado, repetida.motivo) == ("retirada", "sin cambios")
        [(_, v, n)] = await rf.documentos_de_fuente(s, fid)
    assert v.id == v1 and v.estado == "lista" and n > 0


# Bibliografía fuera, segunda puerta con el reranker y la orden de indexar (ADR-0018)


def test_trocear_salta_bibliografia_y_notas() -> None:
    from magister.fuentes.trocear import SECCIONES_FUERA

    texto = (
        "# Delusion\nIntro sobre delirios.\n\n## 1. Theories\nThe two-factor theory explains delusions.\n\n"
        "## Bibliography\nBortolotti, L. 2018. Delusions.\n\n## 4.2 Notas\n1. Una nota al pie.\n\n"
        "### Cómo citar\nCita esto así.\n\n## Véase también\nOtra entrada."
    )
    params = {"tokens": 400, "solape": 0, "secciones_fuera": SECCIONES_FUERA}
    trozos = trocear(texto, "Doc", "web", params)
    assert [t.texto_indexado.split("\n")[0] for t in trozos] == ["Doc > Delusion", "Doc > Delusion > 1. Theories"]
    assert all(texto[t.inicio : t.fin] == t.texto for t in trozos)
    # La configuración que no trae la lista (v1) trocea igual que siempre; el vault no se filtra.
    assert len(trocear(texto, "Doc", "web", {"tokens": 400, "solape": 0})) == 6
    assert len(trocear(texto, "Doc", "vault", {**params, "vault_por_parrafos": False})) == 6
    # Un documento que solo tiene secciones de esas no se queda sin fragmentos.
    solo = "## References\nSmith, J. 2020. A book."
    assert len(trocear(solo, "Doc", "web", params)) == 1
    # Al estilo de Wikipedia: las subsecciones de References también son bibliografía (cualquier encabezado de la ruta).
    wiki = ("# Capgras\nEl delirio de Capgras es creer que un allegado es un impostor.\n\n## References\n"
            "### Citations\n1. Ellis 2001.\n\n### Sources\nYoung, A. 1998.\n\n## Treatment\nTerapia cognitiva.")
    cabeceras = [t.texto_indexado.split("\n")[0] for t in trocear(wiki, "Doc", "web", params)]
    assert cabeceras == ["Doc > Capgras", "Doc > Capgras > Treatment"]


def test_hay_fuentes_por_el_reranker() -> None:
    from magister.cerebro.contratos import Recuperado, ResultadoBusqueda

    r = Recuperado(1, 1, 0.01, "Delusions are beliefs.", "Doc", "u", "web", 1)
    assert not ResultadoBusqueda([r], None, {1: 0.80}).hay_fuentes(0.85, 0.0)
    assert ResultadoBusqueda([r], None, {1: 0.80}, "hibrida", {1: 4.5}).hay_fuentes(0.85, 0.0)
    assert not ResultadoBusqueda([r], None, {1: 0.80}, "hibrida", {1: -3.0}).hay_fuentes(0.85, 0.0)
    assert ResultadoBusqueda([r], None, {1: 0.90}).hay_fuentes(0.85, 0.0)
    assert not ResultadoBusqueda([], None, {}, "hibrida", {1: 9.0}).hay_fuentes(0.85, 0.0)


async def test_el_reranker_solo_corre_si_el_coseno_no_llega(base, monkeypatch) -> None:
    from magister.config import ajustes

    fid = await crear_fuente()
    await ingesta.ingerir_ruta(fid, str(DATOS))
    await ingesta.procesar_pendientes()
    b = BuscadorHibrido()
    monkeypatch.setattr(ajustes, "umbral_fuentes", 0.0)
    assert (await b.buscar("índice parcial", 3, Filtros())).puntuacion_reranker == {}
    monkeypatch.setattr(ajustes, "umbral_fuentes", 1.01)
    r = await b.buscar("índice parcial", 3, Filtros())
    assert r.recuperados and set(r.puntuacion_reranker) == {x.fragmento_id for x in r.recuperados}
    # La similitud para las citas usa el mismo modelo que la búsqueda (aquí, el falso).
    [igual, otra] = b.similitud_frases("índice parcial", ["índice parcial", "gatos"])
    assert igual > 0.99 and otra < 0.5


async def test_indexar_por_la_orden_recalcula_el_apoyo(base, tmp_path) -> None:
    import json

    from sqlalchemy import func, select

    from magister import cli
    from magister.datos.fuentes import LeccionFragmento
    from magister.datos.plan import guardar_plan

    fijos = Path(__file__).parent / "fijos"
    plan = json.loads((fijos / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((fijos / "Perfil.json").read_text(encoding="utf-8"))
    _, plan_id = await guardar_plan("bases de datos", None, perfil, plan, [], "x", "eco")
    fid = await crear_fuente()
    await ingesta.ingerir_ruta(fid, str(DATOS))
    listas = await cli.indexar_pendientes()
    assert len(listas) == 2
    await cli.recalcular_apoyo(listas)
    async with nueva_sesion() as s:
        n = await s.scalar(select(func.count()).select_from(LeccionFragmento).where(LeccionFragmento.plan_id == plan_id))
    assert n > 0


async def test_activar_config_nueva_reindexa_sin_editar_la_anterior(base) -> None:
    from sqlalchemy import delete, select, update

    from magister import cli
    from magister.datos.fuentes import Configuracion

    fid = await crear_fuente("web", "web", 1)
    await ingesta.ingerir_ruta(fid, str(DATOS))
    await ingesta.procesar_pendientes()
    async with nueva_sesion() as s:
        v1 = await rf.configuracion(s)
        antes = dict(v1.params)
    try:
        reindexadas = await cli.activar_config("v_prueba")
        assert len(reindexadas) == 2
        async with nueva_sesion() as s:
            activa = await rf.configuracion(s)
            assert activa.nombre == "v_prueba" and activa.params["secciones_fuera"]
            assert (await rf.configuracion(s, v1.nombre)).params == antes
        assert await cli.activar_config("v_prueba") == []  # ya indexadas: no repite
        assert (await BuscadorHibrido().buscar("ACID", 3, Filtros(), Consulta(via="lexica"))).recuperados
    finally:
        # configuraciones no se vacía entre pruebas: se deja v1 como estaba.
        async with nueva_sesion() as s, s.begin():
            await s.execute(update(Configuracion).values(activa=False))
            await s.execute(delete(Configuracion).where(Configuracion.nombre == "v_prueba"))
            await s.execute(update(Configuracion).where(Configuracion.id == v1.id).values(activa=True))


# Idempotencia, v3 por defecto, apoyo con puerta, escalón y modo en seco


async def _cuantos_fragmentos(version_id: int | None = None, config_id: int | None = None) -> int:
    from sqlalchemy import func, select

    from magister.datos.fuentes import Fragmento

    consulta = select(func.count()).select_from(Fragmento)
    if version_id is not None:
        consulta = consulta.where(Fragmento.version_id == version_id)
    if config_id is not None:
        consulta = consulta.where(Fragmento.config_id == config_id)
    async with nueva_sesion() as s:
        return await s.scalar(consulta) or 0


async def test_indexar_dos_veces_no_duplica_fragmentos(base) -> None:
    import asyncio

    fid = await crear_fuente()
    [r] = await ingesta.ingerir_ruta(fid, str(DATOS / "indices.md"))
    # La orden y el bucle de la API a la vez sobre la misma versión: una sola copia.
    n1, n2 = await asyncio.gather(ingesta.indexar_version(r.version_id), ingesta.indexar_version(r.version_id))
    n = max(n1, n2)
    assert n > 0 and min(n1, n2) == 0
    assert await _cuantos_fragmentos(r.version_id) == n
    # Otra vez, ya lista: no hace nada.
    assert await ingesta.indexar_version(r.version_id) == 0
    assert await _cuantos_fragmentos(r.version_id) == n
    # Reindexar a propósito con una configuración sustituye sus fragmentos, no los suma.
    async with nueva_sesion() as s:
        activa = await rf.configuracion(s)
    await ingesta.indexar_version(r.version_id, activa.nombre)
    await ingesta.indexar_version(r.version_id, activa.nombre)
    assert await _cuantos_fragmentos(r.version_id, activa.id) == n


async def test_la_migracion_deja_v3_activa_sin_tocar_v1(base) -> None:
    from magister import cli

    async with nueva_sesion() as s:
        activa = await rf.configuracion(s)
        v1 = await rf.configuracion(s, "v1")
    assert activa.nombre == "v3" and "references" in activa.params["secciones_fuera"]
    assert "secciones_fuera" not in v1.params and not v1.activa
    assert {k: v for k, v in activa.params.items() if k != "secciones_fuera"} == v1.params
    # Lo que entra sin pasar por la orden ya se indexa con v3.
    fid = await crear_fuente("web", "web", 1)
    [r] = await ingesta.ingerir_ruta(fid, str(DATOS / "indices.md"))
    await ingesta.procesar_pendientes()
    assert await _cuantos_fragmentos(r.version_id, activa.id) > 0
    # `--activar v3` sigue valiendo con v3 ya creada: no la duplica ni reindexa lo que ya tiene.
    assert await cli.activar_config("v3") == []
    async with nueva_sesion() as s:
        assert (await rf.configuracion(s)).id == activa.id


class BuscadorDeApoyo:
    """Devuelve los fragmentos dados con el coseno y, si se pide `puntuar_reranker`, la puntuación del reranker."""

    def __init__(self, ids: list[int], cosenos: list[float], reranker: float | None) -> None:
        self.ids, self.cosenos, self.reranker = ids, cosenos, reranker
        self.params: list = []

    async def buscar(self, consulta, k, filtros=None, params=None, consulta_original=None):
        from magister.cerebro.contratos import Recuperado, ResultadoBusqueda

        self.params.append(params)
        rec = [Recuperado(i, n, c, "texto", "Doc", "doc.md", "vault", 1)
               for n, (i, c) in enumerate(zip(self.ids, self.cosenos), start=1)][:k]
        puntos = {i: self.reranker for i in self.ids} if self.reranker is not None and params and params.puntuar_reranker else {}
        return ResultadoBusqueda(rec, None, dict(zip(self.ids, self.cosenos)), "hibrida", puntos)

    async def indice_fuentes(self, tema_id, max_caracteres=6000) -> str:
        return ""


async def _plan_y_fragmentos() -> tuple[int, str, list[int]]:
    import json

    from sqlalchemy import select

    from magister.datos import plan as dp
    from magister.datos.fuentes import Fragmento
    from magister.datos.plan import guardar_plan

    fijos = Path(__file__).parent / "fijos"
    plan = json.loads((fijos / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((fijos / "Perfil.json").read_text(encoding="utf-8"))
    _, plan_id = await guardar_plan("topografía", None, perfil, plan, [], "x", "eco")
    fid = await crear_fuente()
    await ingesta.ingerir_ruta(fid, str(DATOS))
    await ingesta.procesar_pendientes()
    async with nueva_sesion() as s:
        ids = list((await s.scalars(select(Fragmento.id).order_by(Fragmento.id))).all())
        clave = (await dp.lecciones(s, plan_id))[0].clave
    return plan_id, clave, ids


async def test_leccion_sin_material_no_guarda_fragmentos_ajenos(base) -> None:
    from magister.datos.fuentes import LeccionApoyo
    from magister.flujo.fuentes import calcular_apoyo
    from magister.material.entrada import entrada_de_leccion

    plan_id, clave, ids = await _plan_y_fragmentos()
    # Fuentes de otro tema: ni el coseno ni el reranker llegan.
    await calcular_apoyo(BuscadorDeApoyo(ids, [0.78] * len(ids), -3.0), plan_id, None)
    assert (await entrada_de_leccion(plan_id, clave)).fragmentos == []
    async with nueva_sesion() as s:
        apoyo = await s.get(LeccionApoyo, (plan_id, clave))
        assert await rf.fragmentos_de_leccion(s, plan_id, clave) == []
    assert apoyo.sin_material and apoyo.n_fragmentos == 0


async def test_el_apoyo_pide_siempre_el_reranker(base) -> None:
    from magister.datos.fuentes import LeccionApoyo
    from magister.flujo.fuentes import calcular_apoyo

    plan_id, clave, ids = await _plan_y_fragmentos()
    assert len(ids) >= 2
    # Uno llega al coseno y los demás no, pero el reranker los da por buenos: no queda «sin material».
    b = BuscadorDeApoyo(ids, [0.90] + [0.80] * (len(ids) - 1), 5.0)
    await calcular_apoyo(b, plan_id, None)
    assert all(p is not None and p.puntuar_reranker for p in b.params)
    async with nueva_sesion() as s:
        apoyo = await s.get(LeccionApoyo, (plan_id, clave))
        guardados = await rf.fragmentos_de_leccion(s, plan_id, clave)
    assert not apoyo.sin_material and len(guardados) == min(8, len(ids))


async def test_cada_busqueda_del_chat_anota_su_escalon(base, monkeypatch) -> None:
    from magister.config import ajustes
    from magister.datos.fuentes import Busqueda
    from magister.flujo.nodos.rag import hacer_recuperar

    fid = await crear_fuente()
    await ingesta.ingerir_ruta(fid, str(DATOS))
    await ingesta.procesar_pendientes()
    recuperar = hacer_recuperar(BuscadorHibrido())

    async def escalon(umbral: float, umbral_reranker: float) -> tuple[str, bool]:
        monkeypatch.setattr(ajustes, "umbral_fuentes", umbral)
        monkeypatch.setattr(ajustes, "umbral_reranker", umbral_reranker)
        r = await recuperar({"mensaje": "índice parcial", "consulta": "índice parcial"})
        async with nueva_sesion() as s:
            return (await s.get(Busqueda, r["busqueda_id"])).escalon, bool(r["recuperados"])

    assert await escalon(0.0, 1.5) == ("densa", True)
    assert await escalon(1.01, -1.0) == ("reranker", True)  # el reranker falso cuenta palabras en común (>= 0)
    assert await escalon(1.01, 1000.0) == ("nada", False)


async def test_indexar_en_seco_no_escribe_y_explica(base) -> None:
    from sqlalchemy import func, select, update

    from magister import cli
    from magister.datos.fuentes import Configuracion, Version

    fid = await crear_fuente("web", "web", 1)
    await ingesta.ingerir_ruta(fid, str(DATOS))
    await ingesta.procesar_pendientes()
    async with nueva_sesion() as s, s.begin():
        [vid, otra] = (await s.scalars(select(Version.id).order_by(Version.id))).all()
        await s.execute(update(Version).where(Version.id == vid).values(estado="cuarentena", motivo="no se pudo indexar: x"))

    async def foto() -> tuple:
        async with nueva_sesion() as s:
            return (await s.scalar(select(func.count()).select_from(Configuracion)),
                    (await s.execute(select(Version.id, Version.estado).order_by(Version.id))).all(),
                    await _cuantos_fragmentos(), (await rf.configuracion(s)).nombre)

    antes = await foto()
    sin = "\n".join(await cli.en_seco(None, False))
    assert "Indexaría 0 versiones" in sin and "No tocaría 1 versiones ya listas" in sin and "--reintentar" in sin
    con = "\n".join(await cli.en_seco(None, True))
    assert "Indexaría 1 versiones" in con and f"  {vid}  «" in con and "fallo nuestro" in con
    nueva = "\n".join(await cli.en_seco("v_seco", True))
    assert "Crearía la configuración v_seco" in nueva and "Indexaría 2 versiones" in nueva
    assert f"  {otra}  «" in nueva and "otra configuración (v3)" in nueva
    total = int(nueva.split("unos ")[1].split(" ")[0])
    assert total > 0
    assert await foto() == antes  # nada escrito
