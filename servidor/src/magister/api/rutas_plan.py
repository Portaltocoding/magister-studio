"""El plan aceptado, el recálculo tras un atraso y el calendario (v0.2)."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from magister.datos import plan as dp
from magister.datos.sesion import sesion_por_peticion
from magister.flujo import planes

rutas = APIRouter(prefix="/api")


class Recalcular(BaseModel):
    desde: date


class Reajuste(BaseModel):
    sesiones: list[dict]


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


class Horario(BaseModel):
    # De lunes a domingo.
    horas_por_dia: list[float] = Field(min_length=7, max_length=7)
    inicio_por_dia: list[str | None] = Field(min_length=7, max_length=7)


@rutas.put("/temas/{tema_id}/plan/horario")
async def cambiar_horario(tema_id: int, cuerpo: Horario, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Cambia cuántas horas y a qué hora estudias cada día, y recoloca lo pendiente desde hoy."""
    from datetime import date

    if any(h < 0 or h > 12 for h in cuerpo.horas_por_dia) or sum(cuerpo.horas_por_dia) <= 0:
        raise HTTPException(422, "Pon entre 0 y 12 horas por día, y al menos un día con horas.")
    fila = await dp.plan_aceptado(s, tema_id)
    if fila is None:
        raise HTTPException(404, "este tema no tiene plan aceptado")
    fila.perfil = {**(fila.perfil or {}), "horas_por_dia": cuerpo.horas_por_dia, "inicio_por_dia": cuerpo.inicio_por_dia}
    await s.flush()
    r = await planes.recalcular(s, tema_id, date.today())
    if isinstance(r, str):
        await s.rollback()
        raise HTTPException(409, r)
    await s.commit()
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


@rutas.post("/temas/{tema_id}/plan/reajuste")
async def proponer_reajuste(tema_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    from datetime import datetime, timezone

    r = await planes.proponer_reajuste(s, tema_id, datetime.now(timezone.utc))
    if r is None:
        raise HTTPException(404, "este tema no tiene plan aceptado")
    return r


@rutas.post("/temas/{tema_id}/plan/reajuste/aceptar")
async def aceptar_reajuste(tema_id: int, cuerpo: Reajuste, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    r = await planes.aplicar_reajuste(s, tema_id, cuerpo.sesiones, date.today())
    if r is None:
        raise HTTPException(404, "este tema no tiene plan aceptado")
    return r
