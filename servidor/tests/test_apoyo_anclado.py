"""Lo que el research trajo para una lección apoya a esa lección, y la pequeña biblioteca de cada lección en el Roadmap."""

import json
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import select

from magister.cerebro.contratos import Filtros, Recuperado, ResultadoBusqueda
from magister.datos import repositorio_fuentes as rf
from magister.datos.sesion import nueva_sesion
from magister.fuentes import ingesta
from magister.fuentes.buscar import _filtros_sql

FIJOS = Path(__file__).parent / "fijos"
DATOS = Path(__file__).parent / "datos"


def test_filtrar_por_versiones() -> None:
    donde, valores = _filtros_sql(Filtros(version_ids=[3, 5]))
    assert "v.id = any(:version_ids)" in donde and valores["version_ids"] == [3, 5]
    donde, valores = _filtros_sql(Filtros(tema_id=2))
    assert "version_ids" not in donde and "version_ids" not in valores


def test_los_anclados_van_por_turnos_entre_objetivos_con_tope() -> None:
    from magister.flujo.fuentes import juntar_apoyo

    # 4 objetivos con 3 anclados cada uno (ids 10x, 20x, 30x, 40x) y lo que pasa la puerta en la búsqueda general.
    por_objetivo = [[(o * 100 + i, i, 0.7) for i in range(1, 4)] for o in range(1, 5)]
    buenos = [(900 + i, i, 0.9) for i in range(1, 8)]
    elegidos = juntar_apoyo(por_objetivo, buenos)
    ids = [f for f, _, _ in elegidos]
    assert len(ids) == 12
    # Primero uno de cada objetivo, luego el segundo de cada uno; el tercero no entra; luego los que pasan.
    assert ids[:8] == [101, 201, 301, 401, 102, 202, 302, 402]
    assert ids[8:] == [901, 902, 903, 904]
    assert [r for _, r, _ in elegidos] == list(range(1, 13))
    # Un fragmento que ya entró por otro objetivo no se repite: se coge el siguiente.
    assert [f for f, _, _ in juntar_apoyo([[(1, 1, 0.7), (2, 2, 0.7)], [(1, 1, 0.7), (3, 2, 0.7)]], [])] == [1, 3, 2]


pytestmark = pytest.mark.anyio


class BuscadorAnclado:
    """Con `version_ids`, devuelve los fragmentos de esas versiones con coseno 0,70 y sin reranker; sin ellos, los de
    todo el índice con el mismo coseno (no llegan a la puerta)."""

    def __init__(self, fragmentos: dict[int, list[int]]) -> None:
        self.fragmentos = fragmentos  # version_id -> fragmento_ids
        self.filtros: list = []

    async def buscar(self, consulta, k, filtros=None, params=None, consulta_original=None):
        self.filtros.append(filtros)
        versiones = filtros.version_ids if filtros and filtros.version_ids is not None else list(self.fragmentos)
        ids = [f for v in versiones for f in self.fragmentos.get(v, [])][:k]
        rec = [Recuperado(f, n, 0.70, "texto", "Doc", "doc.md", "web", 1) for n, f in enumerate(ids, start=1)]
        return ResultadoBusqueda(rec, None, {f: 0.70 for f in ids}, "hibrida", {})

    async def indice_fuentes(self, tema_id, max_caracteres=6000) -> str:
        return ""


async def _plan(objetivos_l1: list[str] | None = None) -> int:
    from magister.datos.plan import guardar_plan

    plan = json.loads((FIJOS / "Plan.json").read_text(encoding="utf-8"))
    if objetivos_l1:
        plan["lecciones"][0]["objetivos"] = objetivos_l1
    perfil = json.loads((FIJOS / "Perfil.json").read_text(encoding="utf-8"))
    _, plan_id = await guardar_plan("topografía", None, perfil, plan, [], "x", "eco")
    return plan_id


async def _versiones_indexadas() -> dict[int, list[int]]:
    from magister.datos.fuentes import Fragmento

    async with nueva_sesion() as s:
        fid = (await rf.crear_fuente(s, "web", "web", 1)).id
    await ingesta.ingerir_ruta(fid, str(DATOS))
    await ingesta.procesar_pendientes()
    async with nueva_sesion() as s:
        filas = (await s.execute(select(Fragmento.version_id, Fragmento.id).order_by(Fragmento.id))).all()
    salida: dict[int, list[int]] = {}
    for v, f in filas:
        salida.setdefault(v, []).append(f)
    return salida


