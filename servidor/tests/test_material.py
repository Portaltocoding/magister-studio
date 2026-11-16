"""Parte IV sin modelo: estadística, lint, plantilla, contrato, preguntas, guion,
diapositivas, completitud, cola de trabajos y el generador con el motor eco."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from evals.estadistica import binomial_cola, kappa, kappa_ponderada, mcnemar, spearman
from magister.material.completitud_logica import nombrados, orden_ok
from magister.material.diapositivas import Diapositiva, Presentacion, auditar_diapositivas, montar_marp
from magister.material.generador import comprobar_contrato
from magister.material.guion import auditar_guion, escenas
from magister.material.modelos import ConceptoMaterial, Contrato, EntradaMaterial
from magister.material.plantillas import HuecoSinRellenar, montar, montar_apuntes
from magister.material.preguntas import auditar
from magister.tono.hallazgo import Hallazgo
from magister.tono.lint import revisar

# Estadística con los números del libro


def test_estadistica_del_libro() -> None:
    assert round(kappa([[70, 8], [14, 28]]), 3) == 0.583
    assert round(kappa_ponderada([[12, 5, 1], [4, 14, 4], [1, 5, 14]]), 3) == 0.648
    assert mcnemar(14, 6) == 3.2
    assert round(spearman([1, 2, 3, 4, 5], [2, 1, 3, 5, 4]), 2) == 0.80
    assert 0 < binomial_cola(14, 20) < 0.06


# Lint de tono


def test_lint_cada_regla() -> None:
    malo = "En estos apuntes veremos algo. Simplemente usa un embedding — y listo \U0001F600."
    reglas = {h.regla: h for h in revisar(malo)}
    assert reglas["raya"].gravedad == "veto" and reglas["raya"].cita == "—"
    assert reglas["unicode"].gravedad == "veto"
    assert reglas["metatexto"].cita == "En estos apuntes"
    assert reglas["condescendencia"].gravedad == "sospecha" and reglas["condescendencia"].cita == "Simplemente"
    assert "ingles" in reglas
    bueno = "Un embedding (representación vectorial) convierte un texto en números: así se comparan por distancia."
    assert revisar(bueno) == []


def test_lint_no_mira_citas_ni_codigo() -> None:
    assert revisar("El error dice «simplemente no compila» y `simplemente()` es una función.") == []


def test_lint_guion() -> None:
    reglas = {h.regla for h in revisar("La fórmula es x = y. Usamos MVCC (que es un mecanismo de control de versiones muy usado hoy).", "guion")}
    assert {"formula_escrita", "parentesis_largo"} <= reglas


def test_hallazgo_sin_cita_no_valida() -> None:
    with pytest.raises(ValidationError):
        Hallazgo(cita="", regla="x", gravedad="aviso")


# Plantilla y contrato


def test_plantilla_falla_con_hueco() -> None:
    with pytest.raises(HuecoSinRellenar):
        montar("{{titulo}} {{falta}}", {"titulo": "x"})
    md = montar_apuntes("Índices", "Magister · BD", "a.pdf", [{"termino": "Índice", "ingles": "index", "definicion": "Una estructura."}],
                        [("Por qué", "Texto.")], [{"enunciado": "¿Qué?", "fantasma": "Esto."}])
    assert "## Por qué {etq=" in md and "::: teoria" in md and "::: fantasma" in md and "**Índice** · *index*" in md


ENTRADA = EntradaMaterial(
    plan_id=1, leccion_clave="L1", tema="bd", titulo="Claves", objetivos=["Explicar las claves"],
    conceptos=[ConceptoMaterial(id="clave-primaria", nombre="Clave primaria"),
               ConceptoMaterial(id="clave-foranea", nombre="Clave foránea", depende_de=["clave-primaria"], nucleo=False)],
)


def contrato(asignacion: list[list[str]]) -> Contrato:
    return Contrato(razonamiento="x", definiciones=[], bloques=[
        {"clave": f"b{i + 1}", "titulo": f"T{i}", "conceptos": c, "proposito": "p"} for i, c in enumerate(asignacion)])


def test_comprobar_contrato() -> None:
    assert comprobar_contrato(contrato([["clave-primaria"], ["clave-foranea"]]), ENTRADA) == []
    errores = comprobar_contrato(contrato([["clave-foranea"], ["clave-primaria"]]), ENTRADA)
    assert errores and "antes" in errores[0]
    assert "no está asignado" in comprobar_contrato(contrato([["clave-primaria"], []]), ENTRADA)[0]


# Preguntas, guion y diapositivas


def pregunta(i: str, conceptos=("clave-primaria",), fantasma_palabras=60, donde="b1", tipo="conceptual") -> dict:
    temas = {"a": "¿Qué identifica una clave primaria?", "b": "Calcula cuántas filas devuelve este JOIN entre pedidos",
             "c": "Encuentra el fallo en este razonamiento sobre índices", "x": "Explica cuándo usarías una clave foránea"}
    return {"id": i, "conceptos": list(conceptos), "tipo": tipo, "enunciado": temas.get(i, f"Pregunta distinta número {i}"),
            "fantasma": " ".join(["palabra"] * fantasma_palabras), "donde": donde}


def test_auditoria_de_preguntas() -> None:
    buenas = [pregunta("a", tipo="conceptual"), pregunta("b", tipo="calculo"), pregunta("c", tipo="fallo")]
    assert auditar(buenas, ENTRADA, {"b1", "b2"}) == []
    malas = [pregunta("a", fantasma_palabras=10, donde="b9"), pregunta("a", conceptos=("clave-foranea",))]
    reglas = {h.regla for h in auditar(malas, ENTRADA, {"b1"})}
    assert {"id_duplicado", "donde_inexistente", "fantasma_longitud", "mezcla"} <= reglas
    assert "nucleo_sin_pregunta" in {h.regla for h in auditar([pregunta("x", conceptos=("clave-foranea",))], ENTRADA, {"b1"})}


def test_guion_por_escenas() -> None:
    texto = "[[intuicion]]\nImagina una tabla.\n[[choque]]\nSin clave se repite.\n[[nombre]]\nEs la clave primaria.\n[[teoria]]\nIdentifica cada fila."
    assert [n for n, _ in escenas(texto)] == ["intuicion", "choque", "nombre", "teoria"]
    assert auditar_guion(texto, 1) == []
    assert auditar_guion("Hola.\n" + texto, 1)[0].regla == "voz_antes"


def test_diapositivas_marp() -> None:
    p = Presentacion(diapositivas=[Diapositiva(titulo="Uno", lineas=["Una línea corta"], nota="Lo que digo."),
                                   Diapositiva(titulo="Dos", lineas=["Recurso: entidad con URL", "b"], clave="La idea.",
                                               nota="Más."),
                                   Diapositiva(titulo="Tres", lineas=["x " * 20], nota="")])
    marp = montar_marp(p, "Lección", "L2", "Tema")
    assert marp.startswith("---\nmarp: true") and "_class: portada" in marp and "###### 2" in marp
    assert "- **Recurso**: entidad con URL" in marp and "> La idea." in marp
    reglas = [h.regla for h in auditar_diapositivas(marp)]
    assert reglas == ["palabras"]


def test_completitud_determinista() -> None:
    conceptos = [c.model_dump() for c in ENTRADA.conceptos]
    texto = "La clave primaria identifica la fila. Después, la clave foránea apunta a otra tabla."
    pos = nombrados(texto, conceptos)
    assert pos["clave-primaria"] < pos["clave-foranea"]
    assert all(orden_ok(pos, conceptos, set()).values())
    al_reves = nombrados("La clave foránea va antes que la clave primaria.", conceptos)
    assert orden_ok(al_reves, conceptos, set())["clave-foranea"] is False


# Cola de trabajos y generador (con la base de pruebas y el motor eco)

pytestmark = pytest.mark.anyio
FIJOS = Path(__file__).parent / "fijos"


async def plan_aceptado() -> int:
    from magister.datos.plan import guardar_plan

    plan = json.loads((FIJOS / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((FIJOS / "Perfil.json").read_text(encoding="utf-8"))
    _, plan_id = await guardar_plan("bases de datos", None, perfil, plan, [], "x", "eco")
    return plan_id


async def test_cola_idempotente_y_sin_dobles(base) -> None:
    from magister.trabajos import cola

    a = await cola.encolar("material", None, None, {}, "clave-1")
    b = await cola.encolar("material", None, None, {}, "clave-1")
    assert a == (a[0], True) and b == (a[0], False)
    uno = await cola.coger("t1")
    dos = await cola.coger("t2")
    assert uno is not None and uno.id == a[0] and dos is None


async def test_trabajo_de_leccion_borrada_falla_sin_reintentos(base) -> None:
    from magister.trabajos import cola
    from magister.trabajos.trabajador import ejecutar_uno

    tid, _ = await cola.encolar("material", 999, "L1", {"tipos": ["apuntes"]}, "clave-2")
    assert await ejecutar_uno("t1")
    t = await cola.leer(tid)
    assert t["estado"] == "fallido" and t["intentos"] == 1 and "no existe" in t["error"]


async def test_generador_con_eco_y_reanudar(base, monkeypatch, tmp_path) -> None:
    from magister.cerebro.estructura import eco
    from magister.config import ajustes
    from magister.material import almacen
    from magister.material.entrada import entrada_de_leccion
    from magister.material.generador import generar_apuntes

    monkeypatch.setattr(ajustes, "salidas", str(tmp_path))
    plan_id = await plan_aceptado()
    eco.vaciar()
    eco.encolar(Contrato, [{"razonamiento": "orden", "definiciones": [{"termino": "Clave", "ingles": None, "definicion": "x"}],
                            "bloques": [{"clave": "b1", "titulo": "Claves", "conceptos": ["clave-primaria", "clave-foranea"], "proposito": "p"},
                                        {"clave": "b2", "titulo": "Más", "conceptos": [], "proposito": "p"}]}])
    entrada = await entrada_de_leccion(plan_id, "L1")
    mid = await almacen.nuevo_material(plan_id, "L1", "apuntes", None)

    llamadas = {"n": 0}

    async def fallar_en_b2(nodo, paso, total):
        if nodo == "escribir" and paso == 1 and llamadas["n"] == 0:
            llamadas["n"] += 1
            raise RuntimeError("se cae a mitad")

    with pytest.raises(RuntimeError):
        await generar_apuntes(mid, entrada, fallar_en_b2)
    assert [b.clave for b in await almacen.bloques(mid)] == ["b1"]
    final = await generar_apuntes(mid, entrada)
    assert [b.clave for b in await almacen.bloques(mid)] == ["b1", "b2"]
    m = await almacen.material(mid)
    assert "## Claves {" in m.texto and "::: capitulo" in m.texto and m.estado in ("listo", "revisar")
    assert final["contrato"]["bloques"][0]["clave"] == "b1"
    eco.vaciar()
