"""Programadores de repaso: cuándo vuelves a ver cada concepto.

Protocolo: `p_recordar(estado, ahora) -> float`, `siguiente(estado, nota, ahora) -> (repasos, fecha)`, `version`.
El estado se reconstruye desde los repasos: nada se guarda aparte.

    uv run python -m magister.aprender.programador --demo bien bien fallo bien
"""

import argparse
import hashlib
from datetime import datetime, timedelta, timezone
from functools import cache
from pathlib import Path
from typing import Protocol

from magister.aprender.estado import EstadoConcepto, es_acierto
from magister.config import ajustes

NOTAS_FSRS = {"fallo": 1, "parcial": 2, "bien": 3, "perfecta": 4}  # Again, Hard, Good, Easy


class Programador(Protocol):
    version: str

    def p_recordar(self, estado: EstadoConcepto, ahora: datetime) -> float: ...

    def proxima(self, estado: EstadoConcepto) -> datetime | None: ...

    def siguiente(self, estado: EstadoConcepto, nota: str, ahora: datetime) -> tuple[EstadoConcepto, datetime]: ...


def _con(estado: EstadoConcepto, nota: str, ahora: datetime) -> EstadoConcepto:
    return EstadoConcepto(estado.concepto_id, ahora, [*estado.repasos, (ahora, nota)])


class Leitner:
    """La regla de `aptus/src/core/resurfacing.ts`: cajas con intervalos 1, 3, 7, 16 y 35 días;
    acierto sube una caja, fallo vuelve a la 1. La primera pregunta entra en la caja 1 (ADR)."""

    INTERVALOS = (1, 3, 7, 16, 35)
    version = "leitner-1-3-7-16-35"

    def caja(self, estado: EstadoConcepto) -> int:
        c = 0
        for _, nota in estado.repasos:
            c = min(c + 1, len(self.INTERVALOS)) if es_acierto(nota) else 1
        return c

    def p_recordar(self, estado: EstadoConcepto, ahora: datetime) -> float:
        if not estado.repasos:
            return 0.5
        h = 2.0 ** (estado.aciertos - estado.fallos)
        delta = max(0.0, (ahora - estado.ultimo).total_seconds() / 86400)
        return min(1.0, max(0.0, 2 ** (-delta / h)))

    def proxima(self, estado: EstadoConcepto) -> datetime | None:
        if not estado.repasos:
            return None
        return estado.ultimo + timedelta(days=self.INTERVALOS[max(1, self.caja(estado)) - 1])

    def siguiente(self, estado, nota, ahora):
        nuevo = _con(estado, nota, ahora)
        return nuevo, self.proxima(nuevo)


class FSRS:
    """Envoltorio sobre la librería `fsrs` con sus parámetros por defecto, en días (sin pasos cortos)."""

    def __init__(self, retencion: float | None = None, parametros: list[float] | None = None, etiqueta: str = "defecto") -> None:
        from fsrs import Scheduler

        self.retencion = retencion or ajustes.retencion
        extra = {"parameters": tuple(parametros)} if parametros else {}
        self.programador = Scheduler(desired_retention=self.retencion, learning_steps=(), relearning_steps=(),
                                     enable_fuzzing=False, **extra)
        self.tope = ajustes.tope_inicial
        self.version = f"fsrs-6-{etiqueta}-r{self.retencion}" + ("-tope" if self.tope else "")

    def tarjeta(self, estado: EstadoConcepto):
        from fsrs import Card, Rating

        c = Card()
        for momento, nota in estado.repasos:
            c, _ = self.programador.review_card(c, Rating(NOTAS_FSRS[nota]), momento)
        return c

    def p_recordar(self, estado, ahora):
        if not estado.repasos:
            return 0.5
        return float(self.programador.get_card_retrievability(self.tarjeta(estado), ahora))

    def proxima(self, estado):
        if not estado.repasos:
            return None
        due = self.tarjeta(estado).due
        # Lo recién aprendido vuelve pronto aunque FSRS diga más: las primeras sesiones espaciadas son las que más
        # fijan (reaprendizaje sucesivo, Rawson y Dunlosky). Como mucho 3 días tras el primer repaso y 9 tras el segundo.
        if self.tope and len(estado.repasos) <= 2:
            tope = estado.repasos[-1][0] + timedelta(days=TOPES_INICIALES[len(estado.repasos) - 1])
            return min(due, tope)
        return due

    def siguiente(self, estado, nota, ahora):
        nuevo = _con(estado, nota, ahora)
        return nuevo, self.proxima(nuevo)


TOPES_INICIALES = (3, 9)


class ModeloOlvido:
    """Un modelo propio (logística calibrada) que programa cuando p cae a la retención."""

    def __init__(self, ruta: Path) -> None:
        import joblib

        datos = joblib.load(ruta)
        self.modelo = datos["modelo"]
        self.base = datos.get("tasa_base", 0.7)
        self.version = f"modelo-{hashlib.sha256(ruta.read_bytes()).hexdigest()[:10]}"

    def p_recordar(self, estado, ahora):
        from magister.aprender.columnas import COLUMNAS, fila

        x = fila(estado, ahora, self.base)
        return float(self.modelo.predict_proba([[x[c] for c in COLUMNAS]])[0][1])

    def proxima(self, estado):
        if not estado.repasos:
            return None
        dia = estado.ultimo
        for d in range(1, 366):
            dia = estado.ultimo + timedelta(days=d)
            if self.p_recordar(EstadoConcepto(estado.concepto_id, dia, estado.repasos), dia) < ajustes.retencion:
                return dia
        return dia

    def siguiente(self, estado, nota, ahora):
        nuevo = _con(estado, nota, ahora)
        return nuevo, self.proxima(nuevo)


CARPETA_MODELOS = Path(__file__).resolve().parents[3] / "evals" / "olvido" / "modelos"


@cache
def programador(nombre: str | None = None) -> Programador:
    nombre = nombre or ajustes.programador
    if nombre == "fsrs":
        from magister.aprender.personal import parametros_guardados

        personal = parametros_guardados()
        if personal:
            return FSRS(parametros=personal["parametros"], etiqueta=f"personal-{personal['etapa']}-{personal['huella']}")
        return FSRS()
    if nombre == "modelo":
        ruta = CARPETA_MODELOS / "actual.joblib"
        if ruta.exists():
            return ModeloOlvido(ruta)
    return Leitner()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", nargs="+", default=["bien", "bien", "fallo", "bien", "perfecta"])
    ap.add_argument("--programador", default=None)
    a = ap.parse_args()
    p = programador(a.programador)
    estado = EstadoConcepto("demo", datetime.now(timezone.utc))
    ahora = estado.momento
    print(p.version)
    for nota in a.demo:
        print(f"  p antes {p.p_recordar(estado, ahora):.2f}, nota {nota}", end="")
        estado, fecha = p.siguiente(estado, nota, ahora)
        print(f", próxima {fecha:%Y-%m-%d}")
        ahora = fecha


if __name__ == "__main__":
    main()
