"""Lo que Magister ha aprendido de tus valoraciones (confianza por dimensión, motivos, reglas quitadas).

Un documento JSON en la tabla `instalacion` (clave «afinado»), sin migración. La lógica está en `tono.confianza`;
aquí solo se lee y se actualiza con bloqueo de fila, para que dos juicios a la vez no se pisen.
"""

from collections.abc import Callable

from magister.datos.produccion import Ajuste
from magister.datos.sesion import nueva_sesion

CLAVE = "afinado"


async def leer() -> dict:
    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, CLAVE)
        return dict(fila.valor) if fila else {}


async def actualizar(cambio: Callable[[dict], dict]) -> dict:
    async with nueva_sesion() as s, s.begin():
        fila = await s.get(Ajuste, CLAVE, with_for_update=True)
        nuevo = cambio(dict(fila.valor) if fila else {})
        if fila:
            fila.valor = nuevo
        else:
            s.add(Ajuste(clave=CLAVE, valor=nuevo))
    return nuevo
