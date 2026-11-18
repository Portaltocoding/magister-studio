"""Los diagramas ricos del chat, dibujados aparte mientras el alumno lee.

El tutor escribe en su respuesta un bloque ```diagrama con el encargo (qué dibujar, con sus piezas y relaciones) y sigue
con el texto; la web, en cuanto el bloque se cierra, pide aquí el dibujo con el texto anterior como contexto. Así el
SVG (cientos de tokens) no retrasa la respuesta, y el dibujante tiene una receta para mapas de argumentos, de posiciones
y de ideas que el chat no tiene. Se guarda en la caché de respuestas: abrir otra vez la conversación no gasta.
"""

import logging
import re

from pydantic import BaseModel, Field

from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.prompts import cargar

registro = logging.getLogger("magister.diagramas")
PROHIBIDO = re.compile(r"<\s*(script|foreignObject|image|a)\b|\bhref\s*=|\bon[a-z]+\s*=", re.I)


class Dibujo(BaseModel):
    svg: str = Field(description="Un único elemento <svg>…</svg>.")


def reglas(d: Dibujo) -> list[str]:
    svg = d.svg.strip()
    errores = []
    if not svg.startswith("<svg") or not svg.endswith("</svg>"):
        errores.append("svg: tiene que ser un único elemento que empieza por <svg y acaba en </svg>")
    if PROHIBIDO.search(svg):
        errores.append("svg: nada de scripts, imágenes, enlaces, foreignObject ni manejadores de eventos")
    return errores


async def dibujar(encargo: str, contexto: str) -> str | None:
    """El SVG del encargo, o None si el modelo no da uno válido."""
    entrada = f"<explicacion>\n{contexto[-6000:]}\n</explicacion>\n\n<encargo>\n{encargo}\n</encargo>"
    try:
        d = await estructurar(cargar("diagrama_chat").rellenar(), entrada, Dibujo, reglas=reglas, cachear=True)
    except ErrorEstructura as e:
        registro.warning("diagrama sin salida válida: %s", e)
        return None
    return d.svg.strip()
