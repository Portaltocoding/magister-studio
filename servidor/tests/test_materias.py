"""Perfiles de explicación por materia: la elección por reglas y por modelo, dónde se guarda y que solo entra el que toca."""

import json
from pathlib import Path

import pytest

from magister.cerebro import materias, prompts
from magister.cerebro.estructura import eco

pytestmark = pytest.mark.anyio
FIJOS = Path(__file__).parent / "fijos"


@pytest.mark.parametrize("nombre, esperado", [
    ("Topografía", "exactas"),
    ("Estadística", "exactas"),
    ("Cálculo diferencial", "exactas"),
    ("Derecho civil", "derecho"),
    ("Derecho de obligaciones y contratos", "derecho"),
    ("Filosofía moderna", "filosofia"),
    ("Ética de Kant", "filosofia"),
    ("Bases de datos", "programacion"),
    ("Python desde cero", "programacion"),
    ("Biología celular", "experimentales"),
    ("Química orgánica", "experimentales"),
    ("Historia contemporánea de España", "historia"),
])
def test_las_reglas_clasifican_temas_tipicos(nombre, esperado) -> None:
    assert materias.por_reglas(nombre, []) == esperado


def test_las_lecciones_ayudan_cuando_el_nombre_no_basta() -> None:
    assert materias.por_reglas("Apuntes de la carrera", []) is None
    assert materias.por_reglas("Apuntes de la carrera", ["Derecho civil: obligaciones", "Contratos", "Prescripción"]) == "derecho"
    assert materias.por_reglas("Examen final", ["Trigonometría", "Geometría analítica", "Derivadas"]) == "exactas"
    assert materias.por_reglas("Examen final", ["Una derivada", "Un contrato"]) is None  # una pista de cada: no hay ganador


def test_si_no_queda_claro_las_reglas_no_deciden() -> None:
    assert materias.por_reglas("Cocina", []) is None
    assert materias.por_reglas("Historia de la filosofía", []) is None  # empate: que decida el modelo
    assert materias.por_reglas("Guerra civil española", []) is None  # «civil» no es derecho aquí


def test_una_palabra_corta_solo_cuenta_entera() -> None:
    assert materias.por_reglas("Gitanos de Granada", []) is None  # «git» dentro de «gitanos» no es programación
    assert materias.por_reglas("Git y GitHub con SQL", []) == "programacion"


async def test_el_modelo_decide_solo_si_las_reglas_no_pueden() -> None:
    eco.vaciar()
    eco.encolar(materias.Eleccion, [{"motivo": "arte", "perfil": "historia"}])
    assert await materias.elegir("Historia de la filosofía", []) == "historia"
    eco.vaciar()  # con un tema claro no se gasta la llamada: si la hiciera, fallaría por no haber fijo
    assert await materias.elegir("Derecho civil", []) == "derecho"


async def test_si_el_modelo_falla_no_se_decide_nada() -> None:
    eco.vaciar()
    eco.encolar(materias.Eleccion, [{"perfil": "inventado"}] * 5)
    assert await materias.por_modelo("Cocina", []) is None


def test_todos_los_perfiles_existen_y_no_llevan_llaves() -> None:
    assert set(materias.DESCRIPCIONES) == set(materias.PERFILES)
    for perfil in materias.PERFILES:
        t = prompts.materia(perfil).texto
        assert t and "{" not in t and "}" not in t, perfil
    with pytest.raises(prompts.ErrorPlantilla):
        prompts.materia("../respuesta")


def test_el_texto_del_perfil_solo_entra_si_hay_perfil() -> None:
    assert materias.texto(None) == "" and materias.texto("no_existe") == ""
    assert "norma" in materias.texto("derecho") and "premisas" in materias.texto("filosofia")
    assert materias.texto("derecho") != materias.texto("filosofia")


def test_respuesta_ya_no_lleva_lo_de_cada_materia() -> None:
    for nombre in ("responder", "conversar"):
        t = prompts._del_fichero(nombre).texto
        assert "Ciencia y matemáticas" not in t and "Historia, derecho" not in t


