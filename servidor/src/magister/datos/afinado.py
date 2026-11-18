"""Lo que Magister ha aprendido de tus valoraciones (confianza por dimensión, motivos, reglas quitadas).

Un documento JSON en la tabla `instalacion` (clave «afinado»), sin migración. La lógica está en `tono.confianza`;
aquí solo se lee y se actualiza con bloqueo de fila, para que dos juicios a la vez no se pisen.
"""

from collections.abc import Callable

from sqlalchemy.dialects.postgresql import insert

from magister.datos.produccion import Ajuste
from magister.datos.sesion import nueva_sesion

CLAVE = "afinado"


async def leer() -> dict:
    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, CLAVE)
        return dict(fila.valor) if fila else {}


async def actualizar(cambio: Callable[[dict], dict]) -> dict:
    async with nueva_sesion() as s, s.begin():
        # Primero la fila existe (si dos llegan a la vez sin ella, la segunda no falla) y luego se bloquea.
        await s.execute(insert(Ajuste).values(clave=CLAVE, valor={}).on_conflict_do_nothing(index_elements=[Ajuste.clave]))
        fila = await s.get(Ajuste, CLAVE, with_for_update=True, populate_existing=True)
        nuevo = cambio(dict(fila.valor or {}))
        fila.valor = nuevo
    return nuevo
