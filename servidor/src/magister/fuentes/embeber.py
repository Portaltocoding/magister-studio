"""Embeddings locales con sentence-transformers (e5) y el contador de tokens del chunker.

Con `MAGISTER_EMBEDDINGS=falso` (las pruebas) no se carga ningún modelo: vectores
deterministas por hash de palabras y tokens contados por palabras.
"""

import hashlib
import math
import re
from functools import cache

from magister.config import ajustes

DIMENSION = 384


@cache
def _modelo(nombre: str):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(nombre, device="cpu")


@cache
def _tokenizador(nombre: str):
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained(nombre)


def contar_tokens(texto: str, modelo: str | None = None) -> int:
    if ajustes.embeddings == "falso":
        return len(re.findall(r"\w+|[^\w\s]", texto))
    return len(_tokenizador(modelo or ajustes.embeddings_modelo).encode(texto, add_special_tokens=False))


def _falso(texto: str) -> list[float]:
    v = [0.0] * DIMENSION
    for palabra in re.findall(r"\w+", texto.lower()):
        h = int.from_bytes(hashlib.blake2b(palabra.encode(), digest_size=4).digest(), "big")
        v[h % DIMENSION] += 1.0
    norma = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norma for x in v]


def embeber(textos: list[str], tipo: str, params: dict | None = None) -> list[list[float]]:
    """`tipo` es `pasaje` o `consulta`. Prefijos y modelo salen de la configuración del índice."""
    params = params or {}
    prefijo = params.get("prefijo_pasaje", "passage: ") if tipo == "pasaje" else params.get("prefijo_consulta", "query: ")
    con_prefijo = [prefijo + t for t in textos]
    if ajustes.embeddings == "falso":
        return [_falso(t) for t in textos]
    modelo = _modelo(params.get("modelo", ajustes.embeddings_modelo))
    vectores = modelo.encode(con_prefijo, batch_size=32, normalize_embeddings=params.get("normalizar", True))
    return [list(map(float, v)) for v in vectores]
