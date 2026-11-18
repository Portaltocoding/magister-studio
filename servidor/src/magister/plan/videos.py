"""Qué lecciones del plan merecen vídeo: las más duras, y tantas como pidas («pocos», «normal», «muchos»).

Código puro (sin base ni modelo): recibe las lecciones con lo que se sabe de ellas y devuelve las elegidas con su razón
en palabras llanas. Dureza = lo largo que es (horas), cuántos conceptos y de cuántas lecciones depende; si ya has
contestado preguntas de sus conceptos, lo que fallas pesa más que todo lo demás.
"""

from dataclasses import dataclass

CUANTOS = {"ninguno": 0.0, "pocos": 0.2, "normal": 0.35, "muchos": 0.6}
ORDEN = ["ninguno", "pocos", "normal", "muchos"]
MIN_RESPUESTAS = 3  # menos respuestas no dicen nada de lo que fallas


@dataclass(frozen=True)
class LeccionVideo:
    clave: str
    titulo: str
    horas: float
    conceptos: int
    depende: int
    respuestas: int = 0
    fallos: int = 0
    con_video: bool = False


@dataclass(frozen=True)
class Recomendada:
    clave: str
    titulo: str
    razon: str
    dureza: float
    con_video: bool


def _norma(x: float, maximo: float) -> float:
    return x / maximo if maximo > 0 else 0.0


def dureza(lec: LeccionVideo, max_horas: float, max_conceptos: int, max_depende: int) -> float:
    base = 0.5 * _norma(lec.horas, max_horas) + 0.3 * _norma(lec.conceptos, max_conceptos) + 0.2 * _norma(lec.depende, max_depende)
    # Lo que fallas se suma a la mitad de lo demás: fallar la mitad pesa ya tanto como la lección más larga del plan.
    fallas = lec.fallos / lec.respuestas if lec.respuestas >= MIN_RESPUESTAS else 0.0
    return 0.5 * base + fallas


def razon(lec: LeccionVideo, max_horas: float) -> str:
    if lec.respuestas >= MIN_RESPUESTAS and lec.fallos / lec.respuestas >= 0.3:
        return f"fallas {lec.fallos} de {lec.respuestas} preguntas de sus conceptos"
    if lec.horas >= max_horas:
        return "es la lección más larga del plan"
    if lec.depende >= 2:
        return f"se apoya en {lec.depende} lecciones anteriores"
    if lec.conceptos >= 4:
        return f"junta {lec.conceptos} conceptos"
    return "es de las más densas del plan"


def cuantas(total: int, cuantos: str) -> int:
    parte = CUANTOS.get(cuantos, CUANTOS["normal"])
    return 0 if parte == 0 or total == 0 else max(1, round(total * parte))


def elegir(lecciones: list[LeccionVideo], cuantos: str = "normal") -> list[Recomendada]:
    """Las lecciones que llevan vídeo, de la más dura a la menos. Las que ya lo tienen cuentan dentro del cupo."""
    n = cuantas(len(lecciones), cuantos)
    if n == 0:
        return []
    mh = max(x.horas for x in lecciones)
    mc = max(x.conceptos for x in lecciones)
    md = max(x.depende for x in lecciones)
    puntuadas = sorted(lecciones, key=lambda x: (-dureza(x, mh, mc, md), x.clave))
    return [Recomendada(x.clave, x.titulo, razon(x, mh), round(dureza(x, mh, mc, md), 3), x.con_video) for x in puntuadas[:n]]


def mover(cuantos: str, hacia: str) -> str:
    """«más» o «menos» vídeos: un paso en la escala."""
    i = ORDEN.index(cuantos) if cuantos in ORDEN else ORDEN.index("normal")
    return ORDEN[max(0, min(len(ORDEN) - 1, i + (1 if hacia == "mas" else -1)))]
