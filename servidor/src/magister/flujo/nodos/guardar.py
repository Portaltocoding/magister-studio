from magister.config import ajustes
from magister.datos.plan import guardar_plan
from magister.flujo.comun import decir, fase, perfil_de
from magister.flujo.estado import Estado


async def guardar(estado: Estado) -> dict:
    fase("guardar")
    perfil = perfil_de(estado)
    tema_id, plan_id = await guardar_plan(
        perfil.tema or "Sin tema",
        estado.get("conversacion_id"),
        perfil.model_dump(mode="json"),
        estado["plan"],
        estado.get("sesiones", []),
        estado.get("version_prompt"),
        ajustes.modelo,
    )
    decir(
        "Hecho: plan guardado. Lo tienes en **Roadmap** y las sesiones en **Calendario**. "
        "Cuando quieras, sigue preguntándome aquí o empieza una sesión con el **Tutor**."
    )
    return {"fase": "estudio", "tema_id": tema_id, "plan_id": plan_id}
