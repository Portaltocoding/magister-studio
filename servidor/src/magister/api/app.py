import asyncio
import logging
import uuid
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from magister.api.rutas_agenda import rutas as rutas_agenda
from magister.api.rutas_examen import rutas as rutas_examen
from magister.api.rutas_borrar import rutas as rutas_borrar
from magister.api.rutas_conversaciones import rutas as rutas_conversaciones
from magister.api.rutas_asesor import rutas as rutas_asesor
from magister.api.rutas_fuentes import rutas as rutas_fuentes
from magister.api.rutas_material import rutas as rutas_material
from magister.api.rutas_practica import rutas as rutas_practica
from magister.api.rutas_tutor import rutas as rutas_tutor
from magister.api.rutas_produccion import rutas as rutas_produccion
from magister.api.rutas_modelos import rutas as rutas_modelos
from magister.api.rutas_research import rutas as rutas_research
from magister.api.rutas_plan import rutas as rutas_plan
from magister.api.rutas_estudio import rutas as rutas_estudio
from magister.api.rutas_notas import rutas as rutas_notas
from magister.api.rutas_voz import rutas as rutas_voz
from magister.api.rutas_proyectos import rutas as rutas_proyectos
from magister.api.rutas_cuota import rutas as rutas_cuota
from magister.api.rutas_video import rutas as rutas_video
from magister.api.seguridad import Proteccion
from magister.config import ajustes
from magister.datos import conversaciones as dc
from magister.datos import sesion
from magister.datos.sesion import sesion_por_peticion
from magister.flujo.grafo import iniciar as iniciar_grafo

VERSION_CONTRATO = "1.0"

registro = logging.getLogger("uvicorn.error")

def _a_investigar(p: dict, hoy, maximo: int) -> list[str]:
    from magister.plan.horizonte import lecciones_a_investigar

    return lecciones_a_investigar(p["lecciones"], p["tareas"], hoy, ajustes.research_horizonte_dias, maximo,
                                  vieja_dias=ajustes.research_vieja_dias, material_propio=p.get("material_propio", False))


def _a_juzgar(p: dict, hoy) -> list[str]:
    from magister.plan.horizonte import lecciones_a_juzgar
    from magister.research.necesidad import LOTE

    return lecciones_a_juzgar(p["lecciones"], p["tareas"], hoy, ajustes.research_horizonte_dias, LOTE,
                              vieja_dias=ajustes.research_vieja_dias)


async def _planes_del_horizonte() -> list[dict]:
    """`datos.plan.para_horizonte` y, en cada lección, `sin_fuente`: los objetivos que se sabe que no tienen fuente
    (None si no se sabe), para decidir si falta información (plan/horizonte.py)."""
    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion
    from magister.flujo.planes import cobertura_de_plan

    async with nueva_sesion() as s:
        planes = await dp.para_horizonte(s)
        for p in planes:
            cobertura = await cobertura_de_plan(s, p["plan_id"])
            for lec in p["lecciones"]:
                lec["sin_fuente"] = cobertura.get(lec["clave"])
    return planes


# Planes cuyo juicio barato falló hoy: no se vuelve a intentar cada 10 minutos (sería una llamada por vuelta).
_juicio_fallido: dict[int, date] = {}


async def por_investigar(hoy) -> set[tuple[int, str]]:
    """Las (plan_id, clave) que el research automático lanzaría ahora, o que va a juzgar antes de decidirlo: sus apuntes
    automáticos esperan (trabajos/automatizar.py), para no hacerlos a ciegas justo antes de que lleguen sus fuentes."""
    from magister.cerebro import freno

    if not ajustes.research_auto or freno.estado()["parados"]:
        return set()
    planes = await _planes_del_horizonte()
    return {(p["plan_id"], c) for p in planes if not p["en_curso"]
            for c in _a_investigar(p, hoy, len(p["lecciones"])) + _a_juzgar(p, hoy)}


