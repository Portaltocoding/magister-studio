import pytest
from langgraph.checkpoint.memory import InMemorySaver

from magister.cerebro.citas import comprobar
from magister.cerebro.contratos import BuscadorFalso
from magister.flujo.grafo import construir_grafo
from magister.flujo.nodos.rag import necesita_reescritura

pytestmark = pytest.mark.anyio


async def correr(g, entrada, hilo="1"):
    nodos, textos, extra = [], [], {}
    async for modo, datos in g.astream(entrada, {"configurable": {"thread_id": hilo}}, stream_mode=["custom", "updates"]):
        if modo == "custom":
            if "fase" in datos:
                nodos.append(datos["fase"])
            elif "t" in datos:
                textos.append(datos["t"])
            elif "citas" in datos:
                extra = datos
    return nodos, "".join(textos), extra


def estudio(mensaje, turnos=None):
    turnos = turnos or [{"rol": "usuario", "contenido": mensaje}]
    return {"conversacion_id": None, "fase": "estudio", "hoy": "2026-11-09", "mensaje": mensaje, "turnos": turnos}


async def test_rama_de_estudio_recupera_y_responde() -> None:
    b = BuscadorFalso()
    nodos, texto, extra = await correr(construir_grafo(InMemorySaver(), b), estudio("qué es una clave primaria"))
    assert nodos == ["recuperar", "responder"]
    assert b.consultas == ["qué es una clave primaria"]
    assert texto == "Eco: qué es una clave primaria "
    assert extra["citas"] == [] and extra["sin_fuentes"] is False


async def test_sin_fuentes_lo_dice() -> None:
    nodos, texto, extra = await correr(construir_grafo(InMemorySaver(), BuscadorFalso(vacio=True)), estudio("qué es TCP"))
    # El aviso ya no va como texto delante: la pantalla lo marca con una etiqueta.
    assert not texto.startswith("_No lo encuentro") and texto.startswith("Eco:")
    assert extra["sin_fuentes"] is True


async def test_mensaje_dependiente_sin_contexto_aclara() -> None:
    from magister.cerebro.estructura import eco
    from magister.flujo.nodos.rag import Reescritura

    eco.encolar(Reescritura, [{"autonoma": False, "consulta": None, "aclaracion": "¿Qué es «eso»?"}])
    nodos, texto, _ = await correr(construir_grafo(InMemorySaver(), BuscadorFalso()), estudio("¿y eso?"))
    assert nodos == ["reescribir", "aclarar"] and texto == "¿Qué es «eso»?"


async def test_reescritura_con_historial() -> None:
    from magister.cerebro.estructura import eco
    from magister.flujo.nodos.rag import Reescritura

    eco.encolar(Reescritura, [{"autonoma": False, "consulta": "índices parciales en Postgres", "aclaracion": None}])
    b = BuscadorFalso()
    turnos = [{"rol": "usuario", "contenido": "háblame de índices"}, {"rol": "tutor", "contenido": "Vale."},
              {"rol": "usuario", "contenido": "¿y los parciales?"}]
    nodos, _, _ = await correr(construir_grafo(InMemorySaver(), b), estudio("¿y los parciales?", turnos))
    assert nodos[:2] == ["reescribir", "recuperar"] and b.consultas == ["índices parciales en Postgres"]


def test_regla_barata_de_reescritura() -> None:
    assert necesita_reescritura("¿y los parciales?", True)
    assert necesita_reescritura("explícame eso", False)
    assert not necesita_reescritura("Qué es una clave primaria en una tabla relacional", True)


def test_citas_comprobadas() -> None:
    fragmentos = {101: "Una clave primaria identifica cada fila de una tabla. Además no admite nulos."}
    citas = comprobar("La clave primaria identifica cada fila [101]. El cielo es azul [999].", fragmentos)
    por_id = {c.fragmento_id: c for c in citas}
    assert not por_id[101].dudosa and "identifica cada fila" in por_id[101].cita_literal
    assert por_id[999].dudosa
    otra = comprobar("Los gatos maúllan por la noche [101].", fragmentos)
    assert otra[0].dudosa


