from magister.cerebro.modelo import Turno
from magister.cerebro.prompts import cargar
from magister.flujo.comun import hablar
from magister.flujo.estado import Estado


async def conversar(estado: Estado) -> dict:
    historial = [Turno(t["rol"], t["contenido"]) for t in estado.get("turnos", [])]  # type: ignore[arg-type]
    sistema = cargar("conversar").texto
    plan = estado.get("plan")
    if plan:
        lecciones = "\n".join(f"- {lec['clave']} {lec['titulo']}" for lec in plan.get("lecciones", []))
        sistema += f"\n\nEl alumno sigue este plan de estudio:\n{lecciones}"
    await hablar(sistema, historial)
    return {}