async def investigar_horizonte(buscador, hoy, hay_red=None) -> list[str]:
    """Una vuelta del research automático (encargo 8; ADR-0021, nota del 19-11-2026): en cada plan aceptado, las
    lecciones que empiezan en los próximos MAGISTER_RESEARCH_HORIZONTE_DIAS días, siguen sin fuentes y de verdad las
    necesitan: «imprescindible», o «conviene» con objetivos sin fuente (solo esos). «Conviene» sin más la lanzas tú.
    Las que aún no tienen etiqueta las etiqueta antes el modelo barato (`research/necesidad.py`), y no se buscan por si
    acaso. Devuelve lo anotado. No lanza nada si el freno está echado, si el plan ya tiene una búsqueda en curso o si
    `hay_red` (una búsqueda web barata, sin modelo) dice que no hay red: sin ella, cada lección gastaría una consulta."""
    from magister.cerebro import freno
    from magister.flujo.fuentes import calcular_apoyo
    from magister.plan.horizonte import cuando_empiezas, objetivos_a_buscar
    from magister.research import necesidad, tareas
    from magister.trabajos.automatizar import anotar

    if freno.estado()["parados"]:
        return []
    planes = await _planes_del_horizonte()
    hechos: list[str] = []
    quedan = ajustes.research_por_vuelta
    red_comprobada = False
    for p in planes:
        if quedan <= 0:
            break
        if p["en_curso"]:
            continue
        recargar = False
        if not p["con_apoyo"] and buscador is not None:
            # Un plan aceptado sin buscar puede no tener ni el cálculo del apoyo: sin él, todo parecería sin material.
            await calcular_apoyo(buscador, p["plan_id"], p["tema_id"])
            recargar = True
        a_juzgar = _a_juzgar(p, hoy)
        if a_juzgar and _juicio_fallido.get(p["plan_id"]) != hoy:
            try:
                etiquetas = await necesidad.juzgar_plan(p["plan_id"], a_juzgar)
            except Exception:  # noqa: BLE001  (sin etiqueta no se busca: se intenta otro día)
                registro.exception("research automático: no se pudo decidir si %s necesitan fuentes", a_juzgar)
                _juicio_fallido[p["plan_id"]] = hoy
                etiquetas = {}
            if etiquetas:
                cuenta = sum(1 for v in etiquetas.values() if v == "imprescindible")
                claves_j = list(etiquetas)
                lista = claves_j[0] if len(claves_j) == 1 else f"{', '.join(claves_j[:-1])} y {claves_j[-1]}"
                texto = (f"Decidido con el modelo barato si {lista} de {p['tema']} necesitan fuentes: "
                         f"{cuenta} de {len(claves_j)} sí")
                await anotar(texto)
                hechos.append(texto)
                recargar = True
        if recargar:
            p = next((x for x in await _planes_del_horizonte() if x["plan_id"] == p["plan_id"]), p)
        claves = _a_investigar(p, hoy, quedan)
        if not claves:
            continue
        if hay_red is not None and not red_comprobada:
            if not await hay_red():
                registro.warning("research automático: no hay red (la búsqueda web no responde); lo intento en la próxima vuelta")
                return hechos
            red_comprobada = True
        por_clave = {x["clave"]: x for x in p["lecciones"]}
        ids: list[int] = []
        for clave in claves:
            # En una «conviene» con falta de información, solo los objetivos sin fuente («Buscar esto»).
            ids += await tareas.crear(p["plan_id"], [clave],
                                      objetivos=objetivos_a_buscar(por_clave[clave], p.get("material_propio", False)))
        tareas.lanzar_en_fondo(ids)
        quedan -= len(claves)
        primera = min(por_clave[c]["primera_sesion"] for c in claves)
        texto = f"Buscando fuentes para {' y '.join(claves)} de {p['tema']} (empiezas {cuando_empiezas(primera, hoy)})"
        await anotar(texto)
        hechos.append(texto)
    return hechos


