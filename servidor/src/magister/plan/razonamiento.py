"""El razonamiento del plan tal como lo lee el alumno: sin jerga del esquema y sin cifras que contradigan al plan.

Código puro. El prompt ya pide tutear, no nombrar campos y no dar horas (cerebro/prompts/planificar.md); esto es la red
para cuando el modelo se lo salta: las cifras de horas las pone el código, que es quien las sabe.
"""

import re

from magister.plan.reglas import fmt

ALCANCE_DICHO = {
    "procedimiento": "un procedimiento concreto",
    "concepto": "un concepto concreto",
    "tema": "un tema de una asignatura",
    "tema_amplio": "un tema amplio, con mucha práctica",
    "tema_master": "un tema de máster, de lecturas y discusión",
    "asignatura": "una asignatura entera",
}

_CAMPO_ALCANCE = re.compile(r"\balcance\s*:\s*«?([a-z_]+)»?\s*\.?", re.I)
_SNAKE = re.compile(r"\b([a-záéíóúñ]+(?:_[a-záéíóúñ]+)+)\b", re.I)
_HORAS = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:h\b|horas?\b)", re.I)
_FRASES = re.compile(r"(?<=[.!?…])\s+")


def _numero(t: str) -> float:
    return round(float(t.replace(",", ".")), 2)


def pulir_razonamiento(texto: str, horas_lecciones: list[float], horas_validas: set[float] = frozenset()) -> str:
    """Quita «Alcance: tema_amplio.» (lo dice con palabras), los nombres con guion bajo y las frases que citan horas
    que no salen del plan (ni el total, ni las de una lección, ni las de `horas_validas`, como las de tu horario).
    Si quitó alguna, el total lo pone el código al final."""
    total = round(sum(horas_lecciones), 2)
    validas = {total, *(round(h, 2) for h in horas_lecciones), *(round(h, 2) for h in horas_validas)}
    texto = _CAMPO_ALCANCE.sub(lambda m: f"Es {ALCANCE_DICHO[m.group(1).lower()]}." if m.group(1).lower() in ALCANCE_DICHO
                               else "", texto)
    texto = _SNAKE.sub(lambda m: m.group(1).replace("_", " "), texto)
    quitadas = False
    lineas = []
    for linea in texto.split("\n"):
        frases = []
        for frase in _FRASES.split(linea):
            cifras = {_numero(x) for x in _HORAS.findall(frase)}
            if cifras - validas:
                quitadas = True
                continue
            frases.append(frase)
        if frases or not linea.strip():
            lineas.append(" ".join(frases))
    salida = re.sub(r"\n{3,}", "\n\n", "\n".join(lineas)).strip()
    if quitadas:
        n = len(horas_lecciones)
        cierre = f"En total son {fmt(total)} h en {n} {'lección' if n == 1 else 'lecciones'}."
        salida = f"{salida}\n\n{cierre}" if salida else cierre
    return salida
