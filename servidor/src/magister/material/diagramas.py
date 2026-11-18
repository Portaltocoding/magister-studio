"""Los diagramas ricos del chat, dibujados aparte mientras el alumno lee.

El tutor escribe en su respuesta un bloque ```diagrama con el encargo (qué dibujar, con sus piezas y relaciones) y sigue
con el texto; la web, en cuanto el bloque se cierra, pide aquí el dibujo con el texto anterior como contexto. Así el
SVG (cientos de tokens) no retrasa la respuesta, y el dibujante tiene una receta para mapas de argumentos, de posiciones
y de ideas que el chat no tiene. Se guarda en la caché de respuestas: abrir otra vez la conversación no gasta.
"""

import asyncio
import hashlib
import logging
import re
import time

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


# Freno: peticiones iguales a la vez comparten una sola llamada, y como mucho se dibujan dos diagramas a la vez. Un fallo
# de la web (pedía un dibujo por cada trozo de la respuesta) lanzó 77 llamadas en siete minutos; esto lo habría cortado.
A_LA_VEZ = 2
_en_curso: dict[str, asyncio.Task] = {}
_turnos: dict[int, asyncio.Semaphore] = {}


_recientes: dict[str, tuple[float, str]] = {}  # contexto -> (cuándo, encargo)
VENTANA_S = 60


def _repetido(encargo: str, contexto: str, ahora: float) -> bool:
    """Dos encargos distintos con el mismo texto delante en menos de un minuto son trozos del mismo encargo a medio
    llegar (dos diagramas de una respuesta tienen distinto texto delante): no se dibujan."""
    clave = hashlib.sha256(contexto[-6000:].encode()).hexdigest()
    for k, (t, _e) in list(_recientes.items()):
        if ahora - t > VENTANA_S:
            del _recientes[k]
    previo = _recientes.get(clave)
    _recientes[clave] = (ahora, encargo)
    return previo is not None and previo[1] != encargo


async def dibujar(encargo: str, contexto: str) -> str | None:
    """El SVG del encargo, o None si el modelo no da uno válido."""
    if _repetido(encargo, contexto, time.monotonic()):
        registro.warning("encargo de diagrama descartado: otro distinto con el mismo texto delante hace menos de %s s", VENTANA_S)
        return None
    clave = hashlib.sha256(f"{encargo}\x00{contexto[-6000:]}".encode()).hexdigest()
    tarea = _en_curso.get(clave)
    if tarea is None:
        tarea = asyncio.create_task(_dibujar(encargo, contexto))
        _en_curso[clave] = tarea
        tarea.add_done_callback(lambda _t: _en_curso.pop(clave, None))
    return await asyncio.shield(tarea)


async def _dibujar(encargo: str, contexto: str) -> str | None:
    turno = _turnos.setdefault(id(asyncio.get_running_loop()), asyncio.Semaphore(A_LA_VEZ))
    async with turno:
        return await _llamar(encargo, contexto)


async def _llamar(encargo: str, contexto: str) -> str | None:
    entrada =f"<explicacion>\n{contexto[-6000:]}\n</explicacion>\n\n<encargo>\n{encargo}\n</encargo>"
    try:
        d = await estructurar(cargar("diagrama_chat").rellenar(), entrada, Dibujo, reglas=reglas, cachear=True)
    except ErrorEstructura as e:
        registro.warning("diagrama sin salida válida: %s", e)
        return None
    return d.svg.strip()
