"""El estado de un concepto en una fecha: solo con intentos `espaciado` estrictamente anteriores.

El estado no se guarda: se calcula desde el registro de intentos (como el «calor» de apolo).
Se mira por `concepto_id` en todos los planes, porque replanificar no te hace olvidar.
"""

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select

from magister.datos.aprender import Intento
from magister.datos.sesion import nueva_sesion

ACIERTOS = ("bien", "perfecta")


def nota_final(nota_corrector: str, nota_usuario: str | None) -> str:
    return nota_usuario or nota_corrector


def es_acierto(nota: str) -> bool:
    return nota in ACIERTOS


@dataclass
class EstadoConcepto:
    concepto_id: str
    momento: datetime
    repasos: list[tuple[datetime, str]] = field(default_factory=list)  # (momento, nota final), en orden

    @property
    def aciertos(self) -> int:
        return sum(1 for _, n in self.repasos if es_acierto(n))

    @property
    def fallos(self) -> int:
        return len(self.repasos) - self.aciertos

    @property
    def vistas(self) -> int:
        return len(self.repasos)

    @property
    def ultimo(self) -> datetime | None:
        return self.repasos[-1][0] if self.repasos else None

    @property
    def dias_desde(self) -> float | None:
        return (self.momento - self.ultimo).total_seconds() / 86400 if self.ultimo else None


def estado_de(concepto_id: str, momento: datetime, intentos: list[tuple[datetime, str, str | None, str]]) -> EstadoConcepto:
    """Función pura: `intentos` son (momento, nota_corrector, nota_usuario, tipo)."""
    repasos = sorted((m, nota_final(nc, nu)) for m, nc, nu, tipo in intentos if tipo == "espaciado" and m < momento)
    return EstadoConcepto(concepto_id, momento, repasos)


async def estado_en(concepto_id: str, momento: datetime) -> EstadoConcepto:
    async with nueva_sesion() as s:
        filas = (await s.execute(
            select(Intento.momento, Intento.nota_corrector, Intento.nota_usuario, Intento.tipo)
            .where(Intento.concepto_id == concepto_id, Intento.tipo == "espaciado", Intento.momento < momento)
        )).all()
    return estado_de(concepto_id, momento, [tuple(f) for f in filas])


async def estados_en(conceptos: list[str], momento: datetime) -> dict[str, EstadoConcepto]:
    async with nueva_sesion() as s:
        filas = (await s.execute(
            select(Intento.concepto_id, Intento.momento, Intento.nota_corrector, Intento.nota_usuario, Intento.tipo)
            .where(Intento.concepto_id.in_(conceptos), Intento.tipo == "espaciado", Intento.momento < momento)
        )).all()
    por: dict[str, list] = {c: [] for c in conceptos}
    for c, m, nc, nu, t in filas:
        por[c].append((m, nc, nu, t))
    return {c: estado_de(c, momento, v) for c, v in por.items()}