async def _anclar(plan_id: int, clave: str, version_id: int, estado: str = "aprobada") -> None:
    from magister.datos.fuentes import Propuesta

    async with nueva_sesion() as s, s.begin():
        s.add(Propuesta(url=f"https://ejemplo.org/{version_id}-{clave}", titulo="Guía", plan_id=plan_id, leccion_clave=clave,
                        motivo="cubre el objetivo", estado=estado, version_id=version_id))


async def test_lo_traido_para_una_leccion_apoya_a_esa_leccion_y_no_a_otra(base) -> None:
    from magister.datos.fuentes import LeccionApoyo
    from magister.flujo.fuentes import calcular_apoyo

    plan_id = await _plan()
    versiones = await _versiones_indexadas()
    anclada, otra = sorted(versiones)[:2]
    assert len(versiones[anclada]) >= 2
    await _anclar(plan_id, "L3", anclada)
    await _anclar(plan_id, "L2", otra, estado="rechazada")  # lo rechazado no ancla
    b = BuscadorAnclado(versiones)
    await calcular_apoyo(b, plan_id, None)
    async with nueva_sesion() as s:
        l3 = await rf.fragmentos_de_leccion(s, plan_id, "L3")
        l2 = await rf.fragmentos_de_leccion(s, plan_id, "L2")
        apoyo3 = await s.get(LeccionApoyo, (plan_id, "L3"))
        apoyo2 = await s.get(LeccionApoyo, (plan_id, "L2"))
    # Coseno 0,70 y sin reranker: entra en L3 porque se trajo para ella, y en L2 nada (no pasa la puerta).
    assert l3 == versiones[anclada][:2] and l2 == []
    assert not apoyo3.sin_material and apoyo2.sin_material
    # Las búsquedas ancladas solo miran las versiones de L3.
    assert [f.version_ids for f in b.filtros if f and f.version_ids is not None] == [[anclada]]


async def test_un_documento_sin_tema_que_no_pasa_la_puerta_no_se_guarda(base) -> None:
    from magister.flujo.fuentes import calcular_apoyo

    plan_id = await _plan()
    versiones = await _versiones_indexadas()
    await calcular_apoyo(BuscadorAnclado(versiones), plan_id, None)
    async with nueva_sesion() as s:
        for clave in ("L1", "L2", "L3", "L4"):
            assert await rf.fragmentos_de_leccion(s, plan_id, clave) == []


async def test_la_vista_de_cada_leccion_trae_su_pequena_biblioteca(base) -> None:
    from magister.datos.fuentes import TareaResearch
    from magister.datos.material import Material
    from magister.flujo.planes import vista_por_id

    plan_id = await _plan(["Leer un JSON", "Calcular precisión, recall y F1", "Escribir un JSON"])
    versiones = await _versiones_indexadas()
    v1, v2 = sorted(versiones)[:2]
    await _anclar(plan_id, "L1", v1)
    await _anclar(plan_id, "L1", v2)
    async with nueva_sesion() as s, s.begin():
        # Propuesta de antes de la ficha, sin entrar todavía.
        from magister.datos.fuentes import Propuesta

        s.add(Propuesta(url="https://otro.org/x", titulo="Otra", plan_id=plan_id, leccion_clave="L1", motivo="m"))
        s.add(TareaResearch(plan_id=plan_id, leccion_clave="L1", sistema="fijo", estado="acabada",
                            trayectoria=[{"accion": "buscar"}, {"accion": "sin_cubrir", "objetivos": [2]}]))
        s.add(TareaResearch(plan_id=plan_id, leccion_clave="L2", sistema="fijo", estado="en_curso", trayectoria=[]))
        # Apuntes hechos sin fuentes (guardaron con qué: ninguna) y, ahora, 3 fragmentos de apoyo.
        s.add(Material(plan_id=plan_id, leccion_clave="L1", tipo="apuntes", estado="listo", versiones={"apoyo": []}))
        s.add(Material(plan_id=plan_id, leccion_clave="L2", tipo="apuntes", estado="listo", versiones={}))
    tres = [f for v in sorted(versiones) for f in versiones[v]][:3]
    await rf.guardar_apoyo(plan_id, "L1", [(f, n, 0.9) for n, f in enumerate(tres, start=1)], False)
    async with nueva_sesion() as s:
        vista = await vista_por_id(s, plan_id, date(2026, 11, 19))
    l1, l2, l3 = vista["lecciones"][:3]
    b = l1["biblioteca"]
    assert [f["estado"] for f in b["fuentes"]] == ["lista", "lista", "propuesta"]
    assert b["fuentes"][0]["dominio"] == "ejemplo.org" and b["fuentes"][0]["cubre"] == []
    assert b["sin_fuente"] == [2] and b["research"] == "acabada" and b["cobertura_conocida"]
    assert l1["apuntes_fuentes"] == "sin_fuentes"
    # Lo que ya había no cambia: `fuentes` sigue siendo el número de fragmentos de apoyo.
    assert l1["fuentes"] == 3 and l1["sin_material"] is False
    assert l2["biblioteca"]["research"] == "buscando" and l2["apuntes_fuentes"] == "desconocido"
    assert l3["biblioteca"] == {"fuentes": [], "sin_fuente": [], "research": "sin_lanzar", "cobertura_conocida": False}
    assert l3["apuntes_fuentes"] is None


