"""Reranker local con un cross-encoder multilingüe (mMARCO). Para reordenar, apagado por defecto; se enciende por
consulta. Como segunda puerta de «hay fuentes», corre solo cuando el coseno no llega (ADR-0018).

Recibe `texto` (sin el encabezado contextual) para no empujar hacia el sesgo de cabecera.
"""

import threading
from dataclasses import replace

from magister.cerebro.contratos import Recuperado
from magister.config import ajustes

# Ahora también es la segunda puerta de «hay fuentes» (ADR-0018): se carga una vez aunque lo pidan a la vez el
# calentamiento del arranque y la primera búsqueda.
_modelos: dict[str, object] = {}
_candado = threading.Lock()


def _modelo(nombre: str):
    if (m := _modelos.get(nombre)) is not None:
        return m
    with _candado:
        if nombre not in _modelos:
            from sentence_transformers import CrossEncoder

            _modelos[nombre] = CrossEncoder(nombre, device="cpu")
        return _modelos[nombre]


def calentar() -> None:
    """Carga el cross-encoder (unos 5 s) para que la primera pregunta no lo espere. Con embeddings falsos, nada."""
    if ajustes.embeddings != "falso":
        _modelo(ajustes.reranker_modelo)


def reordenar(consulta: str, candidatos: list[Recuperado]) -> list[Recuperado]:
    if not candidatos:
        return []
    if ajustes.embeddings == "falso":
        puntos = [len(set(consulta.lower().split()) & set(c.texto.lower().split())) for c in candidatos]
    else:
        puntos = list(_modelo(ajustes.reranker_modelo).predict([(consulta, c.texto) for c in candidatos]))
    orden = sorted(range(len(candidatos)), key=lambda i: -float(puntos[i]))
    return [replace(candidatos[i], rango=n + 1, puntuacion=round(float(puntos[i]), 4)) for n, i in enumerate(orden)]
