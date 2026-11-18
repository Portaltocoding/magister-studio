"""La barra de uso: cuánto llevas de la sesión (5 h) y de la semana, y cuánto se comería una generación."""

from typing import Literal

from fastapi import APIRouter, Query

from magister.observar import cuota

rutas = APIRouter(prefix="/api/cuota", tags=["cuota"])


@rutas.get("")
async def estado() -> dict:
    return await cuota.estado()


@rutas.get("/estimar")
async def estimar(accion: Literal["video", "diapositivas", "material", "mensaje", "proyecto", "nivel", "plan"], minutos: int | None = Query(None, ge=1, le=60)) -> dict:
    return await cuota.estimar(accion, minutos)
