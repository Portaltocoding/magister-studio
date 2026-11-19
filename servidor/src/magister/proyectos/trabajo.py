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
                          "documentación oficial de las herramientas"],
            "alumno": {"sabes": datos.get("sabes")}}


def leccion_de_bloques(datos: dict, mapa: dict | None) -> dict:
    """La búsqueda de referencias para lo que de verdad hay que construir: proyectos parecidos y los bloques del nivel 1
    (hasta 3). El juez sabe lo que ya sabe, así que lo que ya domina no se le trae. Sin bloques, la de siempre."""
    bloques = [b["titulo"] for b in ((mapa or {}).get("niveles") or [{}])[0].get("bloques", [])][:3]
    leccion = leccion_de(datos)
    if bloques:
        leccion["objetivos"] = ["Proyectos parecidos de código abierto", *bloques]
    return leccion


def bloque_de(ficha: dict | None, mapa: dict | None) -> tuple[int | None, str | None]:
    """(número del bloque del nivel 1, su id) que cubre una referencia, según los objetivos que le dio el juez: el
    objetivo 1 son los proyectos parecidos (ningún bloque) y el k, el bloque k-1."""
    objetivos = sorted(o for o in (ficha or {}).get("objetivos", []) if o >= 2)
    bloques = ((mapa or {}).get("niveles") or [{}])[0].get("bloques", [])
    if not objetivos or objetivos[0] - 1 > len(bloques):
        return None, None
    n = objetivos[0] - 1
    return n, bloques[n - 1].get("id")


def motivo_limpio(motivo: str) -> str:
    """Sin la nota del agente delante («3/3 · …»): el usuario solo ve el porqué."""
    return motivo.split(" · ", 1)[-1] if re.match(r"\d+/\d+ · ", motivo) else motivo


async def buscar_referencias(datos: dict, mapa: dict | None = None) -> list[dict]:
    """Proyectos parecidos y lo que piden los bloques del nivel 1, con el research fijo (2 llamadas). Cada referencia
    lleva su `bloque` (número en el nivel 1, o None) y `bloque_id`. Si falla (sin red, sin presupuesto), el proyecto
    sale igual, sin referencias."""
    from magister.research.fijo import research_fijo
    from magister.research.herramientas import Herramientas
    from magister.research.tareas import web_por_defecto

    encontradas: list[dict] = []

    async def guardar(url: str, titulo: str, motivo: str, ficha: dict | None = None) -> bool:
        bloque, bloque_id = bloque_de(ficha, mapa)
        porque = (ficha or {}).get("resumen") or motivo_limpio(motivo)
        encontradas.append({"url": url, "titulo": titulo, "motivo": porque, "bloque": bloque, "bloque_id": bloque_id,
                            "ficha": ficha})
        return True

    try:
        h = Herramientas(web_por_defecto, 0, "proyecto", None, guardar_propuesta=guardar)
        await research_fijo(leccion_de_bloques(datos, mapa), h, max_urls=8, max_propuestas=5)
    except Exception as e:  # noqa: BLE001 (las referencias son un extra: sin ellas el proyecto sale igual)
        registro.warning("referencias del proyecto: %s", e)
    return encontradas[:6]


async def _guardar_roadmap(trabajo_id: int, pid: int, mapa: dict) -> dict:
    """Guarda el roadmap recién hecho. Si ya había uno (rehacer), lo de antes se conserva (`rm.conservar`: los pasos
    que siguen heredan su id, lo hecho de los que no se apunta aparte) y el de antes se guarda para poder volver.
    Si este trabajo se reintenta, el de antes es el que guardó la primera vez, no el que él mismo escribió."""
    async with nueva_sesion() as s, s.begin():
        p = await s.scalar(select(Proyecto).where(Proyecto.id == pid).with_for_update())
        if p is None:
            raise LookupError(f"el proyecto {pid} ya no existe")
        anterior = p.roadmap_anterior if (p.roadmap_anterior or {}).get("trabajo_id") == trabajo_id else None
        viejo = anterior["roadmap"] if anterior else p.roadmap
        if viejo:
            diario = set((await s.scalars(select(Decision.paso_id).where(
                Decision.proyecto_id == pid, Decision.paso_id.is_not(None)))).all())
            mapa = rm.conservar(viejo, mapa, list(p.hechos or []), dict(p.hechos_en or {}), diario)
            p.roadmap_anterior = anterior or {"roadmap": viejo, "arquitectura_svg": p.arquitectura_svg, "trabajo_id": trabajo_id}
        p.roadmap = mapa
    return mapa


