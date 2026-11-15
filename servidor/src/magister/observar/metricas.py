"""Métricas deterministas de una salida del modelo. Puras: sin modelo ni base."""

import json
import unicodedata
from functools import cache
from pathlib import Path

from magister.tono.lint import revisar

NEGATIVAS = Path(__file__).parent / "negativas.txt"


def _norm(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if not unicodedata.combining(c))


@cache
def giros_negativa() -> tuple[str, ...]:
    return tuple(_norm(x.strip()) for x in NEGATIVAS.read_text(encoding="utf-8").splitlines() if x.strip() and not x.startswith("#"))


def json_valido(salida: str) -> float:
    try:
        json.loads(salida)
        return 1.0
    except (ValueError, TypeError):
        return 0.0


def negativa(salida: str) -> float:
    inicio = _norm(salida[:400])
    return 1.0 if any(g in inicio for g in giros_negativa()) else 0.0


def vacia(salida: str) -> float:
    return 1.0 if len(salida.strip()) < 2 else 0.0


def lint_tono(salida: str) -> float:
    """1 si no hay ningún veto ni aviso del lint de la Parte IV."""
    return 0.0 if any(h.gravedad in ("veto", "aviso") for h in revisar(salida)) else 1.0


def todas(salida: str, estructurada: bool) -> dict[str, float]:
    m = {"negativa": negativa(salida), "vacia": vacia(salida)}
    if estructurada:
        m["json_valido"] = json_valido(salida)
    else:
        m["lint_tono"] = lint_tono(salida)
    return m
