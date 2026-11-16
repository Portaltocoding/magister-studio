from magister.cerebro.prompts import cargar
from magister.flujo.comun import acciones_de_estudio, hablar, historial_reciente, sistema_de_estudio
from magister.flujo.estado import Estado


async def conversar(estado: Estado) -> dict:
    historial = historial_reciente(estado)
    sistema = await sistema_de_estudio(cargar("conversar").texto, estado)
    plan = estado.get("plan")
    if plan:
        lecciones = "\n".join(f"- {lec['clave']} {lec['titulo']}" for lec in plan.get("lecciones", []))
        sistema += f"\n\nEl alumno sigue este plan de estudio:\n{lecciones}"
    await hablar(sistema, historial)
    await acciones_de_estudio(estado, sin_fuentes=True)
    return {}
