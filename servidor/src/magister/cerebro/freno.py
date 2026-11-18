"""El freno: nada en Magister puede disparar llamadas al modelo sin control.

Pasó el 18-11-2026: un fallo de la web pidió un diagrama por cada trozo de una respuesta y en una hora hizo 162
llamadas (1,3 millones de tokens de salida), y se comió casi toda la sesión y una parte de la semana. Ningún arreglo
de una pieza concreta basta: el freno está en el único sitio por el que pasan todas las llamadas (cerebro/modelo.py,
antes de lanzar claude), así que vale para el chat, los diagramas, los vídeos, los apuntes, los jueces y lo que venga.

- Por prompt: más de MAGISTER_FRENO_POR_PROMPT llamadas en MAGISTER_FRENO_VENTANA_S y ese prompt se para entero
  durante otra ventana.
- En total: más de MAGISTER_FRENO_TOTAL llamadas en la ventana y se para todo durante otra ventana.
- Al saltar, avisa una vez (los ganchos de `registrar_aviso`: la API lo convierte en una alerta que ves arriba).

Una llamada frenada no lanza ningún proceso ni gasta nada: falla al momento con un mensaje claro.
"""

import logging
import time
from collections import deque
from collections.abc import Callable

from magister.config import ajustes

registro = logging.getLogger("magister.freno")
TODO = "*"

_llamadas: deque[tuple[float, str]] = deque()
_parados: dict[str, float] = {}  # clave (prompt o TODO) -> hasta cuándo
_avisos: list[Callable[[str, str], None]] = []


def registrar_aviso(fn: Callable[[str, str], None]) -> None:
    """`fn(clave, detalle)` se llama una vez cada vez que salta el freno."""
    if fn not in _avisos:
        _avisos.append(fn)


def reiniciar() -> None:
    _llamadas.clear()
    _parados.clear()


def _avisar(clave: str, detalle: str) -> None:
    registro.error("freno: %s", detalle)
    for fn in list(_avisos):
        try:
            fn(clave, detalle)
        except Exception:  # noqa: BLE001  (la instrumentación nunca rompe una petición)
            registro.exception("el aviso del freno ha fallado")


def comprobar(prompt: str | None, ahora: float | None = None) -> None:
    """Anota una llamada o, si se pasa, lanza `Frenado` sin anotarla. Se llama justo antes de lanzar claude."""
    ahora = time.monotonic() if ahora is None else ahora
    ventana, por_prompt, total = ajustes.freno_ventana_s, ajustes.freno_por_prompt, ajustes.freno_total
    clave = prompt or "sin_prompt"
    while _llamadas and ahora - _llamadas[0][0] > ventana:
        _llamadas.popleft()
    for k in [k for k, hasta in _parados.items() if hasta <= ahora]:
        del _parados[k]
    for k in (TODO, clave):
        if k in _parados:
            minutos = max(1, round((_parados[k] - ahora) / 60))
            que = "todas las llamadas al modelo" if k == TODO else f"«{clave}»"
            raise Frenado(f"freno: {que} en pausa {minutos} min más por demasiadas llamadas seguidas")
    del_prompt = sum(1 for _, k in _llamadas if k == clave)
    if del_prompt >= por_prompt:
        _parados[clave] = ahora + ventana
        detalle = (f"«{clave}» ha hecho {del_prompt} llamadas en {ventana // 60} min (el tope es {por_prompt}): "
                   f"se para {ventana // 60} min. Si no lo has pedido tú, es un fallo que repite llamadas.")
        _avisar(clave, detalle)
        raise Frenado(f"freno: «{clave}» en pausa por demasiadas llamadas seguidas")
    if len(_llamadas) >= total:
        _parados[TODO] = ahora + ventana
        detalle = (f"{len(_llamadas)} llamadas al modelo en {ventana // 60} min (el tope es {total}): se para todo "
                   f"{ventana // 60} min.")
        _avisar(TODO, detalle)
        raise Frenado("freno: todas las llamadas al modelo en pausa por demasiadas llamadas seguidas")
    _llamadas.append((ahora, clave))


def estado(ahora: float | None = None) -> dict:
    ahora = time.monotonic() if ahora is None else ahora
    return {"parados": {k: round(hasta - ahora) for k, hasta in _parados.items() if hasta > ahora},
            "llamadas_en_ventana": sum(1 for t, _ in _llamadas if ahora - t <= ajustes.freno_ventana_s)}


class Frenado(Exception):
    """Lo lanza `comprobar`; modelo.py lo convierte en ErrorModelo (no transitorio: no se reintenta)."""
