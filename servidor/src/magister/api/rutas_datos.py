"""Tus datos desde Ajustes: descargarlos todos, las copias de seguridad de la base y restaurar una.

Pasan por la protección de siempre (seguridad.py: token u origen propio). Restaurar sustituye todos tus datos: exige
un cuerpo JSON con la palabra RESTAURAR, y antes guarda una copia de cómo está todo ahora.
"""

import asyncio
import logging
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from magister.config import ajustes
from magister.datos import sesion
from magister.datos import tus_datos as td

rutas = APIRouter(prefix="/api/datos")

PALABRA = "RESTAURAR"
# Una copia o restauración a la vez: dos pg_dump o un restaurar a medias de otro no deben cruzarse.
_ocupado = asyncio.Lock()


def _ahora() -> datetime:
    return datetime.now(ZoneInfo(ajustes.zona))


def _base() -> tuple[str, str]:
    """La base que usa la app ahora mismo (la real, o la de pruebas en los tests) y su usuario."""
    url = sesion.motor().url
    return url.database or "", url.username or ""


@rutas.get("/exportar")
async def descargar() -> FileResponse:
    """magister-AAAA-MM-DD.zip: un JSON por tabla, el LEEME y tus ficheros hasta MAGISTER_EXPORTAR_MAX_MB."""
    carpeta = Path(await asyncio.to_thread(tempfile.mkdtemp, prefix="magister-exportar-"))
    try:
        zip_, _ = await td.paquete(_ahora(), carpeta, int(ajustes.exportar_max_mb * 1024 * 1024))
    except BaseException:
        await asyncio.to_thread(shutil.rmtree, carpeta, True)
        raise
    return FileResponse(zip_, media_type="application/zip", filename=zip_.name,
                        background=BackgroundTask(shutil.rmtree, carpeta, ignore_errors=True))


@rutas.get("/copias")
async def copias() -> dict:
    raiz = Path(ajustes.copias)
    return {"copias": await asyncio.to_thread(td.listar_copias, raiz), "ocupado": _ocupado.locked()}


@rutas.post("/copias", status_code=201)
async def copia_ahora() -> dict:
    if _ocupado.locked():
        raise HTTPException(409, "ya hay una copia o una restauración en marcha")
    async with _ocupado:
        base, usuario = _base()
        try:
            return await td.hacer_copia(_ahora(), Path(ajustes.copias), base, usuario, ajustes.contenedor_db,
                                        Path(ajustes.checkpoints))
        except td.ErrorCopia as e:
            raise HTTPException(500, f"No se ha podido hacer la copia: {e}") from e


COPIA_CADA_S = 3600
_registro = logging.getLogger("uvicorn.error")


async def copia_del_dia() -> bool:
    """Si aún no está la copia de hoy, la hace y rota (7 diarias, 4 semanales, 12 mensuales). True si la ha hecho."""
    raiz = Path(ajustes.copias)
    ahora = _ahora()
    if (raiz / "diarias" / f"magister-{ahora.date().isoformat()}.dump").is_file() or _ocupado.locked():
        return False
    async with _ocupado:
        base, usuario = _base()
        await td.hacer_copia(ahora, raiz, base, usuario, ajustes.contenedor_db, Path(ajustes.checkpoints))
        await asyncio.to_thread(td.rotar, raiz, ahora.date())
    return True


async def bucle_copia_diaria() -> None:
    """MAGISTER_COPIA_DIARIA (el modo Docker): al arrancar y cada hora, la copia del día si falta. Un fallo se apunta
    en el registro y se reintenta a la hora siguiente; nunca tumba la API."""
    while True:
        try:
            if await copia_del_dia():
                _registro.info("copia del día hecha en %s", ajustes.copias)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - la copia no puede tumbar la API
            _registro.exception("la copia del día ha fallado; se reintenta en una hora")
        await asyncio.sleep(COPIA_CADA_S)


class PedirRestaurar(BaseModel):
    copia: str
    confirmacion: str


@rutas.post("/copias/restaurar")
async def restaurar(cuerpo: PedirRestaurar) -> dict:
    if cuerpo.confirmacion.strip() != PALABRA:
        raise HTTPException(400, f"para restaurar escribe {PALABRA}")
    raiz = Path(ajustes.copias)
    try:
        copia = await asyncio.to_thread(td.copia_por_id, raiz, cuerpo.copia)
    except FileNotFoundError:
        raise HTTPException(404, "esa copia no existe") from None
    if _ocupado.locked():
        raise HTTPException(409, "ya hay una copia o una restauración en marcha")
    async with _ocupado:
        base, usuario = _base()
        try:
            hecho = await td.restaurar(copia, _ahora(), raiz, base, usuario, ajustes.contenedor_db)
        except td.ErrorCopia as e:
            raise HTTPException(500, str(e)) from e
        # Las conexiones abiertas conocían las tablas de antes: se cierran y las siguientes ven las restauradas.
        await sesion.motor().dispose()
    return {**hecho, "restaurada": cuerpo.copia}
