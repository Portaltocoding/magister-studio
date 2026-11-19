"""El research automático (encargo 8): solo lo que empieza pronto y aún no tiene fuentes, y como mucho 2 por vuelta."""

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from magister.plan.horizonte import cuando_empiezas, lecciones_a_investigar

HOY = date(2026, 11, 19)  # jueves


def _plan_de_9(sin_material: bool = True) -> list[dict]:
    # Topografía: 9 lecciones repartidas en 3 semanas, una cada dos o tres días.
    return [{"clave": f"L{i}", "primera_sesion": HOY + timedelta(days=round(i * 2.3)), "sin_material": sin_material}
            for i in range(1, 10)]


def test_solo_los_proximos_7_dias_y_como_mucho_2() -> None:
    lecciones = _plan_de_9()
    assert [x["clave"] for x in lecciones if x["primera_sesion"] <= HOY + timedelta(days=7)] == ["L1", "L2", "L3"]
    assert lecciones_a_investigar(lecciones, {}, HOY) == ["L1", "L2"]
    assert lecciones_a_investigar(lecciones, {}, HOY, max_por_vuelta=5) == ["L1", "L2", "L3"]


def test_que_tareas_se_relanzan() -> None:
    lecciones = _plan_de_9()
    tareas = {"L1": ("cortada", HOY - timedelta(days=1)), "L2": ("acabada", HOY - timedelta(days=1)),
              "L3": ("en_curso", HOY)}
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5) == ["L1"]
    # Una acabada de hace más de 14 días, y la lección sigue sin material: otra vez.
    tareas["L2"] = ("acabada", HOY - timedelta(days=15))
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5) == ["L1", "L2"]


def test_una_busqueda_que_fallo_se_repite_al_dia_siguiente_y_no_quema_14_dias() -> None:
    lecciones = _plan_de_9()
    ayer = HOY - timedelta(days=1)
    tareas = {"L1": ("cortada", HOY, "error: la búsqueda web no respondió"),
              "L2": ("cortada", HOY, "no se pudieron escribir consultas: el freno"),
              "L3": ("cortada", HOY, "la API se reinició")}
    # Fallaron hoy: no se gasta otra consulta en cada vuelta; la que cortó un reinicio, sí se relanza.
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5) == ["L3"]
    tareas = {"L1": ("cortada", ayer, "error: la búsqueda web no respondió"), "L2": ("cortada", ayer, "se pasó de 900 s"),
              "L3": ("acabada", ayer, "ninguna página legible")}
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5) == ["L1", "L2"]
    # Lo «viejo» entra como argumento (MAGISTER_RESEARCH_VIEJA_DIAS).
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5, vieja_dias=0) == ["L1", "L2", "L3"]


def test_con_material_tuyo_el_no_no_manda() -> None:
    lecciones = _plan_de_9()
    lecciones[0]["necesita_fuentes"] = "no"
    assert lecciones_a_investigar(lecciones, {}, HOY) == ["L2", "L3"]
    assert lecciones_a_investigar(lecciones, {}, HOY, material_propio=True) == ["L1", "L2"]


def test_lo_que_tiene_material_o_esta_marcado_no_se_salta_y_lo_atrasado_va_primero() -> None:
    assert lecciones_a_investigar(_plan_de_9(sin_material=False), {}, HOY) == []
    lecciones = _plan_de_9()
    lecciones[0]["necesita_fuentes"] = "no"
    assert lecciones_a_investigar(lecciones, {}, HOY) == ["L2", "L3"]
    # La llevas atrasada (su sesión pendiente era ayer): sigue por estudiar y va la primera.
    lecciones[2]["primera_sesion"] = HOY - timedelta(days=1)
    assert lecciones_a_investigar(lecciones, {}, HOY) == ["L3", "L2"]
    lecciones[1]["primera_sesion"] = lecciones[2]["primera_sesion"] = None  # sin sesiones pendientes: ya estudiada
    assert lecciones_a_investigar(lecciones, {}, HOY) == []


def test_cuando_empiezas() -> None:
    assert cuando_empiezas(HOY, HOY) == "hoy"
    assert cuando_empiezas(HOY + timedelta(days=1), HOY) == "mañana"
    assert cuando_empiezas(HOY + timedelta(days=4), HOY) == "el lunes"
    assert cuando_empiezas(HOY + timedelta(days=7), HOY) == "el jueves 26"


