"""Los apuntes esperan a sus fuentes y guardan con cuáles se hicieron (encargo 4)."""

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from magister.plan.apoyo import estado_apuntes
from magister.trabajos.automatizar import PREDETERMINADAS, elegir_tarea

HOY = date(2026, 11, 19)
PREPARAR = {**PREDETERMINADAS, "preparar_siguiente": {"activa": True, "dias_antes": 1}}


def test_estado_apuntes_en_los_cuatro_casos() -> None:
    assert estado_apuntes(None, [1, 2]) == "desconocido"
    assert estado_apuntes({}, [1, 2]) == "desconocido"  # los materiales de antes
    assert estado_apuntes({"apoyo": []}, [1, 2, 3]) == "sin_fuentes"
    assert estado_apuntes({"apoyo": []}, [1]) == "al_dia"  # un solo fragmento no basta para avisar
    assert estado_apuntes({"apoyo": [1]}, [1, 2, 3]) == "nuevas"
    assert estado_apuntes({"apoyo": [1, 2]}, [1, 2, 3]) == "al_dia"


def test_la_vista_usa_la_regla_de_plan() -> None:
    from magister.flujo import planes

    assert planes.estado_apuntes is estado_apuntes


def test_una_leccion_que_espera_sus_fuentes_se_salta() -> None:
    lecciones = [{"plan_id": 1, "clave": c, "titulo": c, "fecha": HOY, "tipos": set()} for c in ("L1", "L2")]
    assert elegir_tarea(PREPARAR, lecciones, HOY, esperando=frozenset({(1, "L1")}))[0]["clave"] == "L2"
    assert elegir_tarea(PREPARAR, lecciones, HOY, esperando=frozenset({(1, "L1"), (1, "L2")})) is None
    # Las demás reglas no esperan: las diapositivas salen de unos apuntes que ya existen.
    lecciones[0]["tipos"] = {"apuntes"}
    config = {**PREDETERMINADAS, "diapositivas_al_preparar": {"activa": True}}
    assert elegir_tarea(config, lecciones, HOY, esperando=frozenset({(1, "L1")}))[0]["clave"] == "L1"


async def _plan() -> int:
    from magister.datos.plan import guardar_plan

    fijos = Path(__file__).parent / "fijos"
    plan = json.loads((fijos / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((fijos / "Perfil.json").read_text(encoding="utf-8"))
    _, plan_id = await guardar_plan("bases de datos", None, perfil, plan,
                                    [{"clave": "L1", "fecha": HOY.isoformat(), "inicio": None, "horas": 1}], "x", "eco")
    return plan_id


@pytest.mark.anyio
async def test_espera_a_un_research_en_curso_y_lo_anota(base, monkeypatch) -> None:
    from magister.datos.fuentes import TareaResearch
    from magister.datos.sesion import nueva_sesion
    from magister.trabajos import automatizar

    plan_id = await _plan()
    async with nueva_sesion() as s, s.begin():
        s.add(TareaResearch(plan_id=plan_id, leccion_clave="L1", sistema="fijo", creada_en=datetime.now(timezone.utc)))
    esperando = await automatizar._esperando_fuentes(20)
    assert set(esperando) == {(plan_id, "L1")}
    assert await automatizar._esperando_fuentes(0) == {}  # pasado el plazo, ya no se espera

    async def config() -> dict:
        return PREPARAR

    monkeypatch.setattr(automatizar, "leer", config)
    assert await automatizar.una_vuelta(datetime(2026, 11, 19, 10, 0)) is None
    assert (await automatizar.ver_registro())[0]["texto"].startswith("Espero a las fuentes de L1 (hasta las ")
    async with nueva_sesion() as s:
        from sqlalchemy import text

        assert await s.scalar(text("select count(*) from trabajos")) == 0


@pytest.mark.anyio
async def test_los_apuntes_guardan_con_que_fragmentos_se_hicieron(base) -> None:
    from magister.material.entrada import PROMPTS_APUNTES, con_que_se_hacen, entrada_de_leccion
    from magister.material.modelos import FragmentoFuente

    plan_id = await _plan()
    entrada = await entrada_de_leccion(plan_id, "L1")
    entrada.fragmentos = [FragmentoFuente(id=7, texto="t", titulo="d", tipo="web"),
                          FragmentoFuente(id=9, texto="t", titulo="d", tipo="pdf")]
    versiones = await con_que_se_hacen(entrada)
    assert versiones["apoyo"] == [7, 9] and versiones["huella"] == [0, 0]
    assert set(versiones["prompts"]) == set(PROMPTS_APUNTES) and all(len(v) == 12 for v in versiones["prompts"].values())
    assert estado_apuntes(versiones, [7, 9]) == "al_dia"
