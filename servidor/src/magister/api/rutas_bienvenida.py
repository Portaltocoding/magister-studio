"""La bienvenida de la primera vez: si ya se hizo, conectar la cuenta de Claude desde la página y la prueba rápida.

El estado vive en la tabla `instalacion` (clave «bienvenida»), sin migración. El token de Claude no sale por ninguna
ruta: el servidor lo guarda en un fichero (cerebro/cuenta.py) y aquí solo se dice si hay cuenta o no.
"""

import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.dialects.postgresql import insert

from magister.cerebro import cuenta
from magister.cerebro.modelo import ErrorModelo, Turno, generar
from magister.datos.produccion import Ajuste
from magister.datos.sesion import nueva_sesion
from magister.flujo.comun import preferencias_tutor

rutas = APIRouter(prefix="/api/bienvenida", tags=["bienvenida"])

CLAVE = "bienvenida"
# La prueba más barata: la tarea del asesor va con Haiku (config/modelos.yaml) y la respuesta es una palabra.
SISTEMA_PRUEBA = "Responde únicamente con la palabra: listo"


async def _estado_guardado() -> str:
    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, CLAVE)
    return (fila.valor or {}).get("estado", "pendiente") if fila else "pendiente"


@rutas.get("")
async def ver() -> dict:
    """Qué pasos enseñar: el estado de la bienvenida, cómo te llama la mascota y si la cuenta de Claude funciona."""
    c = await cuenta.estado()
    return {"estado": await _estado_guardado(), "nombre": (await preferencias_tutor()).get("nombre", ""),
            "cuenta": {"conectada": c["conectada"], "caida": c["caida"]}}


class Estado(BaseModel):
    estado: Literal["pendiente", "hecha", "omitida"]


@rutas.put("/estado")
async def guardar_estado(cuerpo: Estado) -> dict:
    """«hecha» o «omitida» la cierran para siempre; «pendiente» la reabre (Ajustes)."""
    valor = {"estado": cuerpo.estado, "actualizada": int(time.time())}
    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(Ajuste).values(clave=CLAVE, valor=valor)
                        .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": valor}))
    return {"estado": cuerpo.estado}


@rutas.post("/cuenta/iniciar")
async def iniciar_cuenta() -> dict:
    """Arranca el inicio de sesión de Claude y devuelve el enlace que la página abre en otra pestaña."""
    try:
        return {"enlace": await cuenta.iniciar_alta()}
    except cuenta.ErrorCuenta as e:
        raise HTTPException(409, str(e)) from None


class Codigo(BaseModel):
    codigo: str = Field(min_length=1, max_length=2000)


@rutas.post("/cuenta/codigo")
async def terminar_cuenta(cuerpo: Codigo) -> dict:
    """El código que enseña Claude: se acaba el alta y el token queda guardado (no se devuelve)."""
    try:
        await cuenta.terminar_alta(cuerpo.codigo)
    except cuenta.ErrorCuenta as e:
        raise HTTPException(400, str(e)) from None
    return {"conectada": True}


@rutas.post("/probar")
async def probar() -> dict:
    """Una llamada mínima al modelo: confirma que la cuenta funciona."""
    try:
        async for _ in generar(SISTEMA_PRUEBA, [Turno("usuario", "Hola")], tarea="asesor"):
            pass
    except ErrorModelo as e:
        if cuenta.es_error_de_cuenta(str(e)) or cuenta.caida():
            return {"ok": False, "cuenta": False, "mensaje": "Claude no me deja entrar con esta cuenta. Vuelve a conectarla."}
        return {"ok": False, "cuenta": True, "mensaje": "El modelo no ha contestado. Prueba otra vez en un momento."}
    return {"ok": True, "cuenta": True, "mensaje": ""}
