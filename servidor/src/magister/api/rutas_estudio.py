"""Rutas de las técnicas de estudio: calentamiento, «dímelo más fácil», examen oral y repaso del tema."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from magister.material import estudio

rutas = APIRouter(prefix="/api")


def _400(e: ValueError) -> HTTPException:
    return HTTPException(400, str(e))


@rutas.get("/estudio/{mid}/priming")
async def priming(mid: int) -> dict:
    try:
        return await estudio.priming(mid)
    except ValueError as e:
        raise _400(e) from e


@rutas.get("/estudio/{mid}/facil/{clave}")
async def facil(mid: int, clave: str) -> dict:
    try:
        return await estudio.facil(mid, clave)
    except ValueError as e:
        raise _400(e) from e


@rutas.get("/estudio/{mid}/oral")
async def oral(mid: int, rehacer: bool = False) -> dict:
    try:
        return await estudio.banco_oral(mid, rehacer)
    except ValueError as e:
        raise _400(e) from e


class Volcado(BaseModel):
    plan_id: int
    leccion_clave: str = Field(max_length=20)
    texto: str = Field(min_length=10, max_length=20000)
    # Solo estos apartados (repaso a mitad de sesión); vacío: el tema entero.
    alcance: list[str] | None = None


@rutas.post("/estudio/volcado")
async def volcado(cuerpo: Volcado) -> dict:
    try:
        return await estudio.corregir_volcado(cuerpo.plan_id, cuerpo.leccion_clave, cuerpo.texto, cuerpo.alcance)
    except ValueError as e:
        raise _400(e) from e


@rutas.get("/estudio/repasos-de-tema")
async def repasos_de_tema() -> list[dict]:
    return await estudio.repasos_de_tema()


class Estilo(BaseModel):
    estilo: Literal["oral", "desarrollo", "test", "cortas", "sin_examen"]


@rutas.get("/planes/{plan_id}/estilo-examen")
async def ver_estilo(plan_id: int) -> dict:
    return {"estilo": await estudio.estilo_examen(plan_id)}


@rutas.put("/planes/{plan_id}/estilo-examen")
async def poner_estilo(plan_id: int, cuerpo: Estilo) -> dict:
    return {"estilo": await estudio.poner_estilo_examen(plan_id, cuerpo.estilo)}



class Parrafo(BaseModel):
    clave: str = Field(max_length=10)
    parrafo: str = Field(min_length=3, max_length=4000)
    accion: Literal["facil", "ejemplo", "porque", "clave", "pregunta"]
    pregunta: str | None = Field(None, max_length=500)


@rutas.post("/estudio/{mid}/parrafo")
async def parrafo(mid: int, cuerpo: Parrafo) -> dict:
    """La mascota ayuda con el párrafo que estás leyendo (respuesta corta)."""
    try:
        return {"texto": await estudio.ayuda_parrafo(mid, cuerpo.clave, cuerpo.parrafo, cuerpo.accion, cuerpo.pregunta)}
    except ValueError as e:
        raise _400(e) from e


class Nodo(BaseModel):
    id: str = Field(max_length=40)
    texto: str = Field(max_length=60)
    x: float
    y: float


class Flecha(BaseModel):
    de: str = Field(max_length=40)
    a: str = Field(max_length=40)


class Mapa(BaseModel):
    nodos: list[Nodo] = Field(default_factory=list, max_length=80)
    flechas: list[Flecha] = Field(default_factory=list, max_length=160)


@rutas.get("/estudio/{mid}/mapa")
async def ver_mapa(mid: int) -> dict:
    return await estudio.ver_mapa(mid)


@rutas.put("/estudio/{mid}/mapa")
async def guardar_mapa(mid: int, cuerpo: Mapa) -> dict:
    return await estudio.guardar_mapa(mid, cuerpo.model_dump())
