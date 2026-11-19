from magister.config import ajustes
from magister.flujo.comun import ahora_de, fase, hoy_de, perfil_de
from magister.flujo.estado import Estado
from magister.plan.calendario import NoCabe, ReglasCalendario, a_hora
from magister.plan.calendario import calendarizar as repartir
from magister.plan.esquemas import Plan
from magister.plan.reglas import capacidad


def reglas_calendario() -> ReglasCalendario:
    return ReglasCalendario(
        holgura=ajustes.holgura,
        partir_lecciones=ajustes.partir_lecciones,
        horas_max=ajustes.horas_max_leccion,
    )


async def calendarizar(estado: Estado) -> dict:
    fase("calendarizar")
    perfil = perfil_de(estado)
    plan = Plan.model_validate(estado["plan"])
    hoy = hoy_de(estado)
    inicios = [a_hora(h) for h in (perfil.inicio_por_dia or [None] * 7)]
    resultado = repartir(plan, perfil.horas_por_dia or [0] * 7, inicios, hoy, perfil.plazo, {}, reglas_calendario(),
                         ahora=ahora_de(estado))
    if isinstance(resultado, NoCabe):
        return {"salida": "negociar", "necesarias": plan.total_horas, "sesiones": []}
    return {"sesiones": [s.a_dict() for s in resultado.sesiones], "salida": "proponer"}


def propuesta(estado: Estado) -> dict:
    """Lo que viaja en el evento `plan`."""
    perfil = perfil_de(estado)
    plan = estado.get("plan") or {}
    sesiones = estado.get("sesiones", [])
    total = round(sum(float(lec["horas"]) for lec in plan.get("lecciones", [])), 2)
    return {
        "tema": perfil.tema,
        "razonamiento": plan.get("razonamiento", ""),
        "lecciones": plan.get("lecciones", []),
        "total_horas": total,
        "capacidad_horas": capacidad(perfil, hoy_de(estado)),
        "sesiones": sesiones,
        "fin": sesiones[-1]["fecha"] if sesiones else None,
    }
