"""El calendarizador: reparte un plan ya validado en días y franjas.

Función pura: sin modelo, sin base de datos y sin reloj. La fecha de partida y las
reglas entran como argumentos. Trabaja en minutos enteros para no arrastrar
errores de coma flotante.
"""

import math
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from magister.plan.dependencias import orden
from magister.plan.esquemas import Plan
from magister.plan.reglas import fmt

MAX_DIAS = 3 * 365  # tope de seguridad sin plazo


@dataclass(frozen=True)
class ReglasCalendario:
    holgura: float = 0.0
    partir_lecciones: bool = True
    dia_nuevo_por_leccion: bool = False
    horas_max: float = 4.0


@dataclass(frozen=True)
class Sesion:
    fecha: date
    inicio: time | None
    clave: str
    horas: float

    def a_dict(self) -> dict:
        return {
            "fecha": self.fecha.isoformat(),
            "inicio": self.inicio.strftime("%H:%M") if self.inicio else None,
            "clave": self.clave,
            "horas": self.horas,
        }


@dataclass
class Calendario:
    sesiones: list[Sesion] = field(default_factory=list)

    @property
    def fin(self) -> date | None:
        return self.sesiones[-1].fecha if self.sesiones else None

    @property
    def dias(self) -> int:
        return len({s.fecha for s in self.sesiones})


@dataclass(frozen=True)
class NoCabe:
    horas_necesarias: float
    horas_disponibles: float

    @property
    def horas_faltan(self) -> float:
        return round(self.horas_necesarias - self.horas_disponibles, 2)

    def dias_que_faltan(self, disponibilidad: list[float]) -> int:
        dias_estudio = [h for h in disponibilidad if h > 0]
        media = sum(dias_estudio) / len(dias_estudio) if dias_estudio else 0
        return math.ceil(self.horas_faltan / media) if media else 0

    def mensaje(self) -> str:
        return (
            f"No cabe: hacen falta {fmt(self.horas_necesarias)} h y hay {fmt(self.horas_disponibles)} h; "
            f"faltan {fmt(self.horas_faltan)} h."
        )


MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
         "diciembre")


def fecha_larga(d: date) -> str:
    """Una fecha como se dice: «5 de enero de 2027» (lo que lee el alumno; las claves y la API siguen en ISO)."""
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}"


HORAS_MAX_SESION = 12.0  # el mismo tope que las horas por día de «Mi horario»


def error_en_sesiones(sesiones: list[Sesion], claves: set[str], hoy: date) -> str | None:
    """Por qué unas sesiones que llegan de fuera (el reajuste que aceptas) no se pueden guardar, o None si se pueden:
    al menos una, de lecciones del plan, con horas de más de 0 y como mucho `HORAS_MAX_SESION`, desde hoy (y no más
    allá del tope del calendarizador) y sin pasar de 24 h en un día."""
    if not sesiones:
        return "No hay ninguna sesión que guardar: así se borrarían todas las pendientes."
    desconocidas = sorted({x.clave for x in sesiones} - claves)
    if desconocidas:
        return f"Estas lecciones no están en el plan: {', '.join(desconocidas)}."
    for x in sesiones:
        if not 0 < x.horas <= HORAS_MAX_SESION:
            return f"Cada sesión dura más de 0 h y como mucho {fmt(HORAS_MAX_SESION)} h; la de {x.clave} tiene {fmt(x.horas)} h."
        if x.fecha < hoy:
            return f"La sesión de {x.clave} es del {fecha_larga(x.fecha)}, anterior a hoy."
        if (x.fecha - hoy).days > MAX_DIAS:
            return f"La sesión de {x.clave} es del {fecha_larga(x.fecha)}: demasiado lejos."
    por_dia: dict[date, float] = {}
    for x in sesiones:
        por_dia[x.fecha] = por_dia.get(x.fecha, 0.0) + x.horas
    for d, h in sorted(por_dia.items()):
        if h > 24:
            return f"El {fecha_larga(d)} suma {fmt(h)} h: un día no tiene tantas."
    return None


def error_en_desde(desde: date, hoy: date) -> str | None:
    """Recalcular desde una fecha: no antes de hoy (lo pasado no se vuelve a repartir) ni más allá del tope."""
    if desde < hoy:
        return f"No se puede recalcular desde el {fecha_larga(desde)}: es anterior a hoy."
    if (desde - hoy).days > 365:
        return f"No se puede recalcular desde el {fecha_larga(desde)}: como mucho, desde dentro de un año."
    return None


