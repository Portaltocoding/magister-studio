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


# Lo que la pantalla enseña tal cual (los fallos del alta y de la prueba) sale en el idioma elegido. El español es el
# mensaje original de cerebro/cuenta.py; aquí está su versión en inglés (y la pantalla reconoce «you signed in with»).
EN = {
    "Ya estoy preparando la conexión. Espera unos segundos.": "I'm already preparing the connection. Wait a few seconds.",
    "No he conseguido el enlace de Claude. Pulsa «Probar otra vez».": 'I couldn\'t get the Claude link. Press "Try again".',
    "En este equipo Magister ya usa la cuenta de Claude con la que iniciaste sesión.":
        "On this computer Magister already uses the Claude account you signed in with.",
    "La conexión ha caducado. Pulsa «Probar otra vez» para empezar de nuevo.": 'The connection has expired. Press "Try again" to start over.',
    "Ese código no ha valido. Pulsa «Probar otra vez» y copia el código entero.": 'That code didn\'t work. Press "Try again" and copy the whole code.',
    "El código no ha dado un token válido.": "The code didn't give a valid token.",
    "Claude no me deja entrar con esta cuenta. Vuelve a conectarla.": "Claude won't let me in with this account. Connect it again.",
    "El modelo no ha contestado. Prueba otra vez en un momento.": "The model didn't answer. Try again in a moment.",
}


async def en_su_idioma(mensaje: str) -> str:
    """El mensaje en el idioma de las preferencias (sin traducción conocida, tal cual)."""
    try:
        if (await preferencias_tutor()).get("idioma") == "en":
            return EN.get(mensaje, mensaje)
    except Exception:  # noqa: BLE001  # las preferencias no pueden romper un aviso
        pass
    return mensaje


async def _estado_guardado() -> str:
    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, CLAVE)
    return (fila.valor or {}).get("estado", "pendiente") if fila else "pendiente"


@rutas.get("")
async def ver() -> dict:
    """Qué pasos enseñar: el estado de la bienvenida, cómo te llama la mascota y si la cuenta de Claude funciona."""
    c = await cuenta.estado()
    return {"estado": await _estado_guardado(), "nombre": (await preferencias_tutor()).get("nombre", ""),
            "cuenta": {"conectada": c["conectada"], "caida": c["caida"], "puede_conectar": cuenta.puede_conectar()}}


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
        raise HTTPException(409, await en_su_idioma(str(e))) from None


class Codigo(BaseModel):
    codigo: str = Field(min_length=1, max_length=2000)


@rutas.post("/cuenta/codigo")
async def terminar_cuenta(cuerpo: Codigo) -> dict:
    """El código que enseña Claude: se acaba el alta y el token queda guardado (no se devuelve)."""
    try:
        await cuenta.terminar_alta(cuerpo.codigo)
    except cuenta.ErrorCuenta as e:
        raise HTTPException(400, await en_su_idioma(str(e))) from None
    return {"conectada": True}


@rutas.post("/probar")
async def probar() -> dict:
    """Una llamada mínima al modelo: confirma que la cuenta funciona."""
    try:
        async for _ in generar(SISTEMA_PRUEBA, [Turno("usuario", "Hola")], tarea="asesor"):
            pass
    except ErrorModelo as e:
        if cuenta.es_error_de_cuenta(str(e)) or cuenta.caida():
            return {"ok": False, "cuenta": False, "mensaje": await en_su_idioma("Claude no me deja entrar con esta cuenta. Vuelve a conectarla.")}
        return {"ok": False, "cuenta": True, "mensaje": await en_su_idioma("El modelo no ha contestado. Prueba otra vez en un momento.")}
    return {"ok": True, "cuenta": True, "mensaje": ""}
