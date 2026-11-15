"""Métricas del retriever. Puras y deterministas.

`recuperados` es la lista de ids en orden; `relevantes`, el conjunto de ids buenos.
"""

import math
from collections.abc import Sequence


def recall_en(recuperados: Sequence[int], relevantes: set[int], k: int) -> float:
    if not relevantes:
        return 0.0
    return len(set(recuperados[:k]) & relevantes) / len(relevantes)


def rango_reciproco(recuperados: Sequence[int], relevantes: set[int]) -> float:
    """1/rango del primer relevante; 0 si no aparece (la pregunta cuenta, no se salta)."""
    for i, fid in enumerate(recuperados, start=1):
        if fid in relevantes:
            return 1.0 / i
    return 0.0


def ndcg_en(recuperados: Sequence[int], relevantes: set[int], k: int = 10) -> float:
    dcg = sum(1.0 / math.log2(i + 1) for i, fid in enumerate(recuperados[:k], start=1) if fid in relevantes)
    ideal = sum(1.0 / math.log2(i + 1) for i in range(1, min(k, len(relevantes)) + 1))
    return dcg / ideal if ideal else 0.0


def pasaje_en(intervalos: Sequence[tuple[int, int, int]], pasaje: tuple[int, int, int], k: int = 5) -> float:
    """1 si algún recuperado de los k primeros solapa el pasaje bueno (version_id, inicio, fin)."""
    v, a, b = pasaje
    for vi, x, y in intervalos[:k]:
        if vi == v and x < b and a < y:
            return 1.0
    return 0.0


def media_y_error(valores: Sequence[float]) -> tuple[float, float]:
    n = len(valores)
    if n == 0:
        return 0.0, 0.0
    m = sum(valores) / n
    if n == 1:
        return m, 0.0
    var = sum((x - m) ** 2 for x in valores) / (n - 1)
    return m, math.sqrt(var / n)
