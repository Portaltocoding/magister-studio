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
from magister.plan.apoyo import necesidad_efectiva
from magister.plan.horizonte import es_fallo
from magister.research.agente import research_agente
from magister.research.fijo import research_fijo
from magister.research.herramientas import Herramientas, Lectura, Web

registro = logging.getLogger("magister.research")
_semaforo = asyncio.Semaphore(2)
_vivas: set[asyncio.Task] = set()
web_por_defecto: Web = Web()


def alumno_de(perfil: dict | None) -> dict:
    """Lo que el juez sabe del alumno: nivel, para qué lo quiere y sus preferencias (sin horas ni fechas)."""
    p = perfil or {}
    return {k: p.get(k) for k in ("nivel", "objetivo", "preferencias") if p.get(k)}


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
    return {"clave": clave, "titulo": lec.titulo, "objetivos": lec.objetivos, "tema": tema.nombre if tema else "",
            "alumno": alumno_de(fila.perfil)}


# Cuándo hace falta buscar (R-CUANDO): el plan marca cada lección con `necesita_fuentes` = no | conviene |
# imprescindible. «Para aprender a dividir no hace falta una research»: lo que no la necesita no gasta cuota.
NECESIDADES = ("no", "conviene", "imprescindible")


def necesidad(leccion) -> str:
    """La de la lección (un dict o una fila); si aún no la tiene o no se entiende, «conviene»."""
    valor = leccion.get("necesita_fuentes") if isinstance(leccion, dict) else getattr(leccion, "necesita_fuentes", None)
    return valor if valor in NECESIDADES else "conviene"


def separar_por_necesidad(lecciones: dict, claves: list[str], forzar: bool) -> tuple[list[str], list[str]]:
    """(las que se buscan, las que se saltan). `forzar` (pedir a mano una lección concreta) busca siempre."""
    if forzar:
        return list(claves), []
    buscar = [c for c in claves if c not in lecciones or necesidad(lecciones[c]) != "no"]
    return buscar, [c for c in claves if c not in buscar]


async def _guardar_propuesta(tarea_id: int, plan_id: int, clave: str, url: str, titulo: str, motivo: str,
                             ficha: dict | None = None) -> bool:
    async with nueva_sesion() as s, s.begin():
        valores = dict(tarea_id=tarea_id, titulo=titulo, motivo=motivo, ficha=ficha)
        # Si la misma página ya estaba propuesta para esa lección y sigue pendiente, vale lo que dice el juez de ahora
        # (así entra con su ficha); lo que ya aprobaste o rechazaste no se toca.
        r = await s.execute(
            insert(Propuesta)
            .values(url=url, plan_id=plan_id, leccion_clave=clave, **valores)
            .on_conflict_do_update(constraint="uq_propuestas_url_leccion", set_=valores,
                                   where=Propuesta.estado == "pendiente")
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
        pedidos = list((t.estado_agente or {}).get("objetivos") or [])
    leccion = await _leccion(plan_id, clave)
    if leccion is None:
        await _actualizar(tarea_id, estado="acabada", motivo_fin="la lección no existe")
        return {"motivo_fin": "la lección no existe"}
    if pedidos:
        leccion["pedidos"] = pedidos

    async def guardar(url: str, titulo: str, motivo: str, ficha: dict | None = None) -> bool:
        return await _guardar_propuesta(tarea_id, plan_id, clave, url, titulo, motivo, ficha)

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
                # Un plazo total (MAGISTER_RESEARCH_PLAZO_TAREA_S): una lectura colgada no deja la tarea en curso
                # para siempre, ocupando uno de los 2 huecos.
                r = await asyncio.wait_for(research_fijo(leccion, h), ajustes.research_plazo_tarea_s)
        except TimeoutError:
            registro.warning("research %s: se pasó de %s s", tarea_id, ajustes.research_plazo_tarea_s)
            r = {"motivo_fin": f"se pasó de {ajustes.research_plazo_tarea_s} s", "trayectoria": [], "llamadas": 0}
        except Exception as e:  # noqa: BLE001
            registro.exception("research %s", tarea_id)
            r = {"motivo_fin": f"error: {e}", "trayectoria": [], "llamadas": 0}
    # Sin red, con la búsqueda web bloqueada, con el freno o pasado el plazo, no hubo resultado: la tarea queda «cortada»
    # (se puede reintentar) y no «acabada», que el research automático no repetiría en 14 días.
    await _actualizar(
        tarea_id,
        estado="cortada" if es_fallo(r.get("motivo_fin")) else "acabada",
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


async def crear(plan_id: int, claves: list[str], sistema: str = "fijo", objetivos: list[int] | None = None) -> list[int]:
    """`objetivos`: buscar solo para esos objetivos de la lección («Buscar esto»); se guardan en `estado_agente`."""
    ids = []
    async with nueva_sesion() as s, s.begin():
        for clave in claves:
            t = TareaResearch(plan_id=plan_id, leccion_clave=clave, sistema=sistema,
                              estado_agente={"objetivos": list(objetivos)} if objetivos else {})
            s.add(t)
            await s.flush()
            ids.append(t.id)
    return ids


async def lanzar(plan_id: int, claves: list[str], sistema: str = "fijo", objetivos: list[int] | None = None,
                 forzar: bool = False) -> dict:
    """Crea y lanza en segundo plano las tareas de las lecciones que lo necesitan. Las marcadas «no» se saltan, salvo
    `forzar` (lo manda el botón de una lección: «Buscar fuentes», «buscar igualmente», «Buscar esto»). Un lote de una
    sola lección no fuerza nada. Con material tuyo del tema, ninguna es «no» (necesidad_efectiva: tus apuntes mandan)."""
    async with nueva_sesion() as s:
        fila = await dp.plan_por_id(s, plan_id)
        propio = fila is not None and fila.tema_id is not None and await dp.material_propio_de_tema(s, fila.tema_id) > 0
        lecciones = {
            lec.clave: {"necesita_fuentes": necesidad_efectiva(getattr(lec, "necesita_fuentes", None), None, propio)[0]}
            for lec in await dp.lecciones(s, plan_id)
        }
    buscar, saltadas = separar_por_necesidad(lecciones, claves, forzar)
    ids = await crear(plan_id, buscar, sistema, objetivos) if buscar else []
    lanzar_en_fondo(ids)
    aviso = None
    if saltadas:
        aviso = (f"No busco fuentes para {len(saltadas)} {'lección' if len(saltadas) == 1 else 'lecciones'} "
                 f"({', '.join(saltadas)}): se explican bien sin ellas. Si quieres, búscalas una a una.")
    return {"tareas": ids, "saltadas": saltadas, "aviso": aviso}


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
         "motivo": p.motivo, "estado": p.estado, "version_id": p.version_id, "ficha": p.ficha,
         "creada_en": p.creada_en.isoformat()}
        for p in filas
    ]
