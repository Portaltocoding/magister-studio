"""Caché exacta de respuestas estructuradas (material, evals y juez; nunca la conversación).

Clave: SHA-256 del prompt renderizado, la entrada, el modelo, el motor y la versión de la
plantilla. Vive en la tabla `cache_respuestas` (la crea `datos`); el cerebro la lee con SQL
crudo y una conexión propia para no importar de `datos`.
"""

import hashlib
import json
import logging

from magister.config import ajustes

registro = logging.getLogger("magister.cache")


def clave(sistema: str, entrada: str, modelo: str, prompt: tuple[str, str] | None) -> str:
    return hashlib.sha256(json.dumps([sistema, entrada, modelo, ajustes.motor, prompt], ensure_ascii=False).encode()).hexdigest()


async def _conexion():
    import asyncpg

    url = ajustes.db_url_sim if ajustes.simulado else ajustes.db_url
    return await asyncpg.connect(url.replace("postgresql+asyncpg://", "postgresql://", 1))


async def leer(sistema: str, entrada: str, modelo: str, prompt) -> dict | None:
    try:
        c = await _conexion()
        try:
            fila = await c.fetchrow(
                "update cache_respuestas set aciertos = aciertos + 1 where clave = $1 returning respuesta", clave(sistema, entrada, modelo, prompt))
        finally:
            await c.close()
    except Exception:  # noqa: BLE001 sin caché se sigue igual
        return None
    return json.loads(fila["respuesta"]) if fila else None


async def escribir(sistema: str, entrada: str, modelo: str, prompt, respuesta: dict) -> None:
    try:
        c = await _conexion()
        try:
            await c.execute(
                "insert into cache_respuestas (clave, respuesta, modelo) values ($1, $2, $3) on conflict (clave) do nothing",
                clave(sistema, entrada, modelo, prompt), json.dumps(respuesta, ensure_ascii=False), modelo)
        finally:
            await c.close()
    except Exception:  # noqa: BLE001
        registro.debug("no se pudo escribir en la caché")
