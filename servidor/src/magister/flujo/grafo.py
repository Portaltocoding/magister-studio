"""El grafo del tutor.

 START ─> enrutar_entrada
            ├─ fase = diagnostico ─> extraer ─> ¿huecos? ─ sí ─> preguntar ─> END
            │                                      └─ no ─> planificar
            └─ fase = estudio ─────> conversar ─> END
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
from magister.flujo.nodos.guardar import guardar
from magister.flujo.nodos.negociar import explicar_fallo, negociar
from magister.flujo.nodos.planificar import planificar
from magister.flujo.nodos.preguntar import preguntar
from magister.flujo.nodos.proponer import proponer
from magister.plan.esquemas import Perfil
from magister.plan.perfil import huecos


def enrutar_entrada(estado: Estado) -> str:
    return "conversar" if estado.get("fase") == "estudio" else "extraer"


def tras_extraer(estado: Estado) -> str:
    return "preguntar" if huecos(Perfil.model_validate(estado.get("perfil") or {})) else "planificar"


def tras_salida(estado: Estado) -> str:
    return estado.get("salida", "explicar_fallo")


def construir_grafo(checkpointer: BaseCheckpointSaver | None = None) -> CompiledStateGraph:
    g = StateGraph(Estado)
    g.add_node("extraer", extraer)
    g.add_node("preguntar", preguntar)
    g.add_node("planificar", planificar)
    g.add_node("calendarizar", calendarizar)
    g.add_node("negociar", negociar)
    g.add_node("explicar_fallo", explicar_fallo)
    g.add_node("proponer", proponer, destinations=("guardar", "extraer"))
    g.add_node("guardar", guardar)
    g.add_node("conversar", conversar)

    g.add_conditional_edges(START, enrutar_entrada, ["extraer", "conversar"])
    g.add_conditional_edges("extraer", tras_extraer, ["preguntar", "planificar"])
    g.add_conditional_edges("planificar", tras_salida, ["calendarizar", "negociar", "explicar_fallo"])
    g.add_conditional_edges("calendarizar", tras_salida, ["proponer", "negociar"])
    for final in ("preguntar", "negociar", "explicar_fallo", "guardar", "conversar"):
        g.add_edge(final, END)
    return g.compile(checkpointer=checkpointer or InMemorySaver())


_grafo: CompiledStateGraph | None = None


def iniciar(checkpointer: BaseCheckpointSaver | None) -> None:
    global _grafo
    _grafo = construir_grafo(checkpointer)


def grafo() -> CompiledStateGraph:
    if _grafo is None:
        iniciar(None)
    assert _grafo is not None
    return _grafo
