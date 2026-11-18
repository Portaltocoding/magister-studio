"""La voz local del tutor (Piper) y el registro de las llamadas."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from magister.voz import piper, registro

rutas = APIRouter(prefix="/api")


@rutas.get("/voz/voces")
async def voces() -> list[dict]:
    """Las voces instaladas (vacío si Piper no está: la pantalla usa entonces la voz del navegador)."""
    return [{"id": v.id, "nombre": v.nombre} for v in piper.disponibles()]


class Frase(BaseModel):
    texto: str = Field(min_length=1, max_length=piper.MAX_TEXTO)
    voz: str = Field(max_length=40)


@rutas.post("/voz")
async def decir(cuerpo: Frase) -> Response:
    try:
        wav = await piper.sintetizar(cuerpo.texto, cuerpo.voz)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except piper.VozNoDisponible as e:
        raise HTTPException(503, str(e)) from e
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


class Evento(BaseModel):
    t: int  # milisegundos desde que empezó la llamada
    e: str = Field(max_length=40)
    d: dict[str, Any] | None = None


class Registro(BaseModel):
    conversacion_id: int | None = None
    tipo: str = Field(max_length=20)
    leccion: str | None = Field(None, max_length=20)
    segundos: int = 0
    voz: str | None = Field(None, max_length=80)
    resumen: dict[str, Any] | None = None
    eventos: list[Evento] = Field(default_factory=list, max_length=5000)


@rutas.post("/llamadas/registro", status_code=201)
async def guardar_registro(cuerpo: Registro) -> dict:
    destino = await registro.guardar(cuerpo.model_dump(), datetime.now())
    return {"fichero": destino.name}


@rutas.get("/llamadas/registros")
async def registros() -> list[dict]:
    return await registro.ultimos()
