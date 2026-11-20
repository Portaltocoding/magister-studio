from magister.cerebro.estructura import ErrorEstructura, Intento, estructurar
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.flujo import fuentes as fuentes_plan
from magister.flujo.comun import con_idioma_del_alumno, fase, hoy_de, perfil_de, perfil_json, reglas_plan
from magister.flujo.estado import Estado
from magister.plan.esquemas import PlanNuevo
from magister.plan.razonamiento import pulir_razonamiento
from magister.plan.reglas import ajustar_a_alcance, es_solo_capacidad, presupuesto, solo_alcance
from magister.plan.reglas import reglas_plan as construir_reglas


def _para_el_alumno(plan: PlanNuevo, perfil) -> dict:
    """El plan como dict, con el razonamiento sin jerga ni horas que no salgan del plan (plan/razonamiento.py): las
    horas que recortó `ajustar_a_alcance` o que el modelo contó mal no llegan al alumno."""
    datos = plan.model_dump(mode="json")
    datos["razonamiento"] = pulir_razonamiento(plan.razonamiento, [lec.horas for lec in plan.lecciones],
                                               {h for h in (perfil.horas_por_dia or []) if h})
    return datos


def hacer_planificar(buscador=None):
    async def nodo(estado: Estado) -> dict:
        return await planificar(estado, buscador)

    return nodo


async def planificar(estado: Estado, buscador=None) -> dict:
    fase("planificar")
    perfil = perfil_de(estado)
    hoy = hoy_de(estado)
    reglas = reglas_plan()
    tope = presupuesto(perfil, hoy, reglas.holgura)
    plantilla = cargar("planificar")
    sistema = plantilla.rellenar(
        perfil=perfil_json(perfil),
        horas_max=f"{reglas.horas_max_leccion:g}",
        presupuesto=f"{tope:g}",
        fuentes=await fuentes_plan.contexto_para_plan(buscador, perfil.tema or ""),
        hoy=hoy.isoformat(),
    )
    sistema = await con_idioma_del_alumno(sistema)
    fallidos: list[Intento] = []
    try:
        plan = await estructurar(
            sistema, "Devuelve el plan.", PlanNuevo, construir_reglas(perfil, hoy, reglas), intentos=fallidos
        )
    except ErrorEstructura as e:
        ultimo = e.intentos[-1].errores if e.intentos else []
        salida = e.ultima_salida or {}
        # Si solo se pasa de horas para lo que pide, se recortan en proporción: mejor un plan ajustado que ninguno.
        if solo_alcance(ultimo) and salida:
            plan = ajustar_a_alcance(PlanNuevo.model_validate(salida))
            return {"plan": _para_el_alumno(plan, perfil), "errores": [x for i in fallidos for x in i.errores],
                    "intentos": len(fallidos), "salida": "calendarizar",
                    "version_prompt": f"{plantilla.etiqueta} {ajustes.modelo}"}
        necesarias = sum(float(lec.get("horas", 0)) for lec in salida.get("lecciones", []))
        return {
            "errores": [x for i in fallidos for x in i.errores],
            "intentos": len(fallidos),
            "salida": "negociar" if es_solo_capacidad(ultimo) else "explicar_fallo",
            "necesarias": round(necesarias, 2),
            "plan": None,
        }
    return {
        "plan": _para_el_alumno(plan, perfil),
        "errores": [x for i in fallidos for x in i.errores],
        "intentos": len(fallidos) + 1,
        "salida": "calendarizar",
        "version_prompt": f"{plantilla.etiqueta} {ajustes.modelo}",
    }
