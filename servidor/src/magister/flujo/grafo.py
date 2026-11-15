"""El grafo del tutor.

 START ─> enrutar_entrada
            ├─ fase = diagnostico ─> extraer ─> ¿huecos? ─ sí ─> preguntar ─> END
            │                                      └─ no ─> planificar
            └─ fase = estudio ─────> reescribir ─> recuperar ─> responder ─> END
                                               └─ no se puede ─> aclarar ─> END
 planificar ─ válido ─> calendarizar ─> proponer (interrupt) ─ aceptar ─> guardar ─> END
           ├─ solo capacidad ─> negociar ─> END             └─ cambiar ─> extraer
           └─ otra regla ─────> explicar_fallo ─> END
"""

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from magister.flujo.estado import Estado
from magister.flujo.nodos.calendarizar import calendarizar
from magister.flujo.nodos.conversar import conversar
from magister.flujo.nodos.extraer import extraer
from magister.cerebro.contratos import Buscador
from magister.flujo.nodos.guardar import hacer_guardar
from magister.flujo.nodos.negociar import explicar_fallo, negociar
from magister.flujo.nodos.planificar import hacer_planificar
from magister.flujo.nodos.preguntar import preguntar
from magister.flujo.nodos.proponer import proponer
from magister.flujo.nodos.rag import aclarar, hacer_recuperar, reescribir, responder, tras_reescribir
from magister.flujo.comun import decir, fase
from magister.flujo.intencion import deja_plan, pide_plan
from magister.plan.esquemas import Perfil
from magister.plan.perfil import huecos


def enrutar_entrada(estado: Estado) -> str:
    """Estudio libre que pide un plan pasa al diagnóstico; un diagnóstico que se deja vuelve a estudio."""
    mensaje = estado.get("mensaje", "")
    if estado.get("fase") == "estudio":
        return "a_diagnostico" if pide_plan(mensaje) else "estudio"
    if deja_plan(mensaje):
        return "a_estudio"
    return "extraer"


async def a_diagnostico(estado: Estado) -> dict:
    fase("a_diagnostico")
    return {"fase": "diagnostico", "plan": None, "sesiones": []}


async def a_estudio(estado: Estado) -> dict:
    decir("Vale, dejamos el plan. Seguimos con lo que quieras.")
    return {"fase": "estudio"}


def tras_extraer(estado: Estado) -> str:
    return "preguntar" if huecos(Perfil.model_validate(estado.get("perfil") or {})) else "planificar"


def tras_salida(estado: Estado) -> str:
    return estado.get("salida", "explicar_fallo")


def construir_grafo(
    checkpointer: BaseCheckpointSaver | None = None, buscador: Buscador | None = None
) -> CompiledStateGraph:
    """Con `buscador`, la rama de estudio es reescribir, recuperar y responder con citas;
    sin él (pruebas antiguas), `conversar` sin fuentes."""
    g = StateGraph(Estado)
    g.add_node("extraer", extraer)
    g.add_node("preguntar", preguntar)
    g.add_node("planificar", hacer_planificar(buscador))
    g.add_node("calendarizar", calendarizar)
    g.add_node("negociar", negociar)
    g.add_node("explicar_fallo", explicar_fallo)
    g.add_node("proponer", proponer, destinations=("guardar", "extraer"))
    g.add_node("guardar", hacer_guardar(buscador))
    g.add_node("a_diagnostico", a_diagnostico)
    g.add_node("a_estudio", a_estudio)
    g.add_edge("a_diagnostico", "extraer")
    finales = ["preguntar", "negociar", "explicar_fallo", "guardar", "a_estudio"]
    if buscador is None:
        g.add_node("conversar", conversar)
        g.add_conditional_edges(START, enrutar_entrada, {"extraer": "extraer", "estudio": "conversar",
                                                         "a_diagnostico": "a_diagnostico", "a_estudio": "a_estudio"})
        finales.append("conversar")
    else:
        g.add_node("reescribir", reescribir)
        g.add_node("aclarar", aclarar)
        g.add_node("recuperar", hacer_recuperar(buscador))
        g.add_node("responder", responder)
        g.add_conditional_edges(START, enrutar_entrada, {"extraer": "extraer", "estudio": "reescribir",
                                                         "a_diagnostico": "a_diagnostico", "a_estudio": "a_estudio"})
        g.add_conditional_edges("reescribir", tras_reescribir, ["aclarar", "recuperar"])
        g.add_edge("recuperar", "responder")
        finales += ["aclarar", "responder"]
    g.add_conditional_edges("extraer", tras_extraer, ["preguntar", "planificar"])
    g.add_conditional_edges("planificar", tras_salida, ["calendarizar", "negociar", "explicar_fallo"])
    g.add_conditional_edges("calendarizar", tras_salida, ["proponer", "negociar"])
    for final in finales:
        g.add_edge(final, END)
    return g.compile(checkpointer=checkpointer or InMemorySaver())


_grafo: CompiledStateGraph | None = None


def iniciar(checkpointer: BaseCheckpointSaver | None, buscador: Buscador | None = None) -> None:
    global _grafo
    _grafo = construir_grafo(checkpointer, buscador)


def grafo() -> CompiledStateGraph:
    if _grafo is None:
        iniciar(None)
    assert _grafo is not None
    return _grafo
