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
            f"No cabe: hacen falta {self.horas_necesarias:g} h y hay {self.horas_disponibles:g} h; "
            f"faltan {self.horas_faltan:g} h."
        )


def _min(h: float) -> int:
    return round(h * 60)


def _h(m: int) -> float:
    return round(m / 60, 2)


def a_hora(texto: str | None) -> time | None:
    if not texto:
        return None
    return datetime.strptime(texto, "%H:%M").time()


def calendarizar(
    plan: Plan,
    disponibilidad: list[float],
    inicio_por_dia: list[time | None],
    desde: date,
    plazo: date | None,
    hechas: dict[str, float],
    reglas: ReglasCalendario,
) -> Calendario | NoCabe:
    pendientes = {
        lec.clave: max(0, _min(lec.horas) - _min(hechas.get(lec.clave, 0.0))) for lec in plan.lecciones
    }
    total = sum(pendientes.values())
    if plazo is not None:
        cap = 0
        d = desde
        while d <= plazo:
            cap += _min(disponibilidad[d.weekday()])
            d += timedelta(days=1)
        necesarias = total * (1 + reglas.holgura)
        if necesarias > cap + 0.5:
            return NoCabe(round(necesarias / 60, 2), _h(cap))
    if sum(_min(h) for h in disponibilidad) == 0 and total > 0:
        return NoCabe(_h(total), 0.0)

    sesiones: list[Sesion] = []
    dia = desde
    usado = 0  # minutos usados en `dia`

    def capacidad_dia(d: date) -> int:
        return _min(disponibilidad[d.weekday()])

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
        if not reglas.partir_lecciones and resto <= max(_min(h) for h in disponibilidad):
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