def test_intencion_de_plan() -> None:
    from magister.flujo.intencion import deja_plan, pide_plan

    for si in ("y podemos hacer un plan con ello un research organizarlo en el calendario y demás?", "hazme un roadmap",
               "quiero un plan de estudio para esto", "organízalo en el calendario", "un plan para 3 meses"):
        assert pide_plan(si), si
    for no in ("¿qué es un plan de ejecución en Postgres?", "explícame el calendario juliano", "hola",
               "quiero que me expliques fisica de fluidos en plan rapido bernoulli y demas",
               "quiero entender el plan de pensiones", "explícame esto en plan sencillo"):
        assert not pide_plan(no), no
    assert pide_plan("explícamelo y luego hazme un plan de estudio")
    assert deja_plan("déjalo, mejor otra cosa") and not deja_plan("sigue")
    assert deja_plan("No quiero un plan, explícamelo ya")


async def test_estudio_pasa_al_plan_y_vuelve() -> None:
    from langgraph.types import Command

    from magister.cerebro.estructura import eco
    from magister.plan.esquemas import Perfil, Plan

    g = construir_grafo(InMemorySaver(), BuscadorFalso())
    turnos = [{"rol": "usuario", "contenido": "conceptos de un fullstack senior"}, {"rol": "tutor", "contenido": "..."},
              {"rol": "usuario", "contenido": "¿podemos hacer un plan con ello?"}]
    eco.encolar(Perfil, [{"tema": "fullstack senior"}])
    nodos, texto, _ = await correr(g, estudio("¿podemos hacer un plan con ello?", turnos), "p")
    assert nodos == ["a_diagnostico", "extraer", "preguntar"] and texto
    # La siguiente respuesta sigue en el diagnóstico (no vuelve a estudio) y acaba en propuesta.
    eco.encolar(Plan, ["plan_ok.json"])
    nodos, _, _ = await correr(g, {"mensaje": "1,5 h entre semana, sin fecha", "turnos": turnos, "hoy": "2026-11-09"}, "p")
    assert nodos[:2] == ["extraer", "planificar"]
    estado = await g.aget_state({"configurable": {"thread_id": "p"}})
    assert any(t.interrupts for t in estado.tasks)
    # Dejarlo vuelve a estudio.
    g2 = construir_grafo(InMemorySaver(), BuscadorFalso())
    eco.encolar(Perfil, [{"tema": "x"}])
    await correr(g2, estudio("hazme un plan", None), "q")
    previos = [{"rol": "usuario", "contenido": "explícame los índices"}, {"rol": "tutor", "contenido": "¿Para qué lo quieres?"},
               {"rol": "usuario", "contenido": "déjalo"}]
    nodos, texto, _ = await correr(g2, {"mensaje": "déjalo", "turnos": previos, "hoy": "2026-11-09"}, "q")
    # Deja el plan y sigue con la explicación en el mismo turno.
    assert texto.startswith("Vale, sin plan") and "responder" in nodos
    nodos, _, _ = await correr(g2, {"mensaje": "qué es un índice", "turnos": [{"rol": "usuario", "contenido": "qué es un índice"}],
                                    "hoy": "2026-11-09"}, "q")
    assert nodos == ["recuperar", "responder"]
    _ = Command


async def test_el_diagnostico_ofrece_opciones() -> None:
    from magister.cerebro.estructura import eco
    from magister.plan.esquemas import Perfil

    g = construir_grafo(InMemorySaver(), BuscadorFalso())
    eco.encolar(Perfil, [{"tema": "redes"}])
    vistas = []
    async for modo, datos in g.astream(estudio("hazme un plan de redes"), {"configurable": {"thread_id": "o"}},
                                       stream_mode=["custom", "updates"]):
        if modo == "custom" and "opciones" in datos:
            vistas.append(datos["opciones"])
    assert vistas and vistas[0]["campo"] == "objetivo" and len(vistas[0]["opciones"]) == 5
    # La última siempre es la salida: no quiero un plan.
    assert vistas[0]["opciones"][-1]["valor"].startswith("No quiero un plan")


def test_las_preferencias_llegan_a_los_prompts() -> None:
    from magister.material.preferencias import rango, texto, texto_preguntas

    assert "A fondo" in texto({"profundidad": "fondo", "enfoque": "en TypeScript"}) and "TypeScript" in texto({"enfoque": "TypeScript"})
    assert "Entre 4 y 6" in texto_preguntas({"cantidad": "pocas", "preguntas": "practicas"}) and rango({}) == (6, 10)
