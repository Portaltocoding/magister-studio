"""Tus datos desde Ajustes: descargarlos todos, las copias de seguridad de la base y restaurar una.

Pasan por la protección de siempre (seguridad.py: token u origen propio). Restaurar sustituye todos tus datos: exige
un cuerpo JSON con la palabra RESTAURAR, y antes guarda una copia de cómo está todo ahora.
"""

import asyncio
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
