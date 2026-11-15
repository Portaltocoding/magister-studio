import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel

from magister.api.seguridad import Proteccion
from magister.config import ajustes

VERSION_CONTRATO = "0.1"

registro = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def ciclo_de_vida(_: FastAPI):
    if not ajustes.token:
        registro.warning("MAGISTER_TOKEN está vacío: la API no exige token. Ponlo en servidor/.env.")
    yield


app = FastAPI(title="Magister", version=VERSION_CONTRATO, lifespan=ciclo_de_vida)

# El orden importa: el último que se añade es el más externo. Proteccion va por dentro
# del sobre para que los 401 y 413 también lleven X-Magister-Version y X-Request-Id.
app.add_middleware(Proteccion)


@app.middleware("http")
async def poner_sobre(request: Request, call_next):
    id_peticion = request.headers.get("X-Request-Id") or uuid.uuid4().hex
    respuesta = await call_next(request)
    respuesta.headers["X-Magister-Version"] = VERSION_CONTRATO
    respuesta.headers["X-Request-Id"] = id_peticion
    return respuesta


class Salud(BaseModel):
    ok: bool
    motor: str
    modelo: str


@app.get("/api/salud")
async def salud() -> Salud:
    return Salud(ok=True, motor=ajustes.motor, modelo=ajustes.modelo)


@app.get("/api/pulso", response_class=EventSourceResponse)
async def pulso(n: int = 5, juntos: int = 0) -> AsyncIterator[ServerSentEvent]:
    for i in range(n):
        if not juntos and i > 0:
            await asyncio.sleep(0.5)
        yield ServerSentEvent(data={"i": i}, event="pulso")
