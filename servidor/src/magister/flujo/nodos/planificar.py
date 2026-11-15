from magister.cerebro.estructura import ErrorEstructura, Intento, estructurar
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.flujo import fuentes as fuentes_plan
from magister.flujo.comun import fase, hoy_de, perfil_de, perfil_json, reglas_plan
from magister.flujo.estado import Estado
from magister.plan.esquemas import Plan
from magister.plan.reglas import es_solo_capacidad, presupuesto
from magister.plan.reglas import reglas_plan as construir_reglas


async def planificar(estado: Estado) -> dict:
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
        fuentes=await fuentes_plan.contexto_para_plan(perfil.tema or ""),
        hoy=hoy.isoformat(),
    )
    fallidos: list[Intento] = []
    try:
        plan = await estructurar(
            sistema, "Devuelve el plan.", Plan, construir_reglas(perfil, hoy, reglas), intentos=fallidos
        )
    except ErrorEstructura as e:
        ultimo = e.intentos[-1].errores if e.intentos else []
        salida = e.ultima_salida or {}
        necesarias = sum(float(lec.get("horas", 0)) for lec in salida.get("lecciones", []))
        return {
            "errores": [x for i in fallidos for x in i.errores],
            "intentos": len(fallidos),
            "salida": "negociar" if es_solo_capacidad(ultimo) else "explicar_fallo",
            "necesarias": round(necesarias, 2),
            "plan": None,
        }
    return {
        "plan": plan.model_dump(mode="json"),
        "errores": [x for i in fallidos for x in i.errores],
        "intentos": len(fallidos) + 1,
        "salida": "calendarizar",
        "version_prompt": f"{plantilla.etiqueta} {ajustes.modelo}",
    }
