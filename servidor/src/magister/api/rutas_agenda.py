"""Tu agenda en el calendario: crear, ver, editar y borrar tus eventos."""

from datetime import date, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from magister.datos.agenda import Evento
from magister.datos.sesion import sesion_por_peticion

rutas = APIRouter(prefix="/api")

Tipo = Literal["deber", "examen", "clase", "nota"]


class EventoEntrada(BaseModel):
    fecha: date
    hora: time | None = None
    titulo: str = Field(min_length=1, max_length=200)
    tipo: Tipo = "deber"
    quien: str | None = Field(None, max_length=120)
    notas: str | None = Field(None, max_length=4000)
    tema_id: int | None = None


class EventoCambio(BaseModel):
    fecha: date | None = None
    hora: time | None = None
    titulo: str | None = Field(None, min_length=1, max_length=200)
    tipo: Tipo | None = None
    quien: str | None = Field(None, max_length=120)
    notas: str | None = Field(None, max_length=4000)
    hecho: bool | None = None


def _salida(e: Evento) -> dict:
    return {"id": e.id, "fecha": e.fecha.isoformat(), "hora": e.hora.strftime("%H:%M") if e.hora else None,
            "titulo": e.titulo, "tipo": e.tipo, "quien": e.quien, "notas": e.notas, "hecho": e.hecho, "tema_id": e.tema_id}


@rutas.get("/eventos")
async def listar(desde: date | None = None, hasta: date | None = None, s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    inicio = desde or date.today() - timedelta(days=31)
    fin = hasta or inicio + timedelta(days=62)
    filas = (await s.scalars(select(Evento).where(Evento.fecha >= inicio, Evento.fecha <= fin)
                             .order_by(Evento.fecha, Evento.hora.nulls_last(), Evento.id))).all()
    return [_salida(e) for e in filas]


@rutas.get("/eventos/pendientes")
async def pendientes(s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    """Deberes y exámenes sin hacer, de los atrasados a los próximos."""
    filas = (await s.scalars(select(Evento).where(Evento.hecho.is_(False), Evento.tipo.in_(("deber", "examen")))
                             .order_by(Evento.fecha, Evento.hora.nulls_last()).limit(30))).all()
    return [_salida(e) for e in filas]


@rutas.post("/eventos", status_code=201)
async def crear(cuerpo: EventoEntrada, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    e = Evento(**cuerpo.model_dump())
    s.add(e)
    await s.commit()
    await s.refresh(e)
    return _salida(e)


@rutas.patch("/eventos/{eid}")
async def cambiar(eid: int, cuerpo: EventoCambio, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    e = await s.get(Evento, eid)
    if e is None:
        raise HTTPException(404, "evento no encontrado")
    for k, v in cuerpo.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    await s.commit()
    await s.refresh(e)
    return _salida(e)


@rutas.delete("/eventos/{eid}", status_code=204)
async def borrar(eid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> None:
    e = await s.get(Evento, eid)
    if e is None:
        raise HTTPException(404, "evento no encontrado")
    await s.delete(e)
    await s.commit()
