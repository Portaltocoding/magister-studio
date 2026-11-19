"""El research por lección y tu aprobación de sus propuestas (Parte III)."""

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import update

from magister.config import ajustes
from magister.datos import plan as dp
from magister.datos import repositorio_fuentes as rf
from magister.datos.fuentes import Propuesta
from magister.datos.sesion import nueva_sesion
from magister.fuentes import ingesta
from magister.research import tareas
from magister.seguridad.politica import UrlProhibida, comprobar_url
from magister.trabajos import cola, incorporar

rutas = APIRouter(prefix="/api")


class ResearchEntrada(BaseModel):
    plan_id: int
    leccion_claves: list[str] = Field(min_length=1, max_length=30)
    # «agente» es experimental: queda para las evals (ADR-0020); el de siempre es el fijo por objetivos.
    sistema: Literal["fijo", "agente"] = "fijo"
    # Buscar solo para estos objetivos (desde 1) de la lección: «Buscar esto». Solo con una lección.
    objetivos: list[int] | None = Field(default=None, max_length=10)
    # Buscar aunque el plan diga que la lección no necesita fuentes: lo mandan los botones de una lección («Buscar
    # fuentes», «buscar igualmente», «Buscar esto»). Un lote, aunque sea de una sola lección, no fuerza nada.
    forzar: bool = False


class Decision(BaseModel):
    accion: Literal["aprobar", "rechazar"]


@rutas.post("/research", status_code=202)
async def lanzar(cuerpo: ResearchEntrada) -> dict:
    """Las lecciones que el plan marca con `necesita_fuentes` = «no» se saltan (salvo con `forzar`): la
    respuesta dice cuáles en `saltadas` y por qué en `aviso`."""
    if cuerpo.objetivos is not None and len(cuerpo.leccion_claves) != 1:
        raise HTTPException(422, "los objetivos solo valen para buscar en una lección")
    if cuerpo.objetivos is not None and any(o < 1 for o in cuerpo.objetivos):
        raise HTTPException(422, "los objetivos se cuentan desde 1")
    async with nueva_sesion() as s:
        if await dp.plan_por_id(s, cuerpo.plan_id) is None:
            raise HTTPException(404, "plan no encontrado")
    try:
        return await tareas.lanzar(cuerpo.plan_id, cuerpo.leccion_claves, cuerpo.sistema, cuerpo.objetivos, cuerpo.forzar)
    except LookupError as e:
        raise HTTPException(404, str(e)) from None


@rutas.get("/research/{tarea_id}")
async def ver(tarea_id: int) -> dict:
    t = await tareas.tarea(tarea_id)
    if t is None:
        raise HTTPException(404, "tarea no encontrada")
    return t


class Incorporar(BaseModel):
    plan_id: int | None = None
    leccion_clave: str | None = Field(default=None, max_length=20)


@rutas.post("/incorporar", status_code=202)
async def incorporar_pendientes(cuerpo: Incorporar) -> dict:
    """Todas las propuestas pendientes (o las de un plan o una lección) entran en tus fuentes por la cola, sin modelo."""
    previo = await incorporar.en_marcha()
    if previo is not None:
        r = await incorporar.leer(previo)
        return {"trabajo_id": previo, "total": r["total"] if r else 0, "ya_en_marcha": True}
    # Dos clics seguidos dan un solo trabajo; otro rato, otra ronda (lo que falló por la red se vuelve a intentar).
    ronda = cola.ahora().strftime("%Y%m%d%H%M")
    tid, n = await incorporar.encolar(cuerpo.plan_id, cuerpo.leccion_clave, ronda=ronda)
    return {"trabajo_id": tid, "total": n, "ya_en_marcha": False}


@rutas.get("/incorporar/ultimo")
async def ultima_incorporacion() -> dict:
    """El último trabajo de incorporar (también los que lanzó solo el research) y si lo propuesto entra solo."""
    return {"ultimo": await incorporar.leer(), "solas": ajustes.research_incorporar}


@rutas.get("/incorporar/{tid}")
async def ver_incorporacion(tid: int) -> dict:
    r = await incorporar.leer(tid)
    if r is None:
        raise HTTPException(404, "trabajo no encontrado")
    return r


@rutas.get("/propuestas")
async def listar(estado: str | None = "pendiente") -> list[dict]:
    return await tareas.propuestas(estado or None)


@rutas.post("/propuestas/{pid}")
async def decidir(pid: int, cuerpo: Decision) -> dict:
    """Aprobar manda la URL a la ingesta entera (validación, duplicados, cuarentena) en la fuente del research."""
    async with nueva_sesion() as s:
        p = await s.get(Propuesta, pid)
        if p is None:
            raise HTTPException(404, "propuesta no encontrada")
        if p.estado != "pendiente":
            raise HTTPException(409, "esta propuesta ya está decidida")
        plan = await dp.plan_por_id(s, p.plan_id)
        url, tema_id = p.url, plan.tema_id if plan else None
        origen = {"origen": "research", "automatica": False, "propuesta_id": pid, "plan_id": p.plan_id,
                  "leccion_clave": p.leccion_clave}
    version_id = None
    if cuerpo.accion == "aprobar":
        try:
            await asyncio.to_thread(comprobar_url, url)
        except UrlProhibida as e:
            raise HTTPException(422, f"la dirección ya no es válida: {e}") from None
        fuente = await rf.fuente_o_nueva(incorporar.FUENTE, "web", 1)
        try:
            crudo, tipo = await ingesta.descargar(url, externa=True)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(422, f"no se pudo descargar: {incorporar.motivo_de(e)}") from None
        version_id = await ingesta.recibir(fuente.id, crudo, url, url, tema_id, tipo, origen)
    async with nueva_sesion() as s, s.begin():
        await s.execute(
            # Solo si sigue pendiente: el trabajo de incorporar pudo meterla mientras tanto.
            update(Propuesta).where(Propuesta.id == pid, Propuesta.estado == "pendiente").values(
                estado="aprobada" if cuerpo.accion == "aprobar" else "rechazada", version_id=version_id
            )
        )
    return {"id": pid, "estado": "aprobada" if cuerpo.accion == "aprobar" else "rechazada", "version_id": version_id}


class ResearchLibre(BaseModel):
    consulta: str = Field(min_length=3, max_length=300)


@rutas.post("/research/libre")
async def research_libre(cuerpo: ResearchLibre) -> dict:
    """Busca y puntúa páginas sobre un tema de Estudio libre. Devuelve las mejores; añadirlas a tus fuentes es aparte."""
    from magister.research.fijo import research_fijo
    from magister.research.herramientas import Herramientas

    encontradas: list[dict] = []

    async def guardar(url: str, titulo: str, motivo: str, ficha: dict | None = None) -> bool:
        encontradas.append({"url": url, "titulo": titulo, "motivo": motivo, "ficha": ficha})
        return True

    h = Herramientas(tareas.web_por_defecto, 0, "libre", None, guardar_propuesta=guardar)
    r = await research_fijo({"tema": "Estudio libre", "titulo": cuerpo.consulta, "objetivos": []}, h, max_urls=8, max_propuestas=4)
    return {"propuestas": encontradas, "motivo_fin": r.get("motivo_fin")}
