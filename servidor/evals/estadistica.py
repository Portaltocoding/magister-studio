"""Estadística compartida por todas las evals. Funciones puras, solo biblioteca estándar.

Ningún número de una eval lo calcula el modelo: sale de aquí, con tests.

- Tasas: `margen_wilson`, `ic_proporcion`.
- Acuerdo: `kappa(tabla)`, `kappa_ponderada(tabla)`, `tabla_de(a, b)`, `spearman`.
- Comparar versiones: `mcnemar`, `binomial_cola`, `binomial_dos_colas`, `bootstrap_ic`, `bootstrap_pareado`; sin
  casos comunes, `newcombe` (proporciones) y `bootstrap_diferencia` (medias).
- Modelo de olvido (Parte V): `brier`, `log_loss`, `auc`, `calibracion`.
"""

import math
import random
from collections.abc import Callable, Sequence


def margen_wilson(aciertos: int, n: int, z: float = 1.96) -> tuple[float, float, float]:
    if n == 0:
        return 0.0, 0.0, 0.0
    p = aciertos / n
    centro = (p + z * z / (2 * n)) / (1 + z * z / n)
    medio = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return p, max(0.0, centro - medio), min(1.0, centro + medio)


def ic_proporcion(k: int, n: int) -> tuple[float, float]:
    """Intervalo de Wilson al 95 % de una proporción k/n."""
    _, lo, hi = margen_wilson(k, n)
    return lo, hi


def intervalo_proporcion(k: int, n: int, confianza: float = 0.95) -> tuple[float, float]:
    """Intervalo exacto de Clopper-Pearson de una proporción k/n."""
    if n == 0:
        return 0.0, 1.0
    from scipy.stats import beta

    a = (1 - confianza) / 2
    lo = 0.0 if k == 0 else float(beta.ppf(a, k, n - k + 1))
    hi = 1.0 if k == n else float(beta.ppf(1 - a, k + 1, n - k))
    return lo, hi


def tabla_de(a: Sequence, b: Sequence, categorias: Sequence | None = None) -> list[list[int]]:
    cats = list(categorias) if categorias is not None else sorted(set(a) | set(b))
    idx = {c: i for i, c in enumerate(cats)}
    t = [[0] * len(cats) for _ in cats]
    for x, y in zip(a, b, strict=True):
        t[idx[x]][idx[y]] += 1
    return t


def kappa(tabla: Sequence[Sequence[int]]) -> float:
    """Kappa de Cohen sin ponderar. Filas: un anotador; columnas: el otro."""
    n = sum(map(sum, tabla))
    k = len(tabla)
    po = sum(tabla[i][i] for i in range(k)) / n
    filas = [sum(r) / n for r in tabla]
    cols = [sum(tabla[i][j] for i in range(k)) / n for j in range(k)]
    pe = sum(filas[i] * cols[i] for i in range(k))
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)


def kappa_ponderada(tabla: Sequence[Sequence[int]], pesos: str = "cuadraticos") -> float:
    n = sum(map(sum, tabla))
    k = len(tabla)
    if k == 1:
        return 1.0
    w = (lambda i, j: ((i - j) / (k - 1)) ** 2) if pesos == "cuadraticos" else (lambda i, j: abs(i - j) / (k - 1))
    filas = [sum(r) / n for r in tabla]
    cols = [sum(tabla[i][j] for i in range(k)) / n for j in range(k)]
    obs = sum(w(i, j) * tabla[i][j] / n for i in range(k) for j in range(k))
    esp = sum(w(i, j) * filas[i] * cols[j] for i in range(k) for j in range(k))
    return 1.0 if esp == 0 else 1 - obs / esp


