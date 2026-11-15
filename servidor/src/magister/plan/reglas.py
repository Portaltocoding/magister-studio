"""Las reglas del plan como código puro: lo que el modelo no puede saltarse."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta

from magister.plan.dependencias import comprobar
from magister.plan.esquemas import Perfil, Plan

HORIZONTE_SIN_PLAZO = 90  # días que se suman si no hay plazo (criterio general)


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
