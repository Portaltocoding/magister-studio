"""Reajustar el calendario: reservar primero la carga prevista de repasos y repartir lo pendiente.

Reutiliza `calendarizar` y `orden` de la Parte II. El momento entra como argumento.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from magister.aprender.practica import conceptos_practicables, minutos_por_repaso
from magister.aprender.estado import estados_en
from magister.aprender.programador import programador
from magister.plan.calendario import Calendario, NoCabe, ReglasCalendario, calendarizar
from magister.plan.esquemas import Plan


@dataclass
class CargaDia:
    fecha: date
    repasos: int
    minutos: float


async def prever_carga(desde: datetime, dias: int) -> list[CargaDia]:
    """Repasos previstos por día: la próxima fecha de cada concepto practicado (el primero, solo)."""
    conceptos = await conceptos_practicables()
    estados = await estados_en([c.concepto_id for c in conceptos], desde)
    minutos = await minutos_por_repaso()
    cuenta: Counter = Counter()
    for c in conceptos:
        e = estados[c.concepto_id]
        prox = (programador(c.brazo) if c.brazo else programador()).proxima(e)
        if prox is None:
            continue
        dia = max(prox.date(), desde.date())
        if dia < desde.date() + timedelta(days=dias):
            cuenta[dia] += 1
    return [CargaDia(desde.date() + timedelta(days=i), cuenta[desde.date() + timedelta(days=i)],
                     round(cuenta[desde.date() + timedelta(days=i)] * minutos, 1)) for i in range(dias)]


def reajustar(plan: Plan, disponibilidad: list[float], inicios: list, hoy: date, plazo: date | None,
              hechas: dict[str, float], carga: dict[date, float], dominadas: set[str], reglas: ReglasCalendario,
              ) -> tuple[Calendario | NoCabe, list[str]]:
    """Reserva la carga de repasos (horas) de cada día y reparte las lecciones pendientes en lo que queda.

    Como `calendarizar` trabaja con una disponibilidad semanal, la reserva se aplica como la media
    de la carga por día de la semana en el horizonte (criterio general).
    """
    hechas = dict(hechas)
    for clave in dominadas:
        lec = next((x for x in plan.lecciones if x.clave == clave), None)
        if lec:
            hechas[clave] = lec.horas
    reserva = [0.0] * 7
    n = [0] * 7
    for d, h in carga.items():
        reserva[d.weekday()] += h
        n[d.weekday()] += 1
    ajustada = [max(0.0, disponibilidad[i] - (reserva[i] / n[i] if n[i] else 0)) for i in range(7)]
    resultado = calendarizar(plan, ajustada, inicios, hoy, plazo, hechas, reglas)
    avisos = []
    if isinstance(resultado, NoCabe):
        sin_plazo = calendarizar(plan, ajustada, inicios, hoy, None, hechas, reglas)
        if isinstance(sin_plazo, Calendario) and sin_plazo.fin:
            avisos.append(f"No llegas a la fecha objetivo; con tus horas, acabarías el {sin_plazo.fin:%d-%m-%Y}.")
            resultado = sin_plazo
    if dominadas:
        avisos.append(f"Lecciones ya dominadas que se dan por hechas: {', '.join(sorted(dominadas))}.")
    return resultado, avisos


def diferencias(antes: list[dict], despues: list[dict]) -> list[str]:
    fin = lambda xs: max((x["fecha"] for x in xs), default=None)  # noqa: E731
    cambios = []
    if fin(antes) != fin(despues):
        cambios.append(f"El final pasa del {fin(antes)} al {fin(despues)}.")
    a = Counter(x["clave"] for x in antes)
    d = Counter(x["clave"] for x in despues)
    for clave in sorted(set(a) | set(d)):
        if a[clave] != d[clave]:
            cambios.append(f"{clave}: {a[clave]} sesiones pendientes antes, {d[clave]} ahora.")
    return cambios
