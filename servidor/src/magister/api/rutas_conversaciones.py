"""Temas, conversaciones y mensajes. Los mensajes pasan por el grafo (`flujo`)."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.sse import EventSourceResponse, ServerSentEvent
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from magister.api.esquemas import (
    ConversacionEntrada,
    ConversacionSalida,
    DecisionEntrada,
    MensajeEntrada,
    MensajeSalida,
    TemaEntrada,
    TemaSalida,
)
from magister.api.flujo import flujo_tutor
from magister.config import ajustes
from magister.datos import conversaciones as dc
from magister.datos.sesion import sesion_por_peticion
from magister.flujo import ejecutar

rutas = APIRouter(prefix="/api")


def hoy() -> date:
    return date.today()


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
    c = await dc.crear_conversacion(s, cuerpo.titulo.strip(), cuerpo.tema_id, cuerpo.tipo)
    return ConversacionSalida.model_validate(c)


@rutas.delete("/conversaciones/{cid}", status_code=204)
async def borrar_conversacion(cid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> None:
    if not await dc.borrar_conversacion(s, cid):
        raise HTTPException(404, "conversación no encontrada")


@rutas.get("/conversaciones/{cid}/mensajes")
async def listar_mensajes(cid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> list[MensajeSalida]:
    if await dc.obtener_conversacion(s, cid) is None:
        raise HTTPException(404, "conversación no encontrada")
    mensajes = await dc.listar_mensajes(s, cid)
    citas = await dc.citas_de_mensajes(s, [m.id for m in mensajes if m.rol == "tutor"])
    votos = await dc.votos_de_trazas(s, [m.traza_id for m in mensajes if m.traza_id])
    salida = []
    for m in mensajes:
        x = MensajeSalida.model_validate(m)
        x.citas = citas.get(m.id, [])
        x.voto = votos.get(m.traza_id) if m.traza_id else None
        salida.append(x)
    return salida


@rutas.get("/conversaciones/{cid}/propuesta")
async def propuesta_pendiente(cid: int) -> dict | None:
    """El plan propuesto que espera tu decisión, o null. Sirve para recuperarlo al recargar."""
    return await ejecutar.propuesta_pendiente(cid)


@dataclass
class Preparado:
    tipo: str
    turnos: list[dict]
    cuenta: bool


def guardador(cid: int, cuenta: bool):
    async def guardar(texto: str, estado: str, ms_primer: int | None, ms_total: int, extra: dict) -> int:
        from magister.cerebro.modelo import traza_actual

        mid = await dc.guardar_respuesta(cid, texto, estado, ajustes.modelo, ajustes.motor, ms_primer, ms_total, cuenta,
                                         traza_actual.get())
        if extra.get("citas"):
            await dc.guardar_citas(mid, extra["citas"], extra.get("busqueda_id"))
        return mid

    return guardar


async def preparar_mensaje(
    cid: int, cuerpo: MensajeEntrada, s: AsyncSession = Depends(sesion_por_peticion)
) -> Preparado:
    """Corre antes de abrir el flujo: así el 404 es un 404 y no un evento.

    Guarda la pregunta y confirma antes de llamar al modelo; devuelve el historial
    completo y cierra la transacción para no tenerla abierta durante el flujo.
    """
    c = await dc.obtener_conversacion(s, cid)
    if c is None:
        raise HTTPException(404, "conversación no encontrada")
    tipo = c.tipo
    await dc.guardar_pregunta(s, cid, cuerpo.contenido, cuerpo.cuenta)
    turnos = [{"rol": m.rol, "contenido": m.contenido} for m in await dc.historial_completo(s, cid)]
    return Preparado(tipo, turnos, cuerpo.cuenta)


@rutas.post("/conversaciones/{cid}/mensajes", response_class=EventSourceResponse)
async def enviar_mensaje(
    cid: int, cuerpo: MensajeEntrada, p: Preparado = Depends(preparar_mensaje)
) -> AsyncIterator[ServerSentEvent]:
    fase_inicial = "diagnostico" if p.tipo == "plan" else "estudio"
    eventos = ejecutar.mensaje(cid, cuerpo.contenido, p.turnos, hoy(), fase_inicial, voz=cuerpo.voz,
                                extra={"llamada": cuerpo.llamada, "modo": cuerpo.modo, "plan_id_leccion": cuerpo.plan_id,
                                       "leccion_clave": cuerpo.leccion_clave, "contexto": cuerpo.contexto})
    async for evento in flujo_tutor(eventos, guardador(cid, p.cuenta), {"conversacion_id": cid}):
        yield evento


async def preparar_decision(cid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    if await dc.obtener_conversacion(s, cid) is None:
        raise HTTPException(404, "conversación no encontrada")
    if not await ejecutar.pendiente_de_decision(cid):
        raise HTTPException(409, "no hay ningún plan pendiente de decisión")
    return [{"rol": m.rol, "contenido": m.contenido} for m in await dc.historial_completo(s, cid)]


@rutas.post("/conversaciones/{cid}/plan/decision", response_class=EventSourceResponse)
async def decidir_plan(
    cid: int, cuerpo: DecisionEntrada, turnos: list[dict] = Depends(preparar_decision)
) -> AsyncIterator[ServerSentEvent]:
    eventos = ejecutar.decision(cid, cuerpo.model_dump(), hoy(), turnos)
    async for evento in flujo_tutor(eventos, guardador(cid, True), {"conversacion_id": cid}):
        yield evento
