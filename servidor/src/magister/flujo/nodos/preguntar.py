from magister.cerebro.modelo import Turno
from magister.cerebro.prompts import cargar
from magister.flujo.comun import fase, hablar, hoy_de, perfil_de, perfil_json, turnos_recientes
from magister.flujo.estado import Estado
from magister.plan.perfil import huecos


async def preguntar(estado: Estado) -> dict:
    fase("preguntar")
    perfil = perfil_de(estado)
    sistema = cargar("diagnostico").rellenar(
        perfil=perfil_json(perfil),
        huecos=", ".join(huecos(perfil)),
        turnos=turnos_recientes(estado),
        mensaje=estado.get("mensaje", ""),
        hoy=hoy_de(estado).isoformat(),
    )
    await hablar(sistema, [Turno("usuario", "Escribe tu siguiente turno para el alumno.")])
    return {}
