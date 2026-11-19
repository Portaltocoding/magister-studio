from magister.cerebro.modelo import Turno
from magister.cerebro.prompts import cargar
from magister.flujo.comun import fase, hablar, hoy_de, perfil_de, perfil_json, reglas_plan
from magister.flujo.estado import Estado
from magister.plan.reglas import fmt, presupuesto


async def negociar(estado: Estado) -> dict:
    fase("negociar")
    perfil = perfil_de(estado)
    tope = presupuesto(perfil, hoy_de(estado), reglas_plan().holgura)
    necesarias = estado.get("necesarias", 0)
    sistema = cargar("negociar").rellenar(
        # Con coma decimal, como las dirá al alumno («2,5 h», no «2.5 h»).
        perfil=perfil_json(perfil), necesarias=fmt(necesarias), presupuesto=fmt(tope)
    )
    await hablar(sistema, [Turno("usuario", "Explícale al alumno que no cabe y qué opciones tiene.")])
    return {}


async def explicar_fallo(estado: Estado) -> dict:
    fase("explicar_fallo")
    errores = "\n".join(estado.get("errores", [])[-5:]) or "(sin detalle)"
    sistema = cargar("explicar_fallo").rellenar(errores=errores)
    await hablar(sistema, [Turno("usuario", "Explícaselo al alumno.")])
    return {}
