"""Temas, conversaciones y mensajes. Los mensajes pasan por el grafo (`flujo`)."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
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
    MateriaEntrada,
    MensajeEntrada,
    MensajeSalida,
    TemaEntrada,
    TemaSalida,
)
from magister.api.flujo import flujo_tutor
from magister.api.rutas_asesor import tras_respuesta
from magister.config import ajustes
from magister.datos import conversaciones as dc
from magister.datos.sesion import nueva_sesion, sesion_por_peticion
from magister.flujo import ejecutar
from magister.flujo.intencion import pide_guardar

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


@rutas.get("/materias")
async def listar_materias() -> list[dict]:
    """Los perfiles de explicación que se pueden asignar a un tema."""
    from magister.cerebro import materias

    return [{"id": k, "descripcion": v, "version": materias.version(k)} for k, v in materias.DESCRIPCIONES.items()]


@rutas.put("/temas/{tema_id}/materia")
async def cambiar_materia(tema_id: int, cuerpo: MateriaEntrada, s: AsyncSession = Depends(sesion_por_peticion)) -> TemaSalida:
    """Cambia a mano el perfil de explicación del tema; null lo deja sin elegir y se vuelve a elegir al usarlo."""
    from magister.cerebro import materias

    if cuerpo.materia is not None and cuerpo.materia not in materias.PERFILES:
        raise HTTPException(422, f"perfil desconocido; los hay: {', '.join(materias.PERFILES)}")
    tema = await dc.obtener_tema(s, tema_id)
    if tema is None:
        raise HTTPException(404, "tema no encontrado")
    tema.materia = cuerpo.materia
    await s.commit()
    await s.refresh(tema)
    return TemaSalida.model_validate(tema)


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
    await ejecutar.borrar_hilo(cid)


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
    nota: dict | None = None  # la nota que acaba de guardar «guárdalo»
    pregunta_id: int | None = None


# Un turno cada vez por conversación: si llega otro (en la llamada, el dictado reenvía tu pregunta ampliada mientras la
# anterior se está cortando), espera a que el anterior acabe o se corte, para que cada respuesta vea la anterior.
_candados: dict[int, asyncio.Lock] = {}
ESPERA_TURNO_S = 20


@asynccontextmanager
async def turno_en_curso(cid: int):
    candado = _candados.setdefault(cid, asyncio.Lock())
    try:
        await asyncio.wait_for(candado.acquire(), timeout=ESPERA_TURNO_S)
        tengo = True
    except TimeoutError:
        tengo = False  # el anterior se ha colgado: mejor contestar que dejar esperando
    try:
        yield
    finally:
        if tengo:
            candado.release()


async def historial_del_turno(cid: int, pregunta_id: int, llamada: bool) -> list[dict]:
    """El historial al empezar el turno (ya con la respuesta del anterior), con esta pregunta al final.

    En la llamada, si la pregunta anterior se quedó sin respuesta y esta la amplía («¿qué es X?» y luego «¿qué es X
    exactamente?»), la anterior sobra: se borra para que el modelo no vea dos preguntas seguidas."""
    async with nueva_sesion() as s:
        filas = await dc.historial_completo(s, cid)
        pregunta = next((m for m in filas if m.id == pregunta_id), None)
        otras = [m for m in filas if m.id != pregunta_id]
        if llamada and pregunta and otras and otras[-1].rol == "usuario" and otras[-1].id < pregunta_id:
            previa = otras[-1]
            if pregunta.contenido.strip().lower().startswith(previa.contenido.strip().lower()):
                await dc.borrar_mensaje(s, previa.id)
                otras = otras[:-1]
    return [{"rol": m.rol, "contenido": m.contenido} for m in [*otras, *([pregunta] if pregunta else [])]]


async def guardar_respuesta_anterior(s: AsyncSession, cid: int) -> dict | None:
    """«Guárdalo»: la última respuesta completa del tutor va a Mis notas (una sola vez)."""
    from sqlalchemy import select

    from magister.datos.modelos import Conversacion, Mensaje
    from magister.datos.notas import Nota

    m = await s.scalar(select(Mensaje).where(Mensaje.conversacion_id == cid, Mensaje.rol == "tutor",
                                             Mensaje.estado == "completo").order_by(Mensaje.id.desc()).limit(1))
    if m is None or not m.contenido.strip():
        return None
    n = await s.scalar(select(Nota).where(Nota.mensaje_id == m.id, Nota.completa.is_(True)))
    if n is None:
        c = await s.get(Conversacion, cid)
        n = Nota(texto=m.contenido.strip(), mensaje_id=m.id, conversacion_id=cid, origen=c.titulo if c else None, completa=True)
        s.add(n)
        await s.commit()
        await s.refresh(n)
    return {"id": n.id, "mensaje_id": m.id}


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
    nota = None
    if tipo != "plan" and not cuerpo.voz and pide_guardar(cuerpo.contenido):
        nota = await guardar_respuesta_anterior(s, cid)
    pregunta = await dc.guardar_pregunta(s, cid, cuerpo.contenido, cuerpo.cuenta)
    turnos = [{"rol": m.rol, "contenido": m.contenido} for m in await dc.historial_completo(s, cid)]
    return Preparado(tipo, turnos, cuerpo.cuenta, nota, pregunta.id)


@rutas.post("/conversaciones/{cid}/mensajes", response_class=EventSourceResponse)
async def enviar_mensaje(
    cid: int, cuerpo: MensajeEntrada, p: Preparado = Depends(preparar_mensaje)
) -> AsyncIterator[ServerSentEvent]:
    fase_inicial = "diagnostico" if p.tipo == "plan" else "estudio"
    async with turno_en_curso(cid):
        turnos = await historial_del_turno(cid, p.pregunta_id, cuerpo.llamada) if p.pregunta_id else p.turnos
        eventos = ejecutar.mensaje(cid, cuerpo.contenido, turnos, hoy(), fase_inicial, voz=cuerpo.voz,
                                    extra={"llamada": cuerpo.llamada, "modo": cuerpo.modo, "plan_id_leccion": cuerpo.plan_id,
                                           "leccion_clave": cuerpo.leccion_clave, "contexto": cuerpo.contexto,
                                           "corregir": cuerpo.corregir and cuerpo.llamada,
                                           "asesor": cuerpo.asesor,
                                           "nota_guardada": p.nota is not None})
        if p.nota is not None:
            eventos = _con_nota(p.nota, eventos)
        texto, mensaje_id = [], None
        async for evento in flujo_tutor(eventos, guardador(cid, p.cuenta), {"conversacion_id": cid}):
            if evento.event == "delta":
                texto.append(evento.data["t"])
            elif evento.event == "fin":
                mensaje_id = evento.data.get("mensaje_id")
            yield evento
    # El asesor que hace cosas: si ofreció un cambio (bloque ```cambio), lo prepara para que lo apliques tú. Fuera del
    # turno: la respuesta ya está guardada y la siguiente pregunta no tiene que esperar a esto.
    if cuerpo.asesor and mensaje_id is not None:
        async for evento in tras_respuesta(cid, cuerpo.proyecto_id, "".join(texto), mensaje_id, turnos, hoy()):
            yield evento


async def _con_nota(nota: dict, eventos: AsyncIterator[dict]) -> AsyncIterator[dict]:
    """Primero el aviso de la nota guardada (la pantalla lo enseña al momento), luego el flujo de siempre."""
    yield {"tipo": "nota", **nota}
    async for ev in eventos:
        yield ev


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
