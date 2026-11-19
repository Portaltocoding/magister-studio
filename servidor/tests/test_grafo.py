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


async def test_un_plan_nuevo_no_hereda_el_perfil_del_anterior() -> None:
    """Tras aceptar un plan (fase estudio con el perfil completo en el checkpoint), pedir otro vuelve a preguntar."""
    g = construir_grafo(InMemorySaver())
    completo = eco.siguiente(Perfil)  # el perfil del plan anterior: tema, horas, nivel y plazo
    e = {"conversacion_id": None, "fase": "estudio", "hoy": HOY, "mensaje": "hazme un plan de React", "turnos": [],
         "perfil": completo}
    # Sin extracción válida, extraer se queda con lo que había: el perfil viejo planificaría sin preguntar.
    eco.encolar(Perfil, ["no_existe.json"] * 20)
    nodos, _, inter, valores = await correr(g, e)
    assert nodos == ["a_diagnostico", "extraer", "preguntar"] and not inter
    assert valores["perfil"] != completo


async def test_ahora_no_descarta_la_propuesta_y_vuelve_a_estudio() -> None:
    g = construir_grafo(InMemorySaver())
    eco.encolar(Plan, ["plan_ok.json"])
    _, _, inter, _ = await correr(g, entrada())
    assert inter
    nodos, texto, inter2, valores = await correr(g, Command(resume={"accion": "descartar"}))
    # Con el botón no hay pregunta que contestar: dice que sigue sin plan y termina, sin responder a un mensaje viejo.
    assert texto.startswith("Vale, sin plan") and not inter2
    assert "extraer" not in nodos and not any(n in nodos for n in ("conversar", "responder"))
    assert valores["fase"] == "estudio" and valores["plan"] is None
    estado = await g.aget_state({"configurable": {"thread_id": "1"}})
    assert not any(t.interrupts for t in estado.tasks) and not estado.next


async def test_dejarlo_por_escrito_descarta_y_contesta() -> None:
    g = construir_grafo(InMemorySaver())
    eco.encolar(Plan, ["plan_ok.json"])
    await correr(g, entrada())
    turnos = [{"rol": "usuario", "contenido": "déjalo, explícame los joins"}]
    _, texto, inter, valores = await correr(g, Command(resume={"accion": "descartar", "texto": "déjalo, explícame los joins"},
                                                       update={"turnos": turnos}))
    assert texto.startswith("Vale, sin plan. Vamos con ello.") and "Eco:" in texto and not inter
    assert valores["fase"] == "estudio"


def test_con_un_plan_delante_solo_lo_descarta_quien_lo_rechaza() -> None:
    from magister.flujo.intencion import rechaza_plan

    assert all(rechaza_plan(t) for t in ("déjalo", "ahora no, gracias", "no quiero plan", "mejor otra cosa"))
    # Preguntar por el plan o pedir un cambio no lo tira.
    assert not any(rechaza_plan(t) for t in ("explícame por qué L2 va antes que L1", "hazlo más corto", "quita los domingos"))


async def test_aceptar_otro_dia_recalcula_desde_hoy(monkeypatch) -> None:
    """Propuesto el 09-11 y aceptado el 12-11: se guarda el calendario desde el 12, sin volver a preguntar."""
    from magister.flujo.nodos import guardar as nodo_guardar

    guardado: dict = {}

    async def falso_guardar_plan(tema, cid, perfil, plan, sesiones, version_prompt, modelo, emparejar=None):
        guardado["sesiones"] = sesiones
        return 1, 1

    async def sin_apoyo(*_):
        return None

    monkeypatch.setattr(nodo_guardar, "guardar_plan", falso_guardar_plan)
    monkeypatch.setattr(nodo_guardar, "calcular_apoyo", sin_apoyo)
    monkeypatch.setattr(nodo_guardar, "recolocar_con_progreso", sin_apoyo)
    g = construir_grafo(InMemorySaver())
    eco.encolar(Plan, ["plan_ok.json"])
    _, _, inter, _ = await correr(g, entrada())
    assert inter and inter[0]["sesiones"][0]["fecha"] == HOY
    nodos, _, inter2, _ = await correr(g, Command(resume={"accion": "aceptar"}, update={"hoy": "2026-11-12"}))
    assert nodos == ["guardar"] and not inter2
    fechas = [x["fecha"] for x in guardado["sesiones"]]
    assert min(fechas) == "2026-11-12"
    assert abs(sum(x["horas"] for x in guardado["sesiones"]) - 12) < 0.05