async def bucle_horizonte(buscador) -> None:
    from magister.research import tareas

    while True:
        # Primero se espera: al arrancar ya hay bastante (cargar e5, el reranker, cortar lo que quedó a medias).
        await asyncio.sleep(ajustes.research_intervalo_s)
        try:
            await investigar_horizonte(buscador, date.today(), tareas.web_por_defecto.hay_red)
        except Exception:  # noqa: BLE001  (si falla una vuelta, la siguiente lo vuelve a intentar)
            registro.exception("research automático")


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
    alertas.instalar_freno()
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
        from magister.fuentes import reranker

        # El reranker es la segunda puerta de «hay fuentes» (ADR-0018): unos 5 s de carga, también ya y en un hilo.
        asyncio.create_task(asyncio.to_thread(reranker.calentar))
    fondo = asyncio.create_task(bucle_de_fondo(al_quedar_listas)) if ajustes.procesar_fondo else None
    from magister.trabajos.trabajador import bucle as bucle_trabajos

    # El trabajador de la cola corre dentro de la API salvo que se lance aparte (magister-trabajador).
    trabajador = asyncio.create_task(bucle_trabajos()) if ajustes.trabajos_en_api else None
    from magister.trabajos.automatizar import bucle as bucle_automatizaciones, registrar_por_investigar

    # Los apuntes automáticos esperan también a lo que el research automático va a buscar ahora.
    registrar_por_investigar(por_investigar)
    # Las automatizaciones que enciendes (preparar la próxima lección, vídeos...) se revisan cada pocos minutos.
    automatizaciones = asyncio.create_task(bucle_automatizaciones()) if ajustes.trabajos_en_api else None
    # Las fuentes de lo que vas a estudiar pronto se buscan solas (MAGISTER_RESEARCH_AUTO), también sin pulsar nada.
    horizonte = asyncio.create_task(bucle_horizonte(buscador)) if ajustes.research_auto else None
    # La copia del día dentro de la API (modo Docker); en Windows la hacen la tarea programada y arrancar.ps1.
    from magister.api.rutas_datos import bucle_copia_diaria

    copias = asyncio.create_task(bucle_copia_diaria()) if ajustes.copia_diaria else None
    async with AsyncSqliteSaver.from_conn_string(ajustes.checkpoints) as saver:
        iniciar_grafo(saver, buscador)
        yield
    for tarea in (fondo, trabajador, vigia, horizonte, copias):
        if tarea is not None:
            tarea.cancel()
    iniciar_grafo(None)
    from magister.voz import piper

    await piper.cerrar()
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
        # font-src data:: las fuentes de KaTeX van incrustadas en su CSS. media-src blob:: la voz (leer en voz alta,
        # el tutor y el vídeo narrado) se descarga y suena desde un blob.
        respuesta.headers["Content-Security-Policy"] = ("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                                                         "font-src 'self' data:; media-src 'self' blob: data:; frame-ancestors 'none'")
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
app.include_router(rutas_asesor)
app.include_router(rutas_plan)
app.include_router(rutas_fuentes)
app.include_router(rutas_research)
app.include_router(rutas_material)
app.include_router(rutas_practica)
app.include_router(rutas_tutor)
app.include_router(rutas_produccion)
app.include_router(rutas_agenda)
app.include_router(rutas_estudio)
app.include_router(rutas_notas)
app.include_router(rutas_voz)
app.include_router(rutas_proyectos)
app.include_router(rutas_examen)
app.include_router(rutas_video)
app.include_router(rutas_borrar)
app.include_router(rutas_cuota)
app.include_router(rutas_modelos)
from magister.api.rutas_datos import rutas as rutas_datos  # noqa: E402

app.include_router(rutas_datos)

# La API sirve también la página (web/dist) si está construida: un solo puerto, http://localhost:8000.
_dist = __import__("pathlib").Path(__file__).resolve().parents[4] / "web" / "dist"
if ajustes.servir_web and _dist.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
