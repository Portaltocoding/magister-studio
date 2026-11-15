"""Reranker local con un cross-encoder. Apagado por defecto; se enciende por consulta.

Recibe `texto` (sin el encabezado contextual) para no empujar hacia el sesgo de cabecera.
"""

from dataclasses import replace
from functools import cache

from magister.cerebro.contratos import Recuperado
from magister.config import ajustes


@cache
def _modelo(nombre: str):
    from sentence_transformers import CrossEncoder

    return CrossEncoder(nombre, device="cpu")


def reordenar(consulta: str, candidatos: list[Recuperado]) -> list[Recuperado]:
    if not candidatos:
        return []
    if ajustes.embeddings == "falso":
        puntos = [len(set(consulta.lower().split()) & set(c.texto.lower().split())) for c in candidatos]
    else:
        puntos = list(_modelo(ajustes.reranker_modelo).predict([(consulta, c.texto) for c in candidatos]))
    orden = sorted(range(len(candidatos)), key=lambda i: -float(puntos[i]))
    return [replace(candidatos[i], rango=n + 1, puntuacion=round(float(puntos[i]), 4)) for n, i in enumerate(orden)]
