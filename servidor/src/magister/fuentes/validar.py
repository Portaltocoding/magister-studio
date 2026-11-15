"""Validar mira, normalizar cambia. Lo que no es texto va a cuarentena con su motivo."""

import re
import unicodedata
from dataclasses import dataclass

from magister.config import ajustes
from magister.fuentes.extraer import Extraido

LONGITUD_MIN = 80  # caracteres; criterio general


@dataclass
class Problema:
    codigo: str
    motivo: str


def fraccion_valida(texto: str) -> float:
    if not texto:
        return 0.0
    validos = sum(
        1 for c in texto if c.isspace() or unicodedata.category(c)[0] in ("L", "N", "P", "S") and c != "�"
    )
    return validos / len(texto)


def _f(x: float) -> str:
    return f"{x:.2f}".replace(".", ",")


def validar(e: Extraido) -> list[Problema]:
    problemas: list[Problema] = []
    texto = e.texto.strip()
    sin_enlaces = re.sub(r"https?://\S+", "", texto).strip()
    if len(sin_enlaces) < LONGITUD_MIN:
        problemas.append(Problema("sin_contenido", f"solo {len(sin_enlaces)} caracteres de texto (mínimo {LONGITUD_MIN})"))
        return problemas
    if "paginas" in e.metadatos:
        total = int(e.metadatos["paginas"]) or 1
        con = int(e.metadatos.get("paginas_con_texto", total))
        fraccion = con / total
        if fraccion < ajustes.paginas_min:
            problemas.append(
                Problema("paginas_sin_texto", f"páginas con texto {_f(fraccion)} < {_f(ajustes.paginas_min)} (¿escaneado?)")
            )
    validez = fraccion_valida(texto)
    if validez < ajustes.validez_min:
        problemas.append(Problema("caracteres", f"validez {_f(validez)} < {_f(ajustes.validez_min)}"))
    return problemas
