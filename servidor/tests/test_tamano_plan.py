"""El plan declara su alcance y sus horas tienen que casar: un procedimiento no puede salir en 9 h (evals/tamano_plan.py)."""

import pytest

from magister.plan.esquemas import Plan
from magister.plan.reglas import error_alcance, es_solo_capacidad


def _plan(alcance: str | None, horas: list[float]) -> Plan:
    return Plan.model_validate({
        "razonamiento": "x", "alcance": alcance,
        "lecciones": [{"clave": f"L{i}", "titulo": "Una lección", "objetivos": ["Calcular algo"],
                       "conceptos": [{"id": f"c-{i}", "nombre": "c"}], "horas": h,
                       "necesita_fuentes": "no", "fuentes_por_que": "Se explica bien sin fuentes."}
                      for i, h in enumerate(horas, start=1)],
    })


def test_las_horas_casan_con_el_alcance() -> None:
    assert error_alcance(_plan("procedimiento", [1.0, 0.5])) is None
    error = error_alcance(_plan("procedimiento", [1.5, 2.0, 2.0, 2.0]))
    assert error and "de 0,5 a 2 h" in error and "7,5 h" in error
    assert error_alcance(_plan("tema", [1.0])) is not None  # un tema no cabe en una hora
    # Una asignatura no tiene tope propio: manda el presupuesto. Sin alcance, se pide (los planes guardados sin él siguen
    # siendo válidos: la regla solo mira lo que acaba de escribir el modelo).
    assert error_alcance(_plan("asignatura", [4.0] * 20)) is None
    assert "falta `alcance`" in (error_alcance(_plan(None, [1.0])) or "")


def test_pasarse_de_alcance_no_es_falta_de_tiempo() -> None:
    error = error_alcance(_plan("concepto", [3.0, 2.0]))
    assert error and not es_solo_capacidad([error])


def test_el_modelo_tiene_que_dar_el_alcance() -> None:
    from magister.plan.esquemas import PlanNuevo

    assert "alcance" in PlanNuevo.model_json_schema()["required"]
    assert "alcance" not in Plan.model_json_schema().get("required", [])  # los planes guardados siguen valiendo


def test_si_solo_se_pasa_de_horas_se_recorta() -> None:
    from magister.plan.reglas import ajustar_a_alcance, solo_alcance

    largo = _plan("procedimiento", [2.0, 2.0, 1.0])
    corto = ajustar_a_alcance(largo)
    assert [x.horas for x in corto.lecciones] == [0.75, 0.75, 0.5] and corto.total_horas <= 2.0
    assert ajustar_a_alcance(_plan("asignatura", [4.0])).total_horas == 4.0
    assert solo_alcance([error_alcance(largo) or ""]) and not solo_alcance(["L1 tiene 5 h y el máximo es 4 h"])


@pytest.mark.anyio
async def test_el_planificador_no_deja_sin_plan_por_pasarse_de_horas(monkeypatch) -> None:
    from datetime import date, timedelta

    from magister.cerebro.estructura import eco
    from magister.config import ajustes
    from magister.flujo.nodos.planificar import planificar

    monkeypatch.setattr(ajustes, "motor", "eco")
    hoy = date(2026, 11, 18)
    perfil = {"tema": "Dividir", "objetivo": "aprender a dividir", "nivel": "basico", "horas_por_dia": [2] * 5 + [0, 0],
              "inicio_por_dia": [None] * 7, "plazo": (hoy + timedelta(days=30)).isoformat(), "sin_plazo": False}
    largo = _plan("procedimiento", [2.0, 2.0, 1.0]).model_dump(mode="json")
    eco.vaciar()
    eco.encolar(Plan, [largo] * 10)
    r = await planificar({"perfil": perfil, "hoy": hoy.isoformat()})
    eco.vaciar()
    assert r["salida"] == "calendarizar" and r["plan"]["alcance"] == "procedimiento"
    assert sum(x["horas"] for x in r["plan"]["lecciones"]) <= 2.0 and r["errores"]
