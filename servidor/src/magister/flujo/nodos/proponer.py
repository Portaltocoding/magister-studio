from langgraph.types import Command, interrupt

from magister.flujo.estado import Estado
from magister.flujo.nodos.calendarizar import propuesta


async def proponer(estado: Estado) -> Command:
    # Nada con efectos antes de interrupt: al reanudar, el nodo se ejecuta desde el principio.
    decision = interrupt(propuesta(estado))
    if isinstance(decision, dict) and decision.get("accion") == "aceptar":
        return Command(goto="guardar")
    if isinstance(decision, dict) and decision.get("accion") == "descartar":
        # «Ahora no»: sin plan y de vuelta a estudio. Con texto se contesta a ese texto; con el botón no hay pregunta.
        return Command(goto="a_estudio", update={"fase": "estudio", "plan": None, "sesiones": [],
                                                 "mensaje": decision.get("texto") or ""})
    texto = (decision or {}).get("texto") or "Quiero cambiar algo del plan."
    return Command(goto="extraer", update={"mensaje": texto, "plan": None, "sesiones": []})
