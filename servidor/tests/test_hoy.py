"""La tarjeta «Hoy» y el reajuste: qué examen se propone y qué día es «hoy»."""

from datetime import date, datetime, timezone

import pytest

pytestmark = pytest.mark.anyio


def plan_de(claves: list[str]) -> dict:
    return {"razonamiento": "x", "lecciones": [
        {"clave": c, "titulo": f"Lección {c}", "objetivos": ["Explicar algo"], "conceptos": [{"id": f"c-{c.lower()}", "nombre": c}],
         "horas": 1.0, "depende_de": []} for c in claves]}


async def test_el_parcial_espera_a_que_estudies_sus_lecciones(base) -> None:
    """Seis lecciones, una por día: el parcial L1 a L3 toca el 18-11, pero no sale mientras quede algo de L1 a L3 por
    estudiar. Una lección saltada cuenta como vista."""
    from magister.api.rutas_tutor import examen_pendiente
    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion

    claves = ["L1", "L2", "L3", "L4", "L5", "L6"]
    sesiones = [{"clave": c, "fecha": f"2026-11-{16 + i}", "inicio": None, "horas": 1.0} for i, c in enumerate(claves)]
    _, plan_id = await dp.guardar_plan("Topografía", None, {"horas_por_dia": [1] * 7}, plan_de(claves), sesiones, None, None)
    hoy = date(2026, 11, 19)
    assert await examen_pendiente(hoy) is None

    async def marcar(clave: str, estado: str) -> None:
        async with nueva_sesion() as s:
            fila = next(x for x in await dp.sesiones(s, plan_id) if x.leccion_clave == clave)
            await dp.marcar_sesion(s, fila.id, estado)

    await marcar("L1", "hecha")
    await marcar("L2", "saltada")
    assert await examen_pendiente(hoy) is None  # L3 sigue pendiente
    await marcar("L3", "hecha")
    examen = await examen_pendiente(hoy)
    assert examen is not None and examen["id"] == "parcial-L1-L3" and examen["plan_id"] == plan_id


async def test_el_reajuste_de_madrugada_parte_del_dia_de_tu_zona(base, monkeypatch) -> None:
    """A las 00:30 del 20-11 en Madrid (23:30 del 19 en UTC), el reajuste reparte desde el 20, no desde el 19."""
    from magister.config import ajustes
    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion
    from magister.flujo import planes

    monkeypatch.setattr(ajustes, "zona", "Europe/Madrid")
    claves = ["L1", "L2"]
    sesiones = [{"clave": c, "fecha": f"2026-11-{16 + i}", "inicio": None, "horas": 1.0} for i, c in enumerate(claves)]
    tema_id, _ = await dp.guardar_plan("Topografía", None, {"horas_por_dia": [1] * 7}, plan_de(claves), sesiones, None, None)
    async with nueva_sesion() as s:
        r = await planes.proponer_reajuste(s, tema_id, datetime(2026, 11, 19, 23, 30, tzinfo=timezone.utc))
    assert r is not None and r["sesiones"]
    assert min(x["fecha"] for x in r["sesiones"]) == "2026-11-20"


def test_el_reajuste_avisa_si_tu_horario_pasa_de_medianoche() -> None:
    """3,5 h desde las 21:30 de lunes a viernes: el aviso dice que solo cuentan las horas hasta las 24:00."""
    from datetime import time

    from magister.aprender.reajuste import reajustar
    from magister.plan.calendario import Calendario, ReglasCalendario
    from magister.plan.esquemas import Plan

    plan = Plan.model_validate(plan_de(["L1", "L2"]))
    noches = [3.5] * 5 + [0, 0]
    inicios = [time(21, 30)] * 5 + [None, None]
    cal, avisos = reajustar(plan, noches, inicios, date(2026, 11, 16), None, {}, {}, set(), ReglasCalendario())
    assert isinstance(cal, Calendario)
    assert any("medianoche" in a and "lunes" in a for a in avisos)
    _, sin_aviso = reajustar(plan, [2.5] * 5 + [0, 0], inicios, date(2026, 11, 16), None, {}, {}, set(), ReglasCalendario())
    assert not any("medianoche" in a for a in sin_aviso)
