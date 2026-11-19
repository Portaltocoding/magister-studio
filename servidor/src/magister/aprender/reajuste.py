"""Reajustar el calendario: reservar primero la carga prevista de repasos y repartir lo pendiente.

Reutiliza `calendarizar` y `orden` de la Parte II. El momento entra como argumento.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from magister.aprender.practica import conceptos_practicables, minutos_por_repaso
from magister.aprender.estado import estados_en
from magister.aprender.programador import programador
from magister.config import ajustes
from magister.plan.calendario import Calendario, NoCabe, ReglasCalendario, calendarizar, fecha_larga, horas_utiles
from magister.plan.esquemas import Plan


DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


@dataclass
class CargaDia:
    fecha: date
    repasos: int
    minutos: float


async def prever_carga(desde: datetime, dias: int, plan_id: int | None = None) -> list[CargaDia]:
    """Repasos previstos por día: la próxima fecha de cada concepto practicado (el primero, solo). Con `plan_id`,
    solo los conceptos de ese plan."""
    conceptos = [c for c in await conceptos_practicables() if plan_id is None or c.plan_id == plan_id]
    estados = await estados_en([c.concepto_id for c in conceptos], desde)
    minutos = await minutos_por_repaso()
    # Los días, en tu zona: a las 00:30 de Madrid ya es el día siguiente, aunque en UTC no.
    zona = ZoneInfo(ajustes.zona)
    hoy = desde.astimezone(zona).date()
    cuenta: Counter = Counter()
    for c in conceptos:
        e = estados[c.concepto_id]
        prox = (programador(c.brazo) if c.brazo else programador()).proxima(e)
        if prox is None:
            continue
        dia = max(prox.astimezone(zona).date(), hoy)
        if dia < hoy + timedelta(days=dias):
            cuenta[dia] += 1
    return [CargaDia(hoy + timedelta(days=i), cuenta[hoy + timedelta(days=i)],
                     round(cuenta[hoy + timedelta(days=i)] * minutos, 1)) for i in range(dias)]


def reajustar(plan: Plan, disponibilidad: list[float], inicios: list, hoy: date, plazo: date | None,
              hechas: dict[str, float], carga: dict[date, float], dominadas: set[str], reglas: ReglasCalendario,
              usado_inicial: int = 0, ahora: time | None = None,
              ) -> tuple[Calendario | NoCabe, list[str]]:
    """Reserva la carga de repasos (horas) de cada día y reparte las lecciones pendientes en lo que queda.

    Como `calendarizar` trabaja con una disponibilidad semanal, la reserva se aplica como la media
    de la carga por día de la semana en el horizonte (criterio general). `usado_inicial` (minutos ya estudiados hoy) y
    `ahora` (la hora, si `hoy` es hoy) van a `calendarizar`: lo de hoy empieza detrás de lo hecho y de lo que ya pasó.
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
    resultado = calendarizar(plan, ajustada, inicios, hoy, plazo, hechas, reglas, usado_inicial, ahora)
    avisos = []
    if isinstance(resultado, NoCabe):
        sin_plazo = calendarizar(plan, ajustada, inicios, hoy, None, hechas, reglas, usado_inicial, ahora)
        if isinstance(sin_plazo, Calendario) and sin_plazo.fin:
            avisos.append(f"No llegas a la fecha objetivo; con tus horas, acabarías el {fecha_larga(sin_plazo.fin)}.")
            resultado = sin_plazo
    utiles = horas_utiles(disponibilidad, inicios)
    recortados = [DIAS[i] for i in range(7) if utiles[i] < disponibilidad[i] - 1e-6]
    if recortados:
        avisos.append(f"Tu horario pasa de medianoche ({', '.join(recortados)}): solo cuento las horas hasta las 24:00.")
    if dominadas:
        avisos.append(f"Lecciones ya dominadas que se dan por hechas: {', '.join(sorted(dominadas))}.")
    return resultado, avisos


def diferencias(antes: list[dict], despues: list[dict]) -> list[str]:
    """Lo que cambia, en frases para el alumno (fechas como se dicen, no en ISO)."""
    fin = lambda xs: max((x["fecha"] for x in xs), default=None)  # noqa: E731
    cambios = []
    fa, fd = fin(antes), fin(despues)
    if fa != fd:
        if fa and fd:
            cambios.append(f"El final pasa del {fecha_larga(date.fromisoformat(fa))} al {fecha_larga(date.fromisoformat(fd))}.")
        elif fd:
            cambios.append(f"Ahora acabas el {fecha_larga(date.fromisoformat(fd))}.")
        else:
            cambios.append("No queda ninguna sesión pendiente.")
    a = Counter(x["clave"] for x in antes)
    d = Counter(x["clave"] for x in despues)
    sesiones = lambda n: "1 sesión pendiente" if n == 1 else f"{n} sesiones pendientes"  # noqa: E731
    for clave in sorted(set(a) | set(d)):
        if a[clave] != d[clave]:
            cambios.append(f"{clave}: {sesiones(a[clave])} antes, {d[clave]} ahora.")
    return cambios