async def crear(trabajo_id: int, pid: int, investigar: bool) -> None:
    p = await _leer(pid)
    datos = _datos(p)
    # Primero el roadmap y después las referencias, para los bloques del nivel 1: así se busca lo que hay que
    # construir, no lo que ya dominas.
    await cola.fase(trabajo_id, "roadmap", 1, 3)
    # Si se está rehaciendo, el modelo ve el de antes para dejar igual el título de lo que sigue (si este trabajo se
    # reintenta, el de antes es el que guardó la primera vez).
    anterior = (p.roadmap_anterior or {}).get("roadmap") if (p.roadmap_anterior or {}).get("trabajo_id") == trabajo_id else p.roadmap
    nuevo = await rm.generar_roadmap(datos, [], anterior=anterior, hechos=list(p.hechos or []))
    mapa = await _guardar_roadmap(trabajo_id, pid, nuevo)
    if investigar and not (p.referencias or []):
        await cola.fase(trabajo_id, "referencias", 2, 3)
        await _guardar(pid, referencias=await buscar_referencias(datos, mapa))
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
        # Los pasos del diario (también de pasos que ya no están): un paso nuevo nunca hereda uno de esos ids.
        diario = frozenset((await s.scalars(select(Decision.paso_id).where(
            Decision.proyecto_id == pid, Decision.paso_id.is_not(None)))).all())
    await cola.fase(trabajo_id, f"nivel {numero}", 1, 1)
    nuevo = await rm.detallar_nivel(p.roadmap, numero, list(p.hechos or []), decisiones, _datos(p),
                                    usados=diario | frozenset(p.hechos_en or {}))
    await _guardar_detalle(pid, p.roadmap, nuevo, numero)


def _sin_numero(n: dict | None) -> dict | None:
    return {k: v for k, v in n.items() if k != "numero"} if n is not None else None


async def _guardar_detalle(pid: int, base: dict, nuevo: dict, numero: int) -> None:
    """Guarda el nivel recién detallado sin pisar lo que cambió mientras el modelo escribía: mientras el trabajo está
    en cola el proyecto se sigue usando (el asesor cambia otro nivel, marcas pasos). Se pone solo ese nivel sobre el
    roadmap de ahora; si el que cambió es justo ese nivel, no se adivina: falla y se vuelve a pedir."""
    nivel_base = next(n for n in base["niveles"] if n["numero"] == numero)
    nivel_nuevo = next(n for n in nuevo["niveles"] if n["id"] == nivel_base["id"])
    async with nueva_sesion() as s, s.begin():
        p = await s.scalar(select(Proyecto).where(Proyecto.id == pid).with_for_update())
        if p is None:
            raise LookupError(f"el proyecto {pid} ya no existe")
        actual = p.roadmap or {}
        if actual == base:
            roadmap = nuevo
        else:
            ahora = next((n for n in actual.get("niveles", []) if n["id"] == nivel_base["id"]), None)
            if _sin_numero(ahora) != _sin_numero(nivel_base):
                raise LookupError(f"el nivel {numero} ha cambiado mientras se detallaba: vuelve a pedirlo")
            roadmap = {**actual, "niveles": [{**nivel_nuevo, "numero": n["numero"]} if n["id"] == nivel_base["id"] else n
                                             for n in actual["niveles"]]}
        p.roadmap, p.estado, p.error, p.trabajo_id = roadmap, "listo", None, None


async def ejecutar(trabajo_id: int, tipo: str, parametros: dict) -> None:
    pid = int(parametros["proyecto_id"])
    if tipo == "proyecto_roadmap":
        await crear(trabajo_id, pid, bool(parametros.get("investigar", True)))
    elif tipo == "proyecto_nivel":
        await detallar(trabajo_id, pid, int(parametros["numero"]))
