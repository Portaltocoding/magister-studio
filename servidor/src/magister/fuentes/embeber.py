"""Embeddings locales con sentence-transformers (e5) y el contador de tokens del chunker.

Con `MAGISTER_EMBEDDINGS=falso` (las pruebas) no se carga ningún modelo: vectores
deterministas por hash de palabras y tokens contados por palabras.
"""

import hashlib
import math
import re
import threading
from functools import cache

from magister.config import ajustes

DIMENSION = 384

# Cargar e5 lleva unos 20 s. Con un candado se carga una sola vez aunque lo pidan a la vez el calentamiento del
# arranque y la primera búsqueda (sin él se cargaba dos veces en paralelo y la búsqueda tardaba hasta 38 s).
_modelos: dict[str, object] = {}
_candado_modelo = threading.Lock()


def _modelo(nombre: str):
    if (m := _modelos.get(nombre)) is not None:
        return m
    with _candado_modelo:
        if nombre not in _modelos:
            from sentence_transformers import SentenceTransformer

            _modelos[nombre] = SentenceTransformer(nombre, device="cpu")
        return _modelos[nombre]


def modelo_listo(nombre: str | None = None) -> bool:
    """¿Está ya cargado el modelo de embeddings? (Con embeddings falsos, siempre.)"""
    return ajustes.embeddings == "falso" or (nombre or ajustes.embeddings_modelo) in _modelos


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
