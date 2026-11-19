from magister.config import ajustes
from magister.datos.plan import guardar_plan
from magister.flujo.comun import ahora_de, decir, escribir, fase, hoy_de, perfil_de
from magister.flujo.estado import Estado
from magister.flujo.fuentes import calcular_apoyo
from magister.flujo.planes import recolocar_con_progreso
from magister.plan.sustituir import emparejar_lecciones


def hacer_guardar(buscador=None):
    async def nodo(estado: Estado) -> dict:
        return await guardar(estado, buscador)

    return nodo


async def guardar(estado: Estado, buscador=None) -> dict:
    fase("guardar")
    perfil = perfil_de(estado)
    # Si sustituye al plan aceptado del mismo tema, las lecciones que siguen (mismo título) se traen sus fuentes y lo
    # que ya habías estudiado (plan/sustituir.py); con lo estudiado, lo pendiente se vuelve a repartir sin ello.
    tema_id, plan_id = await guardar_plan(
        perfil.tema or "Sin tema",
        estado.get("conversacion_id"),
        perfil.model_dump(mode="json"),
        estado["plan"],
        estado.get("sesiones", []),
        estado.get("version_prompt"),
        ajustes.modelo,
        emparejar=emparejar_lecciones,
    )
    await recolocar_con_progreso(plan_id, tema_id, hoy_de(estado), ahora_de(estado))
    await calcular_apoyo(buscador, plan_id, tema_id)
    escribir(guardado={"plan_id": plan_id, "tema_id": tema_id})
    decir(
        "Hecho: plan guardado. Lo tienes en **Roadmap** y las sesiones en **Calendario**. "
        "Cuando quieras, sigue preguntándome aquí o empieza una sesión con el **Tutor**."
    )
    return {"fase": "estudio", "tema_id": tema_id, "plan_id": plan_id}
