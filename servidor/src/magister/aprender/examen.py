"""Modo examen: elegir preguntas del banco repartidas entre lecciones y poner la nota."""

import random
from collections.abc import Sequence

# Lo que vale cada nota del corrector, sobre 10. Sin responder cuenta como fallo.
PUNTOS = {"perfecta": 10.0, "bien": 8.0, "parcial": 5.0, "fallo": 0.0}


def elegir(por_leccion: dict[str, Sequence[dict]], cantidad: int, rng: random.Random | None = None) -> list[dict]:
    """Reparte `cantidad` preguntas entre las lecciones por turnos, para que ninguna se coma el examen.

    Dentro de cada lección el orden es al azar; entre lecciones se va de una en una mientras queden.
    """
    rng = rng or random.Random()
    montones = {c: rng.sample(list(ps), len(ps)) for c, ps in por_leccion.items() if ps}
    claves = sorted(montones)
    elegidas: list[dict] = []
    while len(elegidas) < cantidad and any(montones.values()):
        for c in claves:
            if montones[c] and len(elegidas) < cantidad:
                elegidas.append(montones[c].pop())
    rng.shuffle(elegidas)
    return elegidas


def nota(notas: Sequence[str | None]) -> float:
    """Media sobre 10 de todas las preguntas del examen, con un decimal."""
    if not notas:
        return 0.0
    return round(sum(PUNTOS.get(n or "fallo", 0.0) for n in notas) / len(notas), 1)
