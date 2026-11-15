"""El plan aceptado, el recálculo tras un atraso y el calendario (v0.2)."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from magister.datos import plan as dp
from magister.datos.sesion import sesion_por_peticion
from magister.flujo import planes

rutas = APIRouter(prefix="/api")


class Recalcular(BaseModel):
    desde: date


class EstadoSesion(BaseModel):
    estado: Literal["pendiente", "hecha", "saltada"]


@rutas.get("/planes")
async def listar_planes(s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    return await planes.resumen_planes(s, date.today())


@rutas.get("/temas/{tema_id}/plan")
async def ver_plan(tema_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    vista = await planes.vista_plan(s, tema_id, date.today())
    if vista is None:
        raise HTTPException(404, "este tema no tiene plan aceptado")
    return vista


@rutas.post("/temas/{tema_id}/plan/recalcular")
async def recalcular(tema_id: int, cuerpo: Recalcular, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    r = await planes.recalcular(s, tema_id, cuerpo.desde)
    if r is None:
        raise HTTPException(404, "este tema no tiene plan aceptado")
    if isinstance(r, str):
        raise HTTPException(409, r)
    return r


@rutas.patch("/sesiones/{sesion_id}")
async def marcar_sesion(sesion_id: int, cuerpo: EstadoSesion, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    fila = await dp.marcar_sesion(s, sesion_id, cuerpo.estado)
    if fila is None:
        raise HTTPException(404, "sesión no encontrada")
    return {"id": fila.id, "estado": fila.estado}


@rutas.get("/calendario")
async def ver_calendario(
    desde: date | None = None, hasta: date | None = None, s: AsyncSession = Depends(sesion_por_peticion)
) -> list[dict]:
    inicio = desde or date.today() - timedelta(days=date.today().weekday())
    return await planes.calendario(s, inicio, hasta or inicio + timedelta(days=27))
