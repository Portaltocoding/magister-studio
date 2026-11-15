"""Estadística compartida por todas las evals (contrato del índice del libro).

- `margen_wilson`: tasa con su intervalo al 95 %, con el número de casos (no de ejecuciones).
- `kappa_ponderada`: acuerdo entre dos etiquetadores en una escala ordinal (Parte IV).
- `bootstrap_pareado`: diferencia entre dos versiones sobre los mismos casos (Parte IV).
- `brier`, `log_loss`, `auc`, `calibracion`: métricas del modelo de olvido (Parte V).
"""

import math
import random
from collections.abc import Sequence


def margen_wilson(aciertos: int, n: int, z: float = 1.96) -> tuple[float, float, float]:
    if n == 0:
        return 0.0, 0.0, 0.0
    p = aciertos / n
    centro = (p + z * z / (2 * n)) / (1 + z * z / n)
    medio = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return p, max(0.0, centro - medio), min(1.0, centro + medio)


def kappa_ponderada(a: Sequence[int], b: Sequence[int], categorias: Sequence[int] | None = None) -> float:
    """Kappa de Cohen con pesos cuadráticos."""
    if len(a) != len(b) or not a:
        raise ValueError("hacen falta dos listas de la misma longitud")
    cats = sorted(set(categorias or []) | set(a) | set(b))
    k = len(cats)
    if k == 1:
        return 1.0
    idx = {c: i for i, c in enumerate(cats)}
    n = len(a)
    obs = [[0.0] * k for _ in range(k)]
    for x, y in zip(a, b, strict=True):
        obs[idx[x]][idx[y]] += 1 / n
    fa = [sum(obs[i]) for i in range(k)]
    fb = [sum(obs[i][j] for i in range(k)) for j in range(k)]
    peso = lambda i, j: ((i - j) ** 2) / ((k - 1) ** 2)  # noqa: E731
    o = sum(peso(i, j) * obs[i][j] for i in range(k) for j in range(k))
    e = sum(peso(i, j) * fa[i] * fb[j] for i in range(k) for j in range(k))
    return 1.0 if e == 0 else 1 - o / e


def bootstrap_pareado(
    a: Sequence[float], b: Sequence[float], repeticiones: int = 2000, semilla: int = 7
) -> tuple[float, float, float]:
    """Diferencia media b - a con intervalo al 95 % remuestreando casos emparejados."""
    if len(a) != len(b) or not a:
        raise ValueError("hacen falta dos listas emparejadas")
    rng = random.Random(semilla)
    diffs = [y - x for x, y in zip(a, b, strict=True)]
    n = len(diffs)
    medias = sorted(sum(diffs[rng.randrange(n)] for _ in range(n)) / n for _ in range(repeticiones))
    return sum(diffs) / n, medias[int(0.025 * repeticiones)], medias[int(0.975 * repeticiones) - 1]


def brier(p: Sequence[float], y: Sequence[int]) -> float:
    return sum((pi - yi) ** 2 for pi, yi in zip(p, y, strict=True)) / len(p)


def log_loss(p: Sequence[float], y: Sequence[int], eps: float = 1e-6) -> float:
    total = 0.0
    for pi, yi in zip(p, y, strict=True):
        pi = min(1 - eps, max(eps, pi))
        total += -(yi * math.log(pi) + (1 - yi) * math.log(1 - pi))
    return total / len(p)


def auc(p: Sequence[float], y: Sequence[int]) -> float:
    pos = [pi for pi, yi in zip(p, y, strict=True) if yi == 1]
    neg = [pi for pi, yi in zip(p, y, strict=True) if yi == 0]
    if not pos or not neg:
        return float("nan")
    gana = sum(1.0 if x > z else 0.5 if x == z else 0.0 for x in pos for z in neg)
    return gana / (len(pos) * len(neg))


def calibracion(p: Sequence[float], y: Sequence[int], cubos: int = 10) -> list[tuple[float, float, int]]:
    """(media predicha, tasa observada, n) por cubo de probabilidad."""
    grupos: list[list[tuple[float, int]]] = [[] for _ in range(cubos)]
    for pi, yi in zip(p, y, strict=True):
        grupos[min(cubos - 1, int(pi * cubos))].append((pi, yi))
    return [
        (sum(x for x, _ in g) / len(g), sum(z for _, z in g) / len(g), len(g)) for g in grupos if g
    ]
