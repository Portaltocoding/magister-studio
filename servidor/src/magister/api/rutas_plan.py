"""El plan aceptado, el recálculo tras un atraso y el calendario (v0.2)."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from magister.datos import plan as dp
from magister.datos.sesion import sesion_por_peticion
from magister.flujo import planes
from magister.plan.apoyo import necesidad_efectiva
from magister.plan.esquemas import Necesidad

rutas = APIRouter(prefix="/api")


class Recalcular(BaseModel):
    desde: date


class Reajuste(BaseModel):
    sesiones: list[dict]


class EstadoSesion(BaseModel):
    estado: Literal["pendiente", "hecha", "saltada"]


class NecesitaFuentes(BaseModel):
    necesita_fuentes: Necesidad


POR_QUE_TUYO = "Lo has decidido tú."


async def con_necesidad(s: AsyncSession, vista: dict) -> dict:
    """Añade a cada lección de la vista si necesita fuentes y por qué (ADR-0021). Si tienes material tuyo del tema,
    ninguna sale como «no»: tus apuntes mandan."""
    filas = {lec.clave: lec for lec in await dp.lecciones(s, vista["plan_id"])}
    propio = await dp.material_propio_de_tema(s, vista["tema_id"]) > 0
    for lec in vista.get("lecciones", []):
        fila = filas.get(lec["clave"])
        guardada = fila.necesita_fuentes if fila else None
        valor, por_que = necesidad_efectiva(guardada, fila.fuentes_por_que if fila else None, propio)
        # `necesita_fuentes` es la que se usa; `necesita_fuentes_guardada`, la del plan o la tuya (el chip la enseña
        # aparte cuando tu material la cambia, para que puedas elegir otra).
        lec.update(necesita_fuentes=valor, fuentes_por_que=por_que, material_propio=propio,
                   necesita_fuentes_guardada=guardada)
    return vista


@rutas.get("/planes")
async def listar_planes(s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    return await planes.resumen_planes(s, date.today())


@rutas.get("/temas/{tema_id}/plan")
async def ver_plan(tema_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    vista = await planes.vista_plan(s, tema_id, date.today())
    if vista is None:
        raise HTTPException(404, "este tema no tiene plan aceptado")
    return await con_necesidad(s, vista)


@rutas.patch("/planes/{plan_id}/lecciones/{clave}/fuentes")
async def cambiar_necesidad(plan_id: int, clave: str, cuerpo: NecesitaFuentes,
                            s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Cambias si esta lección necesita fuentes: con «no», el research automático y «Buscar fuentes» de todo el plan se
    la saltan (pedirla a mano en su fila sigue buscando)."""
    fila = await dp.cambiar_necesidad(s, plan_id, clave, cuerpo.necesita_fuentes, POR_QUE_TUYO)
    if fila is None:
        raise HTTPException(404, "lección no encontrada")
    return {"plan_id": plan_id, "clave": clave, "necesita_fuentes": fila.necesita_fuentes, "fuentes_por_que": fila.fuentes_por_que}


@rutas.post("/temas/{tema_id}/plan/recalcular")
async def recalcular(tema_id: int, cuerpo: Recalcular, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    r = await planes.recalcular(s, tema_id, cuerpo.desde)
    if r is None:
        raise HTTPException(404, "este tema no tiene plan aceptado")
    if isinstance(r, str):
        raise HTTPException(409, r)
    return await con_necesidad(s, r)


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
    return await con_necesidad(s, r)


@rutas.patch("/sesiones/{sesion_id}")
async def marcar_sesion(sesion_id: int, cuerpo: EstadoSesion, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    fila = await dp.marcar_sesion(s, sesion_id, cuerpo.estado)
    if fila is None:
        raise HTTPException(404, "sesión no encontrada")
    return {"id": fila.id, "estado": fila.estado}


@rutas.patch("/planes/{plan_id}/lecciones/{clave}/hecha")
async def marcar_leccion(plan_id: int, clave: str, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Cerrar una lección: todas sus sesiones pendientes pasan a hechas, también las de otros días."""
    return {"plan_id": plan_id, "clave": clave, "marcadas": await dp.marcar_leccion_hecha(s, plan_id, clave)}


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
