"""Normalizar, hash del texto y casi duplicados con MinHash escrito a mano.

Parámetros: 128 funciones hash, shingles de 5 palabras, LSH con 16 bandas de 8 filas
(dos textos con Jaccard 0,8 comparten al menos una banda con probabilidad ~0,9996),
y el umbral 0,8 se aplica sobre el Jaccard exacto, no sobre la estimación.
"""

import hashlib
import random
import re

N_FUNCIONES = 128
N_PALABRAS = 5
BANDAS = 16
FILAS = 8
UMBRAL = 0.8
PRIMO = (1 << 61) - 1
_rng = random.Random(20261103)  # fija: las firmas tienen que ser comparables entre ejecuciones
_COEF = [(_rng.randrange(1, PRIMO), _rng.randrange(0, PRIMO)) for _ in range(N_FUNCIONES)]


def normalizar(texto: str) -> str:
    """Une guiones de fin de línea y colapsa espacios. Conserva mayúsculas y saltos de párrafo."""
    t = texto.replace("\r\n", "\n").replace("­", "")
    t = re.sub(r"(\w)-\n(\w)", r"\1\2", t)
    t = re.sub(r"[ \t\f\v]+", " ", t)
    t = re.sub(r" *\n *", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def hash_texto(texto_normalizado: str) -> str:
    plano = re.sub(r"\s+", " ", texto_normalizado.lower()).strip()
    return hashlib.sha256(plano.encode("utf-8")).hexdigest()


def shingles(texto: str) -> set[int]:
    palabras = re.findall(r"\w+", texto.lower())
    if len(palabras) < N_PALABRAS:
        palabras += [""] * (N_PALABRAS - len(palabras))
    return {
        int.from_bytes(hashlib.blake2b(" ".join(palabras[i : i + N_PALABRAS]).encode(), digest_size=8).digest(), "big")
        for i in range(len(palabras) - N_PALABRAS + 1)
    }


def firma(texto: str) -> list[int]:
    s = shingles(texto)
    # Se guarda en bigint con signo: el valor cabe porque es menor que 2^61.
    return [min((a * x + b) % PRIMO for x in s) for a, b in _COEF]


def bandas(f: list[int]) -> list[str]:
    return [hashlib.md5(str(f[i * FILAS : (i + 1) * FILAS]).encode()).hexdigest() for i in range(BANDAS)]


def jaccard(a: str, b: str) -> float:
    sa, sb = shingles(a), shingles(b)
    if not sa and not sb:
        return 1.0
    return len(sa & sb) / len(sa | sb)
