"""Cuándo hace falta buscar fuentes (ADR-0021): el plan lo decide por lección, sin llamadas de más."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from magister.plan.apoyo import POR_QUE_ANTIGUO, POR_QUE_MATERIAL, necesidad_efectiva
from magister.plan.esquemas import Leccion, Plan, PlanNuevo

FIJOS = Path(__file__).parent / "fijos"


def _leccion(**extra) -> dict:
    return {"clave": "L1", "titulo": "Dividir", "objetivos": ["Dividir con decimales"],
            "conceptos": [{"id": "dividir", "nombre": "Dividir"}], "horas": 1, **extra}


def _plan_nuevo(**extra) -> dict:
    return {"razonamiento": "x", "alcance": "procedimiento", "lecciones": [_leccion(**extra)]}


def test_el_modelo_tiene_que_decir_si_hace_falta_y_por_que() -> None:
    ok = PlanNuevo.model_validate(_plan_nuevo(necesita_fuentes="no", fuentes_por_que="Lo explica bien cualquier modelo."))
    assert ok.lecciones[0].necesita_fuentes == "no"
    leccion = PlanNuevo.model_json_schema()["$defs"]["LeccionNueva"]
    assert {"necesita_fuentes", "fuentes_por_que"} <= set(leccion["required"])
    with pytest.raises(ValidationError):  # sin el campo
        PlanNuevo.model_validate(_plan_nuevo(fuentes_por_que="x x x"))
    with pytest.raises(ValidationError):  # un valor que no existe
        PlanNuevo.model_validate(_plan_nuevo(necesita_fuentes="quizas", fuentes_por_que="Porque sí, sin más."))
    with pytest.raises(ValidationError):  # el motivo vacío
        PlanNuevo.model_validate(_plan_nuevo(necesita_fuentes="conviene", fuentes_por_que="   "))


def test_un_plan_guardado_sin_el_campo_se_lee_como_conviene() -> None:
    viejo = Plan.model_validate({"razonamiento": "x", "lecciones": [_leccion()]})
    assert viejo.lecciones[0].necesita_fuentes == "conviene" and viejo.lecciones[0].fuentes_por_que == ""
    assert "necesita_fuentes" not in Leccion.model_json_schema().get("required", [])


def test_tu_material_manda_sobre_la_etiqueta() -> None:
    assert necesidad_efectiva("no", "Se explica sola.", False) == ("no", "Se explica sola.")
    assert necesidad_efectiva("no", "Se explica sola.", True) == ("conviene", POR_QUE_MATERIAL)
    assert necesidad_efectiva("imprescindible", "Cambia cada año.", True) == ("imprescindible", "Cambia cada año.")
    assert necesidad_efectiva(None, None, False) == ("conviene", POR_QUE_ANTIGUO)
    assert necesidad_efectiva("rara", "x", False)[0] == "conviene"


def test_la_plantilla_lleva_los_criterios_con_ejemplos() -> None:
    from magister.cerebro.prompts import _del_fichero

    for nombre in ("planificar", "cuando_research"):
        texto = _del_fichero(nombre).texto
        assert "Ante la duda entre «no» y «conviene», elige «conviene»" in texto
        assert "dividir con decimales" in texto and "Código Civil" in texto and "@incluir" not in texto
    planificar = _del_fichero("planificar").texto
    assert "Cuatro objetivos por lección como mucho" in planificar and "«Proyecto:»" in planificar


async def _plan_guardado(etiquetas: dict[str, str]) -> tuple[int, int]:
    from magister.datos.plan import guardar_plan

    plan = json.loads((FIJOS / "Plan.json").read_text(encoding="utf-8"))
    for lec in plan["lecciones"]:
        if lec["clave"] in etiquetas:
            lec["necesita_fuentes"] = etiquetas[lec["clave"]]
            lec["fuentes_por_que"] = f"Motivo de {lec['clave']}."
    perfil = json.loads((FIJOS / "Perfil.json").read_text(encoding="utf-8"))
    return await guardar_plan("bases de datos", None, perfil, plan, [], "x", "eco")


@pytest.mark.anyio
async def test_se_guarda_se_ve_y_se_cambia(cliente) -> None:
    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion
    from magister.research import tareas

    tema_id, plan_id = await _plan_guardado({"L1": "no", "L2": "imprescindible"})
    vista = (await cliente.get(f"/api/temas/{tema_id}/plan")).json()
    por_clave = {x["clave"]: x for x in vista["lecciones"]}
    assert por_clave["L1"]["necesita_fuentes"] == "no" and por_clave["L1"]["fuentes_por_que"] == "Motivo de L1."
    assert por_clave["L2"]["necesita_fuentes"] == "imprescindible" and por_clave["L1"]["material_propio"] is False
    # El research de todo el plan se salta la «no» (lee el mismo campo, en la fila).
    async with nueva_sesion() as s:
        filas = {x.clave: x for x in await dp.lecciones(s, plan_id)}
    assert tareas.separar_por_necesidad(filas, ["L1", "L2"], False) == (["L2"], ["L1"])

    r = await cliente.patch(f"/api/planes/{plan_id}/lecciones/L1/fuentes", json={"necesita_fuentes": "conviene"})
    assert r.status_code == 200 and r.json()["necesita_fuentes"] == "conviene"
    vista = (await cliente.get(f"/api/temas/{tema_id}/plan")).json()
    assert vista["lecciones"][0]["necesita_fuentes"] == "conviene"
    assert (await cliente.patch(f"/api/planes/{plan_id}/lecciones/L1/fuentes", json={"necesita_fuentes": "x"})).status_code == 422
    assert (await cliente.patch(f"/api/planes/{plan_id}/lecciones/L9/fuentes", json={"necesita_fuentes": "no"})).status_code == 404


@pytest.mark.anyio
async def test_con_tus_apuntes_del_tema_ninguna_sale_como_no(cliente) -> None:
    from magister.datos import repositorio_fuentes as rf
    from magister.datos.fuentes import Version
    from magister.datos.sesion import nueva_sesion

    tema_id, _ = await _plan_guardado({"L1": "no"})
    async with nueva_sesion() as s:
        f = await rf.crear_fuente(s, "Apuntes del profesor", "pdf", 3)
        d = await rf.documento_o_nuevo(s, f.id, "tema1.pdf", "Tema 1", tema_id)
        s.add(Version(documento_id=d.id, crudo_hash="h", texto="x", estado="lista"))
        await s.commit()
    vista = (await cliente.get(f"/api/temas/{tema_id}/plan")).json()
    l1 = vista["lecciones"][0]
    assert l1["necesita_fuentes"] == "conviene" and l1["fuentes_por_que"] == POR_QUE_MATERIAL and l1["material_propio"]


@pytest.mark.anyio
async def test_un_plan_guardado_antes_se_lee_como_conviene(cliente) -> None:
    tema_id, _ = await _plan_guardado({})
    plan = json.loads((FIJOS / "Plan.json").read_text(encoding="utf-8"))
    assert all("necesita_fuentes" in x for x in plan["lecciones"])  # el fijo ya lo trae
    from sqlalchemy import update

    from magister.datos.plan import LeccionFila
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s, s.begin():
        await s.execute(update(LeccionFila).values(necesita_fuentes=None, fuentes_por_que=None))
    vista = (await cliente.get(f"/api/temas/{tema_id}/plan")).json()
    assert {x["necesita_fuentes"] for x in vista["lecciones"]} == {"conviene"}
    assert vista["lecciones"][0]["fuentes_por_que"] == POR_QUE_ANTIGUO
