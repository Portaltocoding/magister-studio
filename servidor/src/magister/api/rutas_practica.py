"""Práctica y progreso (Parte V)."""

import time
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from typing import Literal

import anyio
from fastapi import APIRouter, Depends, HTTPException
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from magister.aprender import andamiajes, practica, progreso
from magister.aprender.corrector import corregir
from magister.cerebro.modelo import ErrorModelo, Turno, generar
from magister.datos.aprender import Intento
from magister.datos.sesion import nueva_sesion, sesion_por_peticion
from magister.tono.lint import revisar, vetos

rutas = APIRouter(prefix="/api")


def ahora() -> datetime:
    return datetime.now(timezone.utc)


class IntentoEntrada(BaseModel):
    pregunta_id: str
    concepto_id: str
    respuesta: str = Field(min_length=1, max_length=8000)
    confianza: Literal[0.25, 0.5, 0.75, 0.95]
    clave: str = Field(min_length=8, max_length=80)
    tipo: Literal["espaciado", "reintento"] = "espaciado"
    latencia_ms: int | None = None


class NotaUsuario(BaseModel):
    nota_usuario: Literal["fallo", "parcial", "bien", "perfecta"]


@rutas.get("/practica/cola")
async def ver_cola() -> list[dict]:
    return await practica.cola(ahora())


@rutas.get("/practica/siguiente")
async def ver_siguiente(concepto_id: str | None = None) -> dict | None:
    return await practica.siguiente(ahora(), concepto_id)


def _limpiar(texto: str) -> str:
    """El guardián del tono: un veto (la raya larga) no llega al alumno."""
    if vetos(revisar(texto)):
        texto = texto.replace("—", ", ").replace("–", ", ")
    return texto


async def _existente(clave: str) -> Intento | None:
    async with nueva_sesion() as s:
        return await s.scalar(select(Intento).where(Intento.clave_idempotencia == clave))


@rutas.post("/practica/intentos", response_class=EventSourceResponse)
async def intentar(cuerpo: IntentoEntrada) -> AsyncIterator[ServerSentEvent]:
    previo = await _existente(cuerpo.clave)
    if previo is not None:
        c = previo.correccion or {}
        yield ServerSentEvent(data={"nota": previo.nota_corrector, "ideas_ausentes": c.get("ideas_ausentes", []),
                                    "errores": c.get("errores", [])}, event="nota")
        yield ServerSentEvent(data={"t": previo.explicacion or ""}, event="delta")
        yield ServerSentEvent(data={"intento_id": str(previo.id), "proxima_fecha": None}, event="fin")
        return
    t0 = time.perf_counter()
    momento = ahora()
    servida = await practica.ultima_servida(cuerpo.pregunta_id)
    enunciado, referencia, fragmentos = await practica.contexto_pregunta(cuerpo.pregunta_id)
    try:
        c, version_corrector = await corregir(enunciado, referencia, fragmentos, cuerpo.respuesta)
    except Exception as e:  # noqa: BLE001
        yield ServerSentEvent(data={"detalle": f"no se pudo corregir: {e}"}, event="error")
        return
    yield ServerSentEvent(data={"nota": c.nota, "ideas_ausentes": c.ideas_ausentes,
                                "errores": [e.model_dump() for e in c.errores]}, event="nota")
    molde = andamiajes.molde(c.tipo_error).format(
        pregunta=enunciado, respuesta=cuerpo.respuesta, ideas_ausentes="; ".join(c.ideas_ausentes) or "nada",
        errores="; ".join(f"{e.afirmacion} ({e.por_que})" for e in c.errores) or "ninguno",
        extension=andamiajes.extension(cuerpo.confianza, c.nota))
    partes: list[str] = []
    try:
        if c.nota != "perfecta":
            async for trozo in generar(molde + f"\n\nRespuesta de referencia: {referencia}", [Turno("usuario", "Explícaselo.")]):
                trozo = _limpiar(trozo)
                partes.append(trozo)
                yield ServerSentEvent(data={"t": trozo}, event="delta")
        else:
            partes.append("Perfecta: lo tienes.")
            yield ServerSentEvent(data={"t": partes[0]}, event="delta")
    except ErrorModelo:
        pass
    finally:
        with anyio.CancelScope(shield=True):
            estado, prog = await practica.estado_y_programador(servida.plan_id if servida else 0, cuerpo.concepto_id, momento)
            proxima = None
            if cuerpo.tipo == "espaciado":
                _, proxima = prog.siguiente(estado, c.nota, momento)
            plan_id = servida.plan_id if servida else await progreso.plan_de_pregunta(cuerpo.pregunta_id)
            async with nueva_sesion() as s, s.begin():
                i = Intento(plan_id=plan_id, concepto_id=cuerpo.concepto_id, pregunta_id=cuerpo.pregunta_id, momento=momento,
                            tipo=cuerpo.tipo, respuesta=cuerpo.respuesta, explicacion="".join(partes), confianza=cuerpo.confianza,
                            latencia_ms=cuerpo.latencia_ms or int((time.perf_counter() - t0) * 1000),
                            nota_corrector=c.nota, correccion=c.model_dump(),
                            p_predicha=servida.p_predicha if servida and cuerpo.tipo == "espaciado" else None,
                            version_programador=prog.version, version_corrector=version_corrector,
                            clave_idempotencia=cuerpo.clave)
                s.add(i)
                await s.flush()
                intento_id = str(i.id)
    yield ServerSentEvent(data={"intento_id": intento_id, "proxima_fecha": proxima.isoformat() if proxima else None}, event="fin")


@rutas.patch("/practica/intentos/{intento_id}")
async def corregir_nota(intento_id: str, cuerpo: NotaUsuario, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    r = await s.execute(update(Intento).where(Intento.id == intento_id).values(nota_usuario=cuerpo.nota_usuario))
    await s.commit()
    if not r.rowcount:
        raise HTTPException(404, "intento no encontrado")
    return {"id": intento_id, "nota_usuario": cuerpo.nota_usuario}


@rutas.get("/progreso/conceptos")
async def conceptos() -> list[dict]:
    return await progreso.conceptos(ahora())


@rutas.get("/progreso/carga")
async def carga(dias: int = 14) -> list[dict]:
    from magister.aprender.reajuste import prever_carga

    return [x.__dict__ | {"fecha": x.fecha.isoformat()} for x in await prever_carga(ahora(), dias)]


@rutas.get("/progreso/calibracion")
async def calibracion(fuente: Literal["usuario", "modelo"] = "usuario") -> list[dict]:
    return await progreso.calibracion(fuente, ahora() - timedelta(weeks=8))


@rutas.get("/progreso/resumen")
async def resumen() -> dict:
    return await progreso.resumen(ahora())
