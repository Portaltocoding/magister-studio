import asyncio
import logging
import uuid
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from magister.api.rutas_agenda import rutas as rutas_agenda
from magister.api.rutas_examen import rutas as rutas_examen
from magister.api.rutas_borrar import rutas as rutas_borrar
from magister.api.rutas_conversaciones import rutas as rutas_conversaciones
from magister.api.rutas_fuentes import rutas as rutas_fuentes
from magister.api.rutas_material import rutas as rutas_material
from magister.api.rutas_practica import rutas as rutas_practica
from magister.api.rutas_tutor import rutas as rutas_tutor
from magister.api.rutas_produccion import rutas as rutas_produccion
from magister.api.rutas_research import rutas as rutas_research
from magister.api.rutas_plan import rutas as rutas_plan
from magister.api.seguridad import Proteccion
from magister.config import ajustes
from magister.datos import conversaciones as dc
from magister.datos import sesion
from magister.datos.sesion import sesion_por_peticion
from magister.flujo.grafo import iniciar as iniciar_grafo

VERSION_CONTRATO = "1.0"

registro = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def ciclo_de_vida(_: FastAPI):
    if not ajustes.token:
        registro.warning("MAGISTER_TOKEN está vacío: la API no exige token. Ponlo en servidor/.env.")
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    # El checkpointer se abre una vez: las pausas del grafo sobreviven a un reinicio (ADR-0004).
    from magister.flujo.fuentes import recalcular_apoyo_por_versiones
    from magister.fuentes.buscar import BuscadorHibrido
    from magister.fuentes.ingesta import bucle_de_fondo
    from magister.research.tareas import cortar_en_curso

    # api construye el buscador y lo inyecta: flujo no importa magister.fuentes.
    buscador = BuscadorHibrido()
    await cortar_en_curso()

    async def al_quedar_listas(ids: list[int]) -> None:
        await recalcular_apoyo_por_versiones(buscador, ids)

    from magister.cerebro.enrutador import comprobar_al_arrancar
    from magister.observar import alertas, registro as observar
    from magister.api.instalacion import preparar_instalacion

    comprobar_al_arrancar()
    observar.instalar()
    await preparar_instalacion()
    from magister.aprender import personal

    await personal.cargar()
    from magister.aprender import red as red_olvido

    await red_olvido.cargar()
    vigia = asyncio.create_task(alertas.bucle())
    if ajustes.embeddings == "local":
        from magister.fuentes.embeber import embeber

        # Cargar e5 lleva unos 20 s: se hace ya, en un hilo, y no en la primera pregunta.
        asyncio.create_task(asyncio.to_thread(embeber, ["calentar"], "consulta"))
    fondo = asyncio.create_task(bucle_de_fondo(al_quedar_listas)) if ajustes.procesar_fondo else None
    from magister.trabajos.trabajador import bucle as bucle_trabajos

    # El trabajador de la cola corre dentro de la API salvo que se lance aparte (magister-trabajador).
    trabajador = asyncio.create_task(bucle_trabajos()) if ajustes.trabajos_en_api else None
    from magister.trabajos.automatizar import bucle as bucle_automatizaciones

    # Las automatizaciones que enciendes (preparar la próxima lección, vídeos...) se revisan cada pocos minutos.
    automatizaciones = asyncio.create_task(bucle_automatizaciones()) if ajustes.trabajos_en_api else None
    async with AsyncSqliteSaver.from_conn_string(ajustes.checkpoints) as saver:
        iniciar_grafo(saver, buscador)
        yield
    for tarea in (fondo, trabajador, vigia):
        if tarea is not None:
            tarea.cancel()
    iniciar_grafo(None)
    await sesion.cerrar()


app = FastAPI(title="Magister", version=VERSION_CONTRATO, lifespan=ciclo_de_vida)

# El orden importa: el último que se añade es el más externo. Proteccion va por dentro
# del sobre para que los 401 y 413 también lleven X-Magister-Version y X-Request-Id.
app.add_middleware(Proteccion)


DIAPOSITIVAS_HTML = re.compile(r"/api/materiales/\d+/fichero/html")


@app.middleware("http")
async def poner_sobre(request: Request, call_next):
    id_peticion = request.headers.get("X-Request-Id") or uuid.uuid4().hex
    from magister.cerebro.modelo import traza_actual

    traza_actual.set(id_peticion)
    respuesta = await call_next(request)
    if DIAPOSITIVAS_HTML.fullmatch(request.url.path):
        # Las diapositivas de Marp se ven dentro de la app (iframe) y pasan con su script en línea.
        respuesta.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; "
            "script-src 'self' 'unsafe-inline'; frame-ancestors 'self'")
    else:
        # font-src data:: las fuentes de KaTeX van incrustadas en su CSS.
        respuesta.headers["Content-Security-Policy"] = ("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                                                         "font-src 'self' data:; frame-ancestors 'none'")
    respuesta.headers["X-Content-Type-Options"] = "nosniff"
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
app.include_router(rutas_fuentes)
app.include_router(rutas_research)
app.include_router(rutas_material)
app.include_router(rutas_practica)
app.include_router(rutas_tutor)
app.include_router(rutas_produccion)
app.include_router(rutas_agenda)
app.include_router(rutas_examen)
app.include_router(rutas_borrar)

# La API sirve también la página (web/dist) si está construida: un solo puerto, http://localhost:8000.
_dist = __import__("pathlib").Path(__file__).resolve().parents[4] / "web" / "dist"
if ajustes.servir_web and _dist.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
