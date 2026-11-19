"""La barra de uso: cuánto llevas de la sesión (5 h) y de la semana, y cuánto se comería una generación."""

from typing import Literal

from fastapi import APIRouter, Query

from magister.observar import cuota

rutas = APIRouter(prefix="/api/cuota", tags=["cuota"])


@rutas.get("")
async def estado() -> dict:
    return await cuota.estado()


@rutas.get("/estimar")
async def estimar(accion: Literal["video", "diapositivas", "material", "mensaje", "proyecto", "nivel", "plan", "research"], minutos: int | None = Query(None, ge=1, le=60),
                  lecciones: int | None = Query(None, ge=1, le=100)) -> dict:
    """`lecciones`, con material o research: lo de varias lecciones a la vez."""
    return await cuota.estimar(accion, minutos, lecciones)
