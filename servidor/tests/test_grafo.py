import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from magister.cerebro.estructura import eco
from magister.flujo.grafo import construir_grafo
from magister.plan.esquemas import Perfil, Plan

pytestmark = pytest.mark.anyio

HOY = "2026-11-09"


@pytest.fixture(autouse=True)
def cola_limpia():
    eco.vaciar()
    yield
    eco.vaciar()


async def correr(g, entrada, hilo="1"):
    nodos, textos, interrupciones = [], [], []
    config = {"configurable": {"thread_id": hilo}}
    async for modo, datos in g.astream(entrada, config, stream_mode=["custom", "updates"]):
        if modo == "custom" and "fase" in datos:
            nodos.append(datos["fase"])
        elif modo == "custom" and "t" in datos:
            textos.append(datos["t"])
        elif modo == "updates" and "__interrupt__" in datos:
            interrupciones += [i.value for i in datos["__interrupt__"]]
    return nodos, "".join(textos), interrupciones, (await g.aget_state(config)).values


def entrada(mensaje="quiero aprender bases de datos"):
    return {"conversacion_id": None, "fase": "diagnostico", "hoy": HOY, "mensaje": mensaje, "turnos": []}


async def test_a_perfil_a_medias_pregunta() -> None:
    eco.encolar(Perfil, [{"tema": "redes"}])
    nodos, texto, _, _ = await correr(construir_grafo(InMemorySaver()), entrada())
    assert nodos == ["extraer", "preguntar"]
    assert texto


async def test_b_reintento_por_exceso_y_propone() -> None:
    eco.encolar(Plan, ["plan_medido.json", "plan_ok.json"])
    nodos, _, inter, valores = await correr(construir_grafo(InMemorySaver()), entrada())
    assert nodos == ["extraer", "planificar", "calendarizar"]
    assert valores["intentos"] == 2
    assert valores["errores"] == ["33 h para un presupuesto de 28,7 h"]
    assert inter and inter[0]["total_horas"] == 12 and inter[0]["fin"] == "2026-11-18"


async def test_c_tres_excesos_negocia() -> None:
    eco.encolar(Plan, ["plan_medido.json"] * 3)
    nodos, _, inter, _ = await correr(construir_grafo(InMemorySaver()), entrada())
    assert nodos == ["extraer", "planificar", "negociar"]
    assert not inter


async def test_d_leccion_demasiado_larga_explica_fallo() -> None:
    eco.encolar(Plan, ["plan_leccion_9h.json"] * 3)
    nodos, _, _, _ = await correr(construir_grafo(InMemorySaver()), entrada())
    assert nodos[-1] == "explicar_fallo"


async def test_e_pausa_y_cambio_vuelve_a_extraer() -> None:
    g = construir_grafo(InMemorySaver())
    eco.encolar(Plan, ["plan_ok.json"])
    _, _, inter, _ = await correr(g, entrada())
    assert inter
    nodos, _, inter2, _ = await correr(g, Command(resume={"accion": "cambiar", "texto": "menos horas"}))
    assert nodos[:2] == ["extraer", "planificar"]
    assert inter2


async def test_estudio_conversa() -> None:
    e = {"conversacion_id": None, "fase": "estudio", "hoy": HOY, "mensaje": "hola", "turnos": [
        {"rol": "usuario", "contenido": "hola tutor"}]}
    nodos, texto, _, _ = await correr(construir_grafo(InMemorySaver()), e)
    assert texto == "Eco: hola tutor "
