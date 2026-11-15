"""Temas, conversaciones y mensajes (v0.1)."""

from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.sse import EventSourceResponse, ServerSentEvent
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from magister.api.esquemas import (
    ConversacionEntrada,
    ConversacionSalida,
    MensajeEntrada,
    MensajeSalida,
    TemaEntrada,
    TemaSalida,
)
from magister.api.flujo import flujo_tutor
from magister.cerebro.modelo import Turno, generar
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.datos import conversaciones as dc
from magister.datos.sesion import sesion_por_peticion

rutas = APIRouter(prefix="/api")


@rutas.post("/temas", status_code=201)
async def crear_tema(cuerpo: TemaEntrada, s: AsyncSession = Depends(sesion_por_peticion)) -> TemaSalida:
    try:
        tema = await dc.crear_tema(s, cuerpo.nombre.strip())
    except IntegrityError:
        await s.rollback()
        raise HTTPException(409, "ya existe un tema con ese nombre") from None
    return TemaSalida.model_validate(tema)


@rutas.get("/temas")
async def listar_temas(s: AsyncSession = Depends(sesion_por_peticion)) -> list[TemaSalida]:
    return [TemaSalida.model_validate(t) for t in await dc.listar_temas(s)]


@rutas.get("/conversaciones")
async def listar_conversaciones(s: AsyncSession = Depends(sesion_por_peticion)) -> list[ConversacionSalida]:
    return [ConversacionSalida.model_validate(c) for c in await dc.listar_conversaciones(s)]


@rutas.post("/conversaciones", status_code=201)
async def crear_conversacion(
    cuerpo: ConversacionEntrada, s: AsyncSession = Depends(sesion_por_peticion)
) -> ConversacionSalida:
    if cuerpo.tema_id is not None and await dc.obtener_tema(s, cuerpo.tema_id) is None:
        raise HTTPException(404, "tema no encontrado")
    c = await dc.crear_conversacion(s, cuerpo.titulo.strip(), cuerpo.tema_id)
    return ConversacionSalida.model_validate(c)


@rutas.delete("/conversaciones/{cid}", status_code=204)
async def borrar_conversacion(cid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> None:
    if not await dc.borrar_conversacion(s, cid):
        raise HTTPException(404, "conversación no encontrada")


@rutas.get("/conversaciones/{cid}/mensajes")
async def listar_mensajes(cid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> list[MensajeSalida]:
    if await dc.obtener_conversacion(s, cid) is None:
        raise HTTPException(404, "conversación no encontrada")
    return [MensajeSalida.model_validate(m) for m in await dc.listar_mensajes(s, cid)]


async def preparar_mensaje(
    cid: int, cuerpo: MensajeEntrada, s: AsyncSession = Depends(sesion_por_peticion)
) -> list[Turno]:
    """Corre antes de abrir el flujo: así el 404 es un 404 y no un evento.

    Guarda la pregunta y confirma antes de llamar al modelo; devuelve el historial
    completo y cierra la transacción para no tenerla abierta durante el flujo.
    """
    if await dc.obtener_conversacion(s, cid) is None:
        raise HTTPException(404, "conversación no encontrada")
    await dc.guardar_pregunta(s, cid, cuerpo.contenido, cuerpo.cuenta)
    return [Turno(m.rol, m.contenido) for m in await dc.historial_completo(s, cid)]  # type: ignore[arg-type]


@rutas.post("/conversaciones/{cid}/mensajes", response_class=EventSourceResponse)
async def enviar_mensaje(
    cid: int, cuerpo: MensajeEntrada, historial: list[Turno] = Depends(preparar_mensaje)
) -> AsyncIterator[ServerSentEvent]:
    async def guardar(texto: str, estado: str, ms_primer: int | None, ms_total: int) -> int:
        return await dc.guardar_respuesta(
            cid, texto, estado, ajustes.modelo, ajustes.motor, ms_primer, ms_total, cuerpo.cuenta
        )

    async for evento in flujo_tutor(
        generar(cargar("libre").texto, historial), guardar, {"conversacion_id": cid}
    ):
        yield evento
