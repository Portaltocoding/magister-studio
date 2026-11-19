"""Los trabajos de la cola de Proyectos: crear el roadmap (referencias de la web, roadmap y dibujo de la
arquitectura) y detallar un nivel. Son idempotentes: si se reintentan, vuelven a escribir el mismo proyecto."""

import logging
import re

from sqlalchemy import select

from magister.datos.proyectos import Decision, Proyecto
from magister.datos.sesion import nueva_sesion
from magister.proyectos import roadmap as rm
from magister.trabajos import cola

registro = logging.getLogger("magister.proyectos")


def _datos(p: Proyecto) -> dict:
    return {"nombre": p.nombre, "idea": p.idea, "objetivo": p.objetivo, "sabes": p.sabes, "ritmo": p.ritmo}


async def _leer(pid: int) -> Proyecto:
    async with nueva_sesion() as s:
        p = await s.get(Proyecto, pid)
    if p is None:
        raise LookupError(f"el proyecto {pid} ya no existe")
    return p


async def _guardar(pid: int, **valores) -> None:
    async with nueva_sesion() as s, s.begin():
        p = await s.get(Proyecto, pid)
        if p is not None:
            for k, v in valores.items():
                setattr(p, k, v)


def leccion_de(datos: dict) -> dict:
    """Lo que se le describe a la búsqueda: la idea casi entera, y para qué y lo que ya sabe si lo ha dicho."""
    titulo = f"{datos['nombre']}: {datos['idea'][:1200]}"
    if datos.get("objetivo"):
        titulo += f"\nPara qué lo quiere: {datos['objetivo'][:600]}"
    if datos.get("sabes"):
        titulo += f"\nLo que ya sabe: {datos['sabes'][:600]}"
    return {"tema": "Construir un proyecto", "titulo": titulo,
            "objetivos": ["proyectos parecidos de código abierto", "arquitectura de referencia", "tutorial paso a paso",
                          "documentación oficial de las herramientas"]}


def motivo_limpio(motivo: str) -> str:
    """Sin la nota del agente delante («3/3 · …»): el usuario solo ve el porqué."""
    return motivo.split(" · ", 1)[-1] if re.match(r"\d+/\d+ · ", motivo) else motivo


async def buscar_referencias(datos: dict) -> list[dict]:
    """Proyectos, tutoriales y documentación parecidos, con el agente de research (con su tope de coste).
    Si falla (sin red, sin presupuesto), el roadmap se hace igual, sin referencias."""
    from magister.research.fijo import research_fijo
    from magister.research.herramientas import Herramientas
    from magister.research.tareas import web_por_defecto

    encontradas: list[dict] = []

    async def guardar(url: str, titulo: str, motivo: str) -> bool:
        encontradas.append({"url": url, "titulo": titulo, "motivo": motivo_limpio(motivo)})
        return True

    try:
        h = Herramientas(web_por_defecto, 0, "proyecto", None, guardar_propuesta=guardar)
        await research_fijo(leccion_de(datos), h, max_urls=8, max_propuestas=5)
    except Exception as e:  # noqa: BLE001 (las referencias son un extra: sin ellas el roadmap sale igual)
        registro.warning("referencias del proyecto: %s", e)
    return encontradas[:6]


async def crear(trabajo_id: int, pid: int, investigar: bool) -> None:
    p = await _leer(pid)
    datos = _datos(p)
    referencias = p.referencias or []
    if investigar and not referencias:
        await cola.fase(trabajo_id, "referencias", 1, 3)
        referencias = await buscar_referencias(datos)
        await _guardar(pid, referencias=referencias)
    await cola.fase(trabajo_id, "roadmap", 2, 3)
    mapa = await rm.generar_roadmap(datos, referencias)
    await _guardar(pid, roadmap=mapa)
    await cola.fase(trabajo_id, "arquitectura", 3, 3)
    try:
        svg = await rm.dibujar_arquitectura(datos, mapa)
    except Exception as e:  # noqa: BLE001 (el dibujo es un extra: el roadmap ya está)
        registro.warning("arquitectura del proyecto %s: %s", pid, e)
        svg = None
    await _guardar(pid, arquitectura_svg=svg, estado="listo", error=None, trabajo_id=None)


async def detallar(trabajo_id: int, pid: int, numero: int) -> None:
    p = await _leer(pid)
    if not p.roadmap:
        raise LookupError("el proyecto aún no tiene roadmap")
    async with nueva_sesion() as s:
        # Las 15 más recientes, en el orden en que se tomaron.
        filas = (await s.scalars(select(Decision).where(Decision.proyecto_id == pid)
                                 .order_by(Decision.id.desc()).limit(15))).all()
        decisiones = [{"titulo": d.titulo, "decision": d.decision, "contexto": d.contexto} for d in reversed(filas)]
    await cola.fase(trabajo_id, f"nivel {numero}", 1, 1)
    nuevo = await rm.detallar_nivel(p.roadmap, numero, list(p.hechos or []), decisiones, _datos(p))
    await _guardar(pid, roadmap=nuevo, estado="listo", error=None, trabajo_id=None)


async def ejecutar(trabajo_id: int, tipo: str, parametros: dict) -> None:
    pid = int(parametros["proyecto_id"])
    if tipo == "proyecto_roadmap":
        await crear(trabajo_id, pid, bool(parametros.get("investigar", True)))
    elif tipo == "proyecto_nivel":
        await detallar(trabajo_id, pid, int(parametros["numero"]))
