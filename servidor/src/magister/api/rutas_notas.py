"""Mis notas: guardar lo que te interesa de Estudio libre, verlo, comentarlo y borrarlo."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from magister.datos.modelos import Conversacion, Mensaje
from magister.datos.notas import Nota
from magister.datos.sesion import sesion_por_peticion

rutas = APIRouter(prefix="/api")


class NotaEntrada(BaseModel):
    texto: str = Field(min_length=1, max_length=40000)
    comentario: str | None = Field(None, max_length=4000)
    mensaje_id: int | None = None
    completa: bool = False


class NotaCambio(BaseModel):
    comentario: str | None = Field(None, max_length=4000)


def _salida(n: Nota) -> dict:
    return {"id": n.id, "texto": n.texto, "comentario": n.comentario, "mensaje_id": n.mensaje_id,
            "conversacion_id": n.conversacion_id, "origen": n.origen, "completa": n.completa,
            "creada_en": n.creada_en.isoformat()}


@rutas.get("/notas")
async def listar_notas(s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    return [_salida(n) for n in (await s.scalars(select(Nota).order_by(Nota.creada_en.desc(), Nota.id.desc()))).all()]


@rutas.post("/notas", status_code=201)
async def guardar_nota(e: NotaEntrada, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    texto = e.texto.strip()
    if not texto:
        raise HTTPException(422, "la nota está vacía")
    conversacion_id, origen = None, None
    if e.mensaje_id is not None:
        m = await s.get(Mensaje, e.mensaje_id)
        if m is None:
            raise HTTPException(404, "mensaje no encontrado")
        if e.completa:
            # La misma respuesta entera dos veces es la misma nota.
            ya = await s.scalar(select(Nota).where(Nota.mensaje_id == m.id, Nota.completa.is_(True)))
            if ya is not None:
                return _salida(ya)
        conversacion_id = m.conversacion_id
        c = await s.get(Conversacion, m.conversacion_id)
        origen = c.titulo if c else None
    n = Nota(texto=texto, comentario=(e.comentario or "").strip() or None, mensaje_id=e.mensaje_id,
             conversacion_id=conversacion_id, origen=origen, completa=e.completa and e.mensaje_id is not None)
    s.add(n)
    await s.commit()
    await s.refresh(n)
    return _salida(n)


@rutas.patch("/notas/{nid}")
async def cambiar_nota(nid: int, e: NotaCambio, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    n = await s.get(Nota, nid)
    if n is None:
        raise HTTPException(404, "nota no encontrada")
    n.comentario = (e.comentario or "").strip() or None
    await s.commit()
    await s.refresh(n)
    return _salida(n)


@rutas.delete("/notas/{nid}", status_code=204)
async def borrar_nota(nid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> None:
    n = await s.get(Nota, nid)
    if n is None:
        raise HTTPException(404, "nota no encontrada")
    await s.delete(n)
    await s.commit()