def test_con_la_ficha_del_juez_lo_que_falta_sale_de_lo_que_cubren_las_fuentes() -> None:
    from magister.flujo.planes import biblioteca_de_leccion

    fuentes = [
        {"estado": "lista", "tipo": "documentacion", "cubre": [1, 3]},
        {"estado": "problema", "tipo": "tutorial", "cubre": [4]},  # lo que falló no cubre
        {"estado": "propuesta", "tipo": "tutorial", "cubre": [2]},  # ni lo que aún no ha entrado
    ]
    b = biblioteca_de_leccion(["a", "b", "c", "d"], fuentes, {"estado": "acabada", "sin_cubrir": [3]})
    assert b["sin_fuente"] == [2, 4] and b["cobertura_conocida"]


async def test_el_resumen_de_la_biblioteca_trae_el_tema_y_lo_que_entro_a_medias(cliente) -> None:
    from sqlalchemy import update

    from magister.datos import conversaciones as dc
    from magister.datos.fuentes import Version

    async with nueva_sesion() as s:
        fid = (await rf.crear_fuente(s, "web", "web", 1)).id
        tema = await dc.crear_tema(s, "Redes")
    [r, _] = await ingesta.ingerir_ruta(fid, str(DATOS), tema.id)
    await ingesta.procesar_pendientes()
    async with nueva_sesion() as s, s.begin():
        v = await s.get(Version, r.version_id)
        await s.execute(update(Version).where(Version.id == r.version_id)
                        .values(metadatos={**(v.metadatos or {}), "incompleta": "solo el resumen"}))
    resumen = (await cliente.get("/api/fuentes/resumen")).json()
    [incompleta] = resumen["incompletas"]
    assert incompleta["incompleta"] == "solo el resumen" and incompleta["fuente_id"] == fid
    assert incompleta["tema_id"] == tema.id and incompleta["tema"] == "Redes"
    docs = (await cliente.get(f"/api/fuentes/{fid}/documentos")).json()
    assert sorted(d["incompleta"] or "" for d in docs) == ["", "solo el resumen"]
    # La versión también lo dice (la web pinta «Solo una parte: …» con d.version.incompleta).
    assert sorted(d["version"]["incompleta"] or "" for d in docs) == ["", "solo el resumen"]
    [doc] = [d for d in docs if d["incompleta"]]
    versiones = (await cliente.get(f"/api/documentos/{doc['id']}/versiones")).json()
    assert [x["incompleta"] for x in versiones] == ["solo el resumen"]


def test_el_origen_lleva_lo_incompleto_venga_de_donde_venga() -> None:
    from magister.api.rutas_fuentes import _origen

    assert _origen(None) == {"origen": None, "incompleta": None}
    assert _origen({"incompleta": "tras un muro de pago"})["incompleta"] == "tras un muro de pago"
    r = _origen({"origen": "research", "leccion_clave": "L1", "incompleta": "solo el resumen"})
    assert r["origen"] == "research" and r["incompleta"] == "solo el resumen"