async def test_el_tutor_lleva_el_perfil_del_tema_de_la_conversacion(cliente) -> None:
    from magister.flujo.comun import sistema_de_estudio

    tid = (await cliente.post("/api/temas", json={"nombre": "Derecho civil"})).json()["id"]
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "x", "tema_id": tid})).json()["id"]
    sistema = await sistema_de_estudio("BASE", {"conversacion_id": cid})
    assert materias.texto("derecho") in sistema
    assert materias.texto("filosofia") not in sistema
    # Se guardó en el tema: la segunda vez no hace falta elegir otra vez.
    assert [t for t in (await cliente.get("/api/temas")).json() if t["id"] == tid][0]["materia"] == "derecho"


async def test_sin_tema_ni_pista_todo_sigue_como_antes(cliente) -> None:
    from magister.flujo.comun import sistema_de_estudio

    from magister.flujo.comun import IDIOMA_ESPANOL

    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Una duda"})).json()["id"]
    # Sin tema ni pista, solo las preferencias de siempre: con español elegido (lo de serie), la línea del idioma.
    con_conversacion = await sistema_de_estudio("BASE", {"conversacion_id": cid})
    assert con_conversacion.startswith("BASE\n\n") and con_conversacion.endswith("- " + IDIOMA_ESPANOL)
    assert con_conversacion.count("\n\n") == 1
    assert await sistema_de_estudio("BASE", {}) == "BASE"


async def test_una_charla_libre_se_clasifica_por_su_titulo_sin_guardar_nada(cliente) -> None:
    from magister.flujo.comun import sistema_de_estudio

    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Explícame el cogito de Descartes"})).json()["id"]
    assert materias.texto("filosofia") in await sistema_de_estudio("BASE", {"conversacion_id": cid})


async def test_ni_la_llamada_ni_el_asesor_llevan_perfil(cliente) -> None:
    from magister.flujo.comun import sistema_de_estudio

    tid = (await cliente.post("/api/temas", json={"nombre": "Derecho civil"})).json()["id"]
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "x", "tema_id": tid})).json()["id"]
    for extra in ({"llamada": True}, {"asesor": True}, {"voz": True}):
        assert materias.texto("derecho") not in await sistema_de_estudio("BASE", {"conversacion_id": cid, **extra})


async def test_se_cambia_a_mano_por_la_api(cliente) -> None:
    tid = (await cliente.post("/api/temas", json={"nombre": "Bases de datos"})).json()["id"]
    assert (await cliente.get("/api/materias")).json()[0]["id"] == "general"
    r = await cliente.put(f"/api/temas/{tid}/materia", json={"materia": "exactas"})
    assert r.status_code == 200 and r.json()["materia"] == "exactas"
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "x", "tema_id": tid})).json()["id"]
    from magister.flujo.comun import sistema_de_estudio

    assert materias.texto("exactas") in await sistema_de_estudio("BASE", {"conversacion_id": cid})
    assert (await cliente.put(f"/api/temas/{tid}/materia", json={"materia": "alquimia"})).status_code == 422
    assert (await cliente.put("/api/temas/999/materia", json={"materia": "derecho"})).status_code == 404
    assert (await cliente.put(f"/api/temas/{tid}/materia", json={"materia": None})).json()["materia"] is None


async def test_los_apuntes_y_el_guion_llevan_el_perfil(base, monkeypatch) -> None:
    from magister.datos.plan import guardar_plan
    from magister.material import guion
    from magister.material.entrada import entrada_de_leccion
    from magister.material.preferencias import texto

    plan = json.loads((FIJOS / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((FIJOS / "Perfil.json").read_text(encoding="utf-8"))
    _, plan_id = await guardar_plan("bases de datos", None, perfil, plan, [], "x", "eco")
    clave = plan["lecciones"][0]["clave"]
    entrada = await entrada_de_leccion(plan_id, clave)
    assert entrada.materia == "programacion"
    assert materias.texto("programacion") in texto({"materia": entrada.materia})
    assert materias.texto("programacion") not in texto({})  # sin perfil, como antes
    assert texto({"materia": None}) == texto({})

    vistos = []

    async def falso(sistema, turnos):
        vistos.append(sistema)
        yield "[[intuicion]]\nHola."

    monkeypatch.setattr(guion, "generar", falso)
    await guion.generar_guion(entrada, "apuntes", 2)
    await guion.generar_guion(entrada.model_copy(update={"materia": None}), "apuntes", 2)
    assert materias.texto("programacion") in vistos[0] and "Cómo se explica esta materia" not in vistos[1]
