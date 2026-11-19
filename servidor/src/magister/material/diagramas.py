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


# Topes de tamaño (diagrama_chat.md: 12 cajas, 14 flechas, 40 textos, estilos por clase). Con atributos repetidos en cada
# elemento salían 6.500 caracteres de mediana y 10.600 como mucho (163 dibujos, 18-11-2026). No son reglas: un reintento
# es otra llamada cara, así que un dibujo válido que se pasa se da igual y solo se avisa en el registro.
MAX_CARACTERES = 6000
MAX_ELEMENTOS = 70  # formas y textos, con las tres puntas de flecha de <defs>
ELEMENTO = re.compile(r"<(rect|circle|ellipse|line|path|polyline|polygon|text)\b", re.I)
SOBRA = re.compile(r"<!--|<\s*(title|desc|metadata)\b", re.I)


def excesos(svg: str) -> list[str]:
    """Lo que se pasa de los topes, dicho como una regla (vacía si cabe)."""
    avisos = []
    if len(svg) > MAX_CARACTERES:
        avisos.append(f"svg: {len(svg)} caracteres, el tope es {MAX_CARACTERES}; los estilos van en el <style> por clase")
    n = len(ELEMENTO.findall(svg))
    if n > MAX_ELEMENTOS:
        avisos.append(f"svg: {n} formas y textos, el tope es {MAX_ELEMENTOS} (12 cajas, 14 flechas y 40 textos)")
    if SOBRA.search(svg):
        avisos.append("svg: sin comentarios, <title>, <desc> ni metadatos")
    return avisos


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
    svg = d.svg.strip()
    for aviso in excesos(svg):
        registro.warning("diagrama más grande de lo pedido: %s", aviso)
    return svg