def minutos_pasados(inicio: time | None, ahora: time | None, capacidad: int) -> int:
    """Minutos de la franja de hoy que ya han pasado a la hora `ahora` (de 0 a `capacidad`). Sin hora de inicio o sin
    `ahora` no se sabe qué ha pasado: 0. Lo que se reparte hoy empieza detrás, en la siguiente franja libre de verdad."""
    if inicio is None or ahora is None:
        return 0
    pasados = (ahora.hour * 60 + ahora.minute) - (inicio.hour * 60 + inicio.minute)
    return max(0, min(pasados, capacidad))


def _min(h: float) -> int:
    return round(h * 60)


def _h(m: int) -> float:
    return round(m / 60, 2)


def a_hora(texto: str | None) -> time | None:
    if not texto:
        return None
    return datetime.strptime(texto, "%H:%M").time()


def _capacidades(disponibilidad: list[float], inicio_por_dia: list[time | None]) -> list[int]:
    """Minutos útiles de cada día de la semana: los que dijiste, pero el día acaba a las 24:00."""
    salida = []
    for i, h in enumerate(disponibilidad):
        inicio = inicio_por_dia[i] if i < len(inicio_por_dia) else None
        tope = 24 * 60 - (inicio.hour * 60 + inicio.minute) if inicio is not None else None
        salida.append(min(_min(h), tope) if tope is not None else _min(h))
    return salida


def horas_utiles(disponibilidad: list[float], inicio_por_dia: list[time | None]) -> list[float]:
    """Las horas que caben de verdad cada día de la semana, sin pasar de medianoche."""
    return [_h(m) for m in _capacidades(disponibilidad, inicio_por_dia)]


def calendarizar(
    plan: Plan,
    disponibilidad: list[float],
    inicio_por_dia: list[time | None],
    desde: date,
    plazo: date | None,
    hechas: dict[str, float],
    reglas: ReglasCalendario,
    usado_inicial: int = 0,
    ahora: time | None = None,
) -> Calendario | NoCabe:
    """`usado_inicial`: minutos de `desde` ya ocupados (lo que ya has estudiado hoy); lo siguiente empieza detrás.
    `ahora`: la hora de ahora, solo si `desde` es hoy. La parte de la franja de hoy que ya ha pasado tampoco se usa: un
    plan aceptado a las 20:50 no pone su primera sesión hoy a las 18:00."""
    pendientes = {
        lec.clave: max(0, _min(lec.horas) - _min(hechas.get(lec.clave, 0.0))) for lec in plan.lecciones
    }
    total = sum(pendientes.values())
    capacidades = _capacidades(disponibilidad, inicio_por_dia)
    inicio_hoy = inicio_por_dia[desde.weekday()] if desde.weekday() < len(inicio_por_dia) else None
    usado_inicial = max(usado_inicial, minutos_pasados(inicio_hoy, ahora, capacidades[desde.weekday()]))
    if plazo is not None:
        cap = -min(usado_inicial, capacidades[desde.weekday()])
        d = desde
        while d <= plazo:
            cap += capacidades[d.weekday()]
            d += timedelta(days=1)
        necesarias = total * (1 + reglas.holgura)
        if necesarias > cap + 0.5:
            return NoCabe(round(necesarias / 60, 2), _h(max(cap, 0)))
    if sum(capacidades) == 0 and total > 0:
        return NoCabe(_h(total), 0.0)

    sesiones: list[Sesion] = []
    dia = desde
    usado = usado_inicial  # minutos usados en `dia`

    def capacidad_dia(d: date) -> int:
        return capacidades[d.weekday()]

    def siguiente_dia() -> None:
        nonlocal dia, usado
        dia += timedelta(days=1)
        usado = 0
        if (dia - desde).days > MAX_DIAS:
            raise ValueError("el calendario no acaba: revisa la disponibilidad")

    def colocar(clave: str, minutos: int) -> None:
        inicio = inicio_por_dia[dia.weekday()]
        hora = None
        if inicio is not None:
            hora = (datetime.combine(dia, inicio) + timedelta(minutes=usado)).time()
        sesiones.append(Sesion(dia, hora, clave, _h(minutos)))

    for clave in orden(plan):
        resto = pendientes[clave]
        if resto <= 0:
            continue
        if reglas.dia_nuevo_por_leccion and usado > 0:
            siguiente_dia()
        if not reglas.partir_lecciones and resto <= max(capacidades):
            # La lección entera en un solo día, si cabe en algún día completo.
            while capacidad_dia(dia) - usado < resto:
                siguiente_dia()
        while resto > 0:
            libre = capacidad_dia(dia) - usado
            if libre <= 0:
                siguiente_dia()
                continue
            trozo = min(libre, resto)
            colocar(clave, trozo)
            usado += trozo
            resto -= trozo
    return Calendario(sesiones)
