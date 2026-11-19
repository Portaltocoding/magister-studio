"""Comprobar las citas sin modelo: que el id esté entre los recuperados y que la frase
del fragmento más parecida a la afirmación se parezca de verdad."""

import re
from dataclasses import dataclass

MARCA = re.compile(r"\[(\d{1,9})\]")
SIMILITUD_MIN = 0.12  # solapamiento de palabras con significado; criterio general
VACIAS = set(
    "el la los las un una unos unas de del al a en y o u e que se es son por para con sin lo le les su sus "
    "como más mas pero no si sí ya muy también este esta esto estos estas ese esa eso hay ha han".split()
)


@dataclass
class Cita:
    fragmento_id: int
    cita_literal: str
    dudosa: bool

    def a_dict(self) -> dict:
        return {"fragmento_id": self.fragmento_id, "cita_literal": self.cita_literal, "dudosa": self.dudosa}


def _palabras(t: str) -> set[str]:
    return {p for p in re.findall(r"\w+", t.lower()) if p not in VACIAS and len(p) > 2}


def _frases(t: str) -> list[str]:
    return [f.strip() for f in re.split(r"(?<=[.!?;:])\s+|\n+", t) if f.strip()]


def _afirmaciones(respuesta: str) -> dict[int, list[str]]:
    """Para cada id citado, las frases de la respuesta que lo llevan."""
    salida: dict[int, list[str]] = {}
    anterior = ""
    for frase in _frases(respuesta):
        limpia = MARCA.sub("", frase)
        # «… evidence. [7]»: la marca detrás del punto queda sola; es de la frase anterior.
        afirmacion = limpia if limpia.strip() else anterior
        for m in MARCA.finditer(frase):
            salida.setdefault(int(m.group(1)), []).append(afirmacion)
        if limpia.strip():
            anterior = limpia
    return salida


def comprobar(respuesta: str, fragmentos: dict[int, str]) -> list[Cita]:
    citas: list[Cita] = []
    for fid, afirmaciones in _afirmaciones(respuesta).items():
        if fid not in fragmentos:
            citas.append(Cita(fid, "", True))
            continue
        objetivo = set().union(*(_palabras(a) for a in afirmaciones))
        mejor, puntos = "", 0.0
        for frase in _frases(fragmentos[fid]):
            p = _palabras(frase)
            if not p or not objetivo:
                continue
            s = len(p & objetivo) / len(p | objetivo)
            if s > puntos:
                mejor, puntos = frase, s
        citas.append(Cita(fid, mejor[:500], puntos < SIMILITUD_MIN))
    return citas
