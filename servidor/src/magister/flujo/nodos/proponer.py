from langgraph.types import Command, interrupt

from magister.flujo.comun import ahora_de, hoy_de, perfil_de
from magister.flujo.estado import Estado
from magister.flujo.nodos.calendarizar import propuesta, reglas_calendario
from magister.plan.calendario import NoCabe, a_hora
from magister.plan.calendario import calendarizar as repartir
from magister.plan.esquemas import Plan


def _al_dia(estado: Estado) -> Command:
    """Aceptar. Si la propuesta es de otro día, o tiene sesiones hoy y ya es otra hora (propuesto a las 17:00 y
    aceptado a las 20:50), el calendario se vuelve a calcular desde ahora (puro, sin efectos)."""
    sesiones = estado.get("sesiones") or []
    hoy = hoy_de(estado)
    ahora = ahora_de(estado)
    hay_hoy = ahora is not None and any(x["fecha"] == hoy.isoformat() for x in sesiones)
    if not sesiones or (min(x["fecha"] for x in sesiones) >= hoy.isoformat() and not hay_hoy):
        return Command(goto="guardar")
    perfil = perfil_de(estado)
    plan = Plan.model_validate(estado["plan"])
    inicios = [a_hora(h) for h in (perfil.inicio_por_dia or [None] * 7)]
    resultado = repartir(plan, perfil.horas_por_dia or [0] * 7, inicios, hoy, perfil.plazo, {}, reglas_calendario(),
                         ahora=ahora)
    if isinstance(resultado, NoCabe):
        return Command(goto="negociar", update={"necesarias": plan.total_horas, "sesiones": []})
    return Command(goto="guardar", update={"sesiones": [s.a_dict() for s in resultado.sesiones]})


async def proponer(estado: Estado) -> Command:
    # Nada con efectos antes de interrupt: al reanudar, el nodo se ejecuta desde el principio.
    decision = interrupt(propuesta(estado))
    if isinstance(decision, dict) and decision.get("accion") == "aceptar":
        return _al_dia(estado)
    if isinstance(decision, dict) and decision.get("accion") == "descartar":
        # «Ahora no»: sin plan y de vuelta a estudio. Con texto se contesta a ese texto; con el botón no hay pregunta.
        return Command(goto="a_estudio", update={"fase": "estudio", "plan": None, "sesiones": [],
                                                 "mensaje": decision.get("texto") or ""})
    texto = (decision or {}).get("texto") or "Quiero cambiar algo del plan."
    return Command(goto="extraer", update={"mensaje": texto, "plan": None, "sesiones": []})
