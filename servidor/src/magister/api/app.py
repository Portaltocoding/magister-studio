import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from magister.api.rutas_conversaciones import rutas as rutas_conversaciones
from magister.api.rutas_plan import rutas as rutas_plan
from magister.api.seguridad import Proteccion
from magister.config import ajustes
from magister.datos import conversaciones as dc
from magister.datos import sesion
from magister.datos.sesion import sesion_por_peticion
from magister.flujo.grafo import iniciar as iniciar_grafo

VERSION_CONTRATO = "0.2"

registro = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def ciclo_de_vida(_: FastAPI):
    if not ajustes.token:
        registro.warning("MAGISTER_TOKEN está vacío: la API no exige token. Ponlo en servidor/.env.")
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    # El checkpointer se abre una vez: las pausas del grafo sobreviven a un reinicio (ADR-0004).
    async with AsyncSqliteSaver.from_conn_string(ajustes.checkpoints) as saver:
        iniciar_grafo(saver)
        yield
    iniciar_grafo(None)
    await sesion.cerrar()


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
async def salud(s: AsyncSession = Depends(sesion_por_peticion)) -> Salud:
    await dc.comprobar(s)
    return Salud(ok=True, motor=ajustes.motor, modelo=ajustes.modelo)


@app.get("/api/pulso", response_class=EventSourceResponse)
async def pulso(n: int = 5, juntos: int = 0) -> AsyncIterator[ServerSentEvent]:
    for i in range(n):
        if not juntos and i > 0:
            await asyncio.sleep(0.5)
        yield ServerSentEvent(data={"i": i}, event="pulso")


app.include_router(rutas_conversaciones)
app.include_router(rutas_plan)