@pytest.mark.anyio
async def test_la_vuelta_lanza_lo_que_toca_y_lo_anota(base, monkeypatch) -> None:
    from magister.api import app as aplicacion
    from magister.datos.fuentes import TareaResearch
    from magister.datos.plan import guardar_plan
    from magister.datos.sesion import nueva_sesion
    from magister.research import tareas
    from magister.trabajos import automatizar

    fijos = Path(__file__).parent / "fijos"
    plan = json.loads((fijos / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((fijos / "Perfil.json").read_text(encoding="utf-8"))
    plan["lecciones"][1]["necesita_fuentes"] = "no"
    sesiones = [{"clave": lec["clave"], "fecha": (HOY + timedelta(days=i * 3)).isoformat(), "inicio": None, "horas": 1}
                for i, lec in enumerate(plan["lecciones"])]
    _, plan_id = await guardar_plan("Topografía", None, perfil, plan, sesiones, "x", "eco")

    lanzadas: list[int] = []
    monkeypatch.setattr(tareas, "lanzar_en_fondo", lambda ids: lanzadas.extend(ids))
    hecho = await aplicacion.investigar_horizonte(None, HOY)
    # L1 (hoy) y L3 (dentro de 6 días): L2 es «no» y L4 cae fuera de los 7 días.
    async with nueva_sesion() as s:
        from sqlalchemy import select

        filas = (await s.scalars(select(TareaResearch).order_by(TareaResearch.id))).all()
    assert [(t.plan_id, t.leccion_clave) for t in filas] == [(plan_id, "L1"), (plan_id, "L3")]
    assert lanzadas == [t.id for t in filas]
    assert hecho == ["Buscando fuentes para L1 y L3 de Topografía (empiezas hoy)"]
    assert (await automatizar.ver_registro())[0]["texto"] == hecho[0]

    # Con una búsqueda del plan en curso, no se lanza nada más.
    async with nueva_sesion() as s, s.begin():
        s.add(TareaResearch(plan_id=plan_id, leccion_clave="L4", sistema="fijo",
                            creada_en=datetime.now(timezone.utc)))
    assert await aplicacion.investigar_horizonte(None, HOY) == []


@pytest.mark.anyio
async def test_con_el_freno_echado_no_se_lanza_nada(base, monkeypatch) -> None:
    from magister.api import app as aplicacion
    from magister.cerebro import freno

    monkeypatch.setattr(freno, "estado", lambda: {"parados": {"*": 300}, "llamadas_en_ventana": 99})
    assert await aplicacion.investigar_horizonte(None, HOY) == []


async def _plan_topografia() -> int:
    from magister.datos.plan import guardar_plan

    fijos = Path(__file__).parent / "fijos"
    plan = json.loads((fijos / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((fijos / "Perfil.json").read_text(encoding="utf-8"))
    sesiones = [{"clave": lec["clave"], "fecha": (HOY + timedelta(days=i * 3)).isoformat(), "inicio": None, "horas": 1}
                for i, lec in enumerate(plan["lecciones"])]
    _, plan_id = await guardar_plan("Topografía", None, perfil, plan, sesiones, "x", "eco")
    return plan_id


@pytest.mark.anyio
async def test_sin_red_la_vuelta_no_lanza_nada(base, monkeypatch) -> None:
    from magister.api import app as aplicacion
    from magister.research import tareas

    await _plan_topografia()
    lanzadas: list[int] = []
    monkeypatch.setattr(tareas, "lanzar_en_fondo", lambda ids: lanzadas.extend(ids))
    comprobaciones: list[bool] = []

    async def sin_red() -> bool:
        comprobaciones.append(False)
        return False

    assert await aplicacion.investigar_horizonte(None, HOY, sin_red) == []
    assert lanzadas == [] and comprobaciones == [False]

    async def con_red() -> bool:
        return True

    assert len(await aplicacion.investigar_horizonte(None, HOY, con_red)) == 1 and len(lanzadas) == 2


@pytest.mark.anyio
async def test_los_apuntes_automaticos_esperan_a_lo_que_el_horizonte_va_a_buscar(base, monkeypatch) -> None:
    from magister.api import app as aplicacion
    from magister.trabajos import automatizar

    plan_id = await _plan_topografia()
    # Lo que el research automático lanzaría ahora: L1 (hoy) y L3, como en la vuelta de arriba (L2 no tiene «no» aquí).
    assert {c for p, c in await aplicacion.por_investigar(HOY) if p == plan_id} >= {"L1"}

    async def leer():
        return {**automatizar.PREDETERMINADAS, "preparar_siguiente": {"activa": True, "dias_antes": 1}}

    monkeypatch.setattr(automatizar, "leer", leer)
    ahora = datetime(HOY.year, HOY.month, HOY.day, 10, 0)
    automatizar.registrar_por_investigar(aplicacion.por_investigar)
    try:
        # L1 empieza hoy y no tiene apuntes, pero su búsqueda va a salir: espera, y se dice hasta cuándo.
        assert await automatizar.una_vuelta(ahora) is None
        assert (await automatizar.ver_registro())[0]["texto"].startswith("Espero a las fuentes de L1")
    finally:
        automatizar.registrar_por_investigar(None)
    # Sin el gancho (como antes), se preparan ya.
    assert (await automatizar.una_vuelta(ahora)).startswith("Puesto en cola: preparar L1")