def _rangos(x: Sequence[float]) -> list[float]:
    orden = sorted(range(len(x)), key=lambda i: x[i])
    r = [0.0] * len(x)
    i = 0
    while i < len(orden):
        j = i
        while j + 1 < len(orden) and x[orden[j + 1]] == x[orden[i]]:
            j += 1
        for k in range(i, j + 1):
            r[orden[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(a: Sequence[float], b: Sequence[float]) -> float:
    ra, rb = _rangos(a), _rangos(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb, strict=True))
    va = math.sqrt(sum((x - ma) ** 2 for x in ra))
    vb = math.sqrt(sum((y - mb) ** 2 for y in rb))
    return cov / (va * vb) if va and vb else 0.0


def mcnemar(b: int, c: int) -> float:
    """Estadístico chi cuadrado de McNemar (sin corrección) con los discordantes b y c."""
    return 0.0 if b + c == 0 else (b - c) ** 2 / (b + c)


def binomial_cola(k: int, n: int, p: float = 0.5) -> float:
    """P(X >= k) para X ~ Binomial(n, p): la prueba exacta de los discordantes."""
    return sum(math.comb(n, i) * p**i * (1 - p) ** (n - i) for i in range(k, n + 1))


def bootstrap_ic(casos: Sequence, metrica: Callable[[Sequence], float], n: int = 10000, semilla: int = 7) -> tuple[float, float]:
    rng = random.Random(semilla)
    m = len(casos)
    valores = sorted(metrica([casos[rng.randrange(m)] for _ in range(m)]) for _ in range(n))
    return valores[int(0.025 * n)], valores[int(0.975 * n) - 1]


def bootstrap_pareado(casos: Sequence[tuple[float, float]], n: int = 10000, semilla: int = 7) -> tuple[float, float, float]:
    """Diferencia media (b - a) con su IC al 95 % remuestreando pares."""
    diffs = [b - a for a, b in casos]
    if not diffs:
        raise ValueError("hacen falta pares")
    lo, hi = bootstrap_ic(diffs, lambda xs: sum(xs) / len(xs), n, semilla)
    return sum(diffs) / len(diffs), lo, hi


def newcombe(k_a: int, n_a: int, k_b: int, n_b: int) -> tuple[float, float, float]:
    """Diferencia de dos proporciones independientes (b - a) con su IC al 95 % por el método híbrido de Newcombe
    (las dos de Wilson, sin corrección). Para comparar dos ejecuciones que no comparten casos."""
    if n_a == 0 or n_b == 0:
        raise ValueError("hacen falta casos en las dos proporciones")
    pa, la, ua = margen_wilson(k_a, n_a)
    pb, lb, ub = margen_wilson(k_b, n_b)
    d = pb - pa
    return d, d - math.sqrt((pb - lb) ** 2 + (ua - pa) ** 2), d + math.sqrt((ub - pb) ** 2 + (pa - la) ** 2)


def bootstrap_diferencia(a: Sequence[float], b: Sequence[float], n: int = 10000, semilla: int = 7) -> tuple[float, float, float]:
    """Diferencia de medias (b - a) de dos muestras independientes, con su IC al 95 % remuestreando cada una."""
    if not a or not b:
        raise ValueError("hacen falta valores en las dos muestras")
    rng = random.Random(semilla)
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    difs = sorted(
        sum(b[rng.randrange(len(b))] for _ in b) / len(b) - sum(a[rng.randrange(len(a))] for _ in a) / len(a)
        for _ in range(n)
    )
    return mb - ma, difs[int(0.025 * n)], difs[int(0.975 * n) - 1]


def binomial_dos_colas(b: int, c: int) -> float:
    """p exacto a dos colas de los discordantes (McNemar exacto): ¿son b y c distintos de 50/50?"""
    if b + c == 0:
        return 1.0
    return min(1.0, 2 * binomial_cola(max(b, c), b + c))


def media(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def precision(utiles: int, propuestas: int) -> float:
    """Fracción de propuestas que resultaron fuentes útiles. Sin propuestas, 0."""
    return utiles / propuestas if propuestas else 0.0


def cobertura(cubiertos: int, subtemas: int) -> float:
    """Fracción de subtemas con al menos una fuente buena. Sin subtemas, 0."""
    return cubiertos / subtemas if subtemas else 0.0


def coste_por_util(coste: float, utiles: int) -> float:
    """Coste por fuente útil. Sin útiles, el coste entero (penaliza no encontrar nada)."""
    return coste / utiles if utiles else coste


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
    return [(sum(x for x, _ in g) / len(g), sum(z for _, z in g) / len(g), len(g)) for g in grupos if g]
