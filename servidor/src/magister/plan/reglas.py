"""Las reglas del plan como código puro: lo que el modelo no puede saltarse."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta

from magister.plan.dependencias import comprobar
from magister.plan.esquemas import Perfil, Plan

HORIZONTE_SIN_PLAZO = 90  # días que se suman si no hay plazo (criterio general)

# Cuántas horas puede tener un plan según lo que pide (evals/tamano_plan.py lo mide). Sin esto el planificador llenaba
# el presupuesto: «aprender a dividir» con dos horas al día salía en 9 h; y con topes holgados se va al tope. Si tras
# sus intentos solo falla esto, el código recorta las horas en proporción (ajustar_a_alcance): nunca deja sin plan.
# Una asignatura no tiene tope propio: manda el presupuesto.
HORAS_POR_ALCANCE: dict[str, tuple[float, float]] = {
    "procedimiento": (0.5, 2.0),
    "concepto": (0.5, 3.0),
    "tema": (3.0, 12.0),
    "tema_amplio": (8.0, 30.0),
    "tema_master": (5.0, 20.0),
}


def error_alcance(plan: Plan) -> str | None:
    if plan.alcance is None:
        return "falta `alcance`: di qué es lo que pide (procedimiento, concepto, tema, tema_amplio, tema_master o asignatura)"
    rango = HORAS_POR_ALCANCE.get(plan.alcance)
    if rango is None or rango[0] <= plan.total_horas <= rango[1]:
        return None
    return (f"un plan de alcance «{plan.alcance}» tiene de {fmt(rango[0])} a {fmt(rango[1])} h y este suma "
            f"{fmt(plan.total_horas)} h: ajusta las horas y las lecciones a lo que pide (o cambia el alcance si te equivocaste)")


@dataclass(frozen=True)
class ReglasPlan:
    holgura: float = 0.15
    horas_max_leccion: float = 4.0


def fin_de_horizonte(perfil: Perfil, hoy: date) -> date:
    return perfil.plazo or hoy + timedelta(days=HORIZONTE_SIN_PLAZO - 1)


def capacidad(perfil: Perfil, hoy: date) -> float:
    """Horas disponibles entre hoy y el plazo, los dos incluidos."""
    horas = perfil.horas_por_dia or [0.0] * 7
    fin = fin_de_horizonte(perfil, hoy)
    total = 0.0
    dia = hoy
    while dia <= fin:
        total += horas[dia.weekday()]
        dia += timedelta(days=1)
    return round(total, 2)


def presupuesto(perfil: Perfil, hoy: date, holgura: float) -> float:
    return round(capacidad(perfil, hoy) / (1 + holgura), 2)


def fmt(h: float) -> str:
    return f"{h:.1f}".rstrip("0").rstrip(".").replace(".", ",")


def error_capacidad(plan: Plan, tope: float) -> str | None:
    if plan.total_horas > tope + 1e-9:
        return f"{fmt(plan.total_horas)} h para un presupuesto de {fmt(tope)} h"
    return None


def reglas_plan(perfil: Perfil, hoy: date, reglas: ReglasPlan) -> Callable[[Plan], list[str]]:
    tope = presupuesto(perfil, hoy, reglas.holgura)

    def aplicar(plan: Plan) -> list[str]:
        errores: list[str] = []
        if e := error_capacidad(plan, tope):
            errores.append(e)
        if e := error_alcance(plan):
            errores.append(e)
        for lec in plan.lecciones:
            if lec.horas > reglas.horas_max_leccion:
                errores.append(
                    f"{lec.clave} tiene {fmt(lec.horas)} h y el máximo por lección es {fmt(reglas.horas_max_leccion)} h"
                )
        errores += comprobar(plan)
        return errores

    return aplicar


def es_solo_capacidad(errores: list[str]) -> bool:
    return bool(errores) and all(" h para un presupuesto de " in e for e in errores)


def solo_alcance(errores: list[str]) -> bool:
    return bool(errores) and all(e.startswith("un plan de alcance") for e in errores)


def ajustar_a_alcance(plan: Plan) -> Plan:
    """Recorta las horas de cada lección en proporción hasta el tope de su alcance (en cuartos de hora, mínimo media)."""
    rango = HORAS_POR_ALCANCE.get(plan.alcance or "")
    if rango is None or plan.total_horas <= rango[1]:
        return plan
    factor = rango[1] / plan.total_horas
    lecciones = [lec.model_copy(update={"horas": max(0.5, round(lec.horas * factor * 4) / 4)}) for lec in plan.lecciones]
    return plan.model_copy(update={"lecciones": lecciones})
