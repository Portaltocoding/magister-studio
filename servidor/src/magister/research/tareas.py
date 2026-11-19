"""Las tareas de research: una por lección, en segundo plano, de dos en dos.

Cada tarea deja su fila en `tareas_research` con la trayectoria; sus propuestas van a
`propuestas` y, con MAGISTER_RESEARCH_INCORPORAR, entran solas (si no, esperan tu aprobación). Al arrancar la API, las `en_curso` pasan a `cortada`.
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from magister.config import ajustes
from magister.datos import plan as dp
from magister.datos.fuentes import Propuesta, TareaResearch
from magister.datos.modelos import Tema
from magister.datos.sesion import nueva_sesion
from magister.research.agente import research_agente
from magister.research.fijo import research_fijo
from magister.research.herramientas import Herramientas, Lectura, Web

registro = logging.getLogger("magister.research")
_semaforo = asyncio.Semaphore(2)
_vivas: set[asyncio.Task] = set()
web_por_defecto: Web = Web()


async def _leccion(plan_id: int, clave: str) -> dict | None:
    async with nueva_sesion() as s:
        fila = await dp.plan_por_id(s, plan_id)
        if fila is None:
            return None
        lecs = {lec.clave: lec for lec in await dp.lecciones(s, plan_id)}
        tema = await s.get(Tema, fila.tema_id)
    if clave not in lecs:
        return None
    lec = lecs[clave]
    return {"clave": clave, "titulo": lec.titulo, "objetivos": lec.objetivos, "tema": tema.nombre if tema else ""}


async def _guardar_propuesta(tarea_id: int, plan_id: int, clave: str, url: str, titulo: str, motivo: str) -> bool:
    async with nueva_sesion() as s, s.begin():
        r = await s.execute(
            insert(Propuesta)
            .values(tarea_id=tarea_id, url=url, titulo=titulo, plan_id=plan_id, leccion_clave=clave, motivo=motivo)
            .on_conflict_do_nothing(constraint="uq_propuestas_url_leccion")
        )
        return bool(r.rowcount)


async def _actualizar(tarea_id: int, **valores) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(TareaResearch).where(TareaResearch.id == tarea_id).values(**valores))


def rellenar_desde_previo(h: Herramientas, previo: dict) -> None:
    """Al reanudar, las herramientas recuerdan qué URLs salieron en las búsquedas y cuáles se leyeron."""
    for r in previo.get("resultados", []):
        h.permitidas.setdefault(r["url"], r.get("titulo", ""))
    for x in previo.get("lecturas", []):
        h.leidas.setdefault(x["url"], Lectura(x["url"], titulo=x.get("titulo", ""), extracto=x.get("resumen", "")))


async def correr(tarea_id: int, web: Web | None = None, previo: dict | None = None) -> dict:
    async with nueva_sesion() as s:
        t = await s.get(TareaResearch, tarea_id)
        plan_id, clave, sistema = t.plan_id, t.leccion_clave, t.sistema
    leccion = await _leccion(plan_id, clave)
    if leccion is None:
        await _actualizar(tarea_id, estado="acabada", motivo_fin="la lección no existe")
        return {"motivo_fin": "la lección no existe"}

    async def guardar(url: str, titulo: str, motivo: str) -> bool:
        return await _guardar_propuesta(tarea_id, plan_id, clave, url, titulo, motivo)

    h = Herramientas(web or web_por_defecto, plan_id, clave, tarea_id, guardar_propuesta=guardar)
    if previo:
        rellenar_desde_previo(h, previo)

    async def guardar_estado(e: dict) -> None:
        limpio = {k: v for k, v in e.items() if k not in ("inicio", "leccion")}
        await _actualizar(
            tarea_id, estado_agente=limpio, trayectoria=e.get("trayectoria", []), pasos=e.get("pasos", 0),
            llamadas_modelo=e.get("llamadas_modelo", 0),
        )

    async with _semaforo:
        try:
            if sistema == "agente":
                r = await research_agente(leccion, h, previo, guardar_estado)
            else:
                r = await research_fijo(leccion, h)
        except Exception as e:  # noqa: BLE001
            registro.exception("research %s", tarea_id)
            r = {"motivo_fin": f"error: {e}", "trayectoria": [], "llamadas": 0}
    await _actualizar(
        tarea_id,
        estado="acabada",
        trayectoria=r.get("trayectoria", []),
        pasos=r.get("pasos", len(r.get("trayectoria", []))),
        llamadas_modelo=r.get("llamadas", 0),
        motivo_fin=r.get("motivo_fin"),
        acabada_en=datetime.now(timezone.utc),
    )
    await incorporar_solas(tarea_id, plan_id, clave)
    return r


async def incorporar_solas(tarea_id: int, plan_id: int, clave: str) -> int | None:
    """Con MAGISTER_RESEARCH_INCORPORAR (por defecto, sí), lo que propone la tarea entra solo en tus fuentes: se encola
    el trabajo «incorporar», sin modelo. El juez del research ya filtró y el texto entra marcado como web (no confiable)."""
    if not ajustes.research_incorporar:
        return None
    try:
        from magister.trabajos import incorporar

        tid, _ = await incorporar.encolar(plan_id, clave, tarea_id, automatica=True)
        return tid
    except Exception:  # noqa: BLE001 si no se encola, las propuestas siguen ahí para aprobarlas a mano
        registro.exception("no se pudieron encolar las propuestas de la tarea %s", tarea_id)
        return None


async def crear(plan_id: int, claves: list[str], sistema: str = "fijo") -> list[int]:
    ids = []
    async with nueva_sesion() as s, s.begin():
        for clave in claves:
            t = TareaResearch(plan_id=plan_id, leccion_clave=clave, sistema=sistema)
            s.add(t)
            await s.flush()
            ids.append(t.id)
    return ids


def lanzar_en_fondo(ids: list[int]) -> None:
    for i in ids:
        tarea = asyncio.create_task(correr(i))
        _vivas.add(tarea)
        tarea.add_done_callback(_vivas.discard)


async def lanzar_y_esperar(plan_id: int, clave: str, sistema: str = "fijo") -> dict:
    [i] = await crear(plan_id, [clave], sistema)
    return await correr(i)


async def reanudar(tarea_id: int) -> dict:
    async with nueva_sesion() as s:
        t = await s.get(TareaResearch, tarea_id)
        previo = dict(t.estado_agente or {}) if t else {}
    await _actualizar(tarea_id, estado="en_curso", motivo_fin=None)
    return await correr(tarea_id, previo=previo)


async def cortar_en_curso() -> int:
    async with nueva_sesion() as s, s.begin():
        r = await s.execute(
            update(TareaResearch).where(TareaResearch.estado == "en_curso").values(estado="cortada", motivo_fin="la API se reinició")
        )
        return r.rowcount or 0


async def tarea(tarea_id: int) -> dict | None:
    async with nueva_sesion() as s:
        t = await s.get(TareaResearch, tarea_id)
    if t is None:
        return None
    return {
        "id": t.id, "plan_id": t.plan_id, "leccion_clave": t.leccion_clave, "sistema": t.sistema, "estado": t.estado,
        "pasos": t.pasos, "llamadas_modelo": t.llamadas_modelo, "motivo_fin": t.motivo_fin,
        "paso_actual": (t.trayectoria or [])[-1] if t.trayectoria else None,
        "incorporar": ajustes.research_incorporar,
    }


async def propuestas(estado: str | None = "pendiente") -> list[dict]:
    async with nueva_sesion() as s:
        consulta = select(Propuesta).order_by(Propuesta.id.desc())
        if estado:
            consulta = consulta.where(Propuesta.estado == estado)
        filas = (await s.scalars(consulta.limit(200))).all()
    return [
        {"id": p.id, "url": p.url, "titulo": p.titulo, "plan_id": p.plan_id, "leccion_clave": p.leccion_clave,
         "motivo": p.motivo, "estado": p.estado, "version_id": p.version_id, "creada_en": p.creada_en.isoformat()}
        for p in filas
    ]
