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
from collections.abc import Awaitable, Callable

from pydantic import BaseModel, Field

from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.modelo import al_lanzar
from magister.cerebro.prompts import cargar
from magister.config import FUENTE_TEXTO

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


# Freno: peticiones iguales a la vez comparten una sola llamada. Un fallo de la web (pedía un dibujo por cada trozo de la
# respuesta) lanzó 77 llamadas en siete minutos; esto lo habría cortado. Cuántos se dibujan a la vez lo pone el cerebro
# (MAGISTER_DIAGRAMAS_A_LA_VEZ, cerebro/modelo.py: TOPES_PROMPT), alrededor del proceso: lo que está en la caché no hace
# cola, y lo que espera no ha lanzado nada. Si todos los que esperaban un dibujo se van antes de que salga de la cola,
# no se lanza; si ya está dibujándose, se acaba (y queda en la caché para cuando vuelvas).
_en_curso: dict[str, asyncio.Task] = {}
_interesados: dict[str, int] = {}
_lanzados: set[str] = set()
SONDEO_S = 1.0  # cada cuánto se mira si quien lo pidió sigue ahí


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


async def dibujar(encargo: str, contexto: str,
                  desconectado: Callable[[], Awaitable[bool]] | None = None) -> str | None:
    """El SVG del encargo, o None si el modelo no da uno válido o quien lo pidió se ha ido (`desconectado`, por
    ejemplo `request.is_disconnected`: una ruta normal no se cancela sola cuando cierras la pestaña)."""
    if _repetido(encargo, contexto, time.monotonic()):
        registro.warning("encargo de diagrama descartado: otro distinto con el mismo texto delante hace menos de %s s", VENTANA_S)
        return None
    clave = hashlib.sha256(f"{encargo}\x00{contexto[-6000:]}".encode()).hexdigest()
    tarea = _en_curso.get(clave)
    if tarea is None:
        tarea = asyncio.create_task(_dibujar(clave, encargo, contexto))
        _en_curso[clave] = tarea
        tarea.add_done_callback(lambda t: _en_curso.pop(clave) if _en_curso.get(clave) is t else None)
    _interesados[clave] = _interesados.get(clave, 0) + 1
    try:
        if desconectado is None:
            return await asyncio.shield(tarea)
        while not tarea.done():
            await asyncio.wait({tarea}, timeout=SONDEO_S)
            if not tarea.done() and await desconectado():
                return None
        return tarea.result()
    finally:
        _interesados[clave] -= 1
        if not _interesados[clave]:
            del _interesados[clave]
            if not tarea.done() and clave not in _lanzados:
                tarea.cancel()  # nadie lo espera y aún está en la cola: no se lanza
                if _en_curso.get(clave) is tarea:
                    del _en_curso[clave]  # quien lo pida ahora empieza de cero, no recibe la cancelación


async def _dibujar(clave: str, encargo: str, contexto: str) -> str | None:
    # Esta tarea tiene su propio contexto: el aviso solo lo oye su llamada.
    al_lanzar.set(lambda: _lanzados.add(clave))
    try:
        return await _llamar(encargo, contexto)
    finally:
        _lanzados.discard(clave)


_FUENTE_ATRIBUTO = re.compile(r"""\sfont-family\s*=\s*(?:"[^"]*"|'[^']*')""", re.I)
_FUENTE_ESTILO = re.compile(r"font-family\s*:[^;}\"']*(?:'[^']*'[^;}\"']*)*;?", re.I)


def normalizar_fuente(svg: str) -> str:
    """Quita todo font-family que escriba el modelo y fija la tipografía de la app en el <svg> raíz."""
    svg = _FUENTE_ATRIBUTO.sub("", svg)
    svg = _FUENTE_ESTILO.sub("", svg)
    return re.sub(r"<svg\b", f'<svg font-family="{FUENTE_TEXTO.replace(chr(34), chr(39))}"', svg, count=1)


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
    return normalizar_fuente(svg)
