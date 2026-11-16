"""El research por lección y tu aprobación de sus propuestas (Parte III)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import update

from magister.datos import plan as dp
from magister.datos import repositorio_fuentes as rf
from magister.datos.fuentes import Propuesta
from magister.datos.sesion import nueva_sesion
from magister.fuentes import ingesta
from magister.research import tareas

rutas = APIRouter(prefix="/api")


class ResearchEntrada(BaseModel):
    plan_id: int
    leccion_claves: list[str] = Field(min_length=1, max_length=30)
    sistema: Literal["fijo", "agente"] = "fijo"


class Decision(BaseModel):
    accion: Literal["aprobar", "rechazar"]


@rutas.post("/research", status_code=202)
async def lanzar(cuerpo: ResearchEntrada) -> dict:
    async with nueva_sesion() as s:
        if await dp.plan_por_id(s, cuerpo.plan_id) is None:
            raise HTTPException(404, "plan no encontrado")
    ids = await tareas.crear(cuerpo.plan_id, cuerpo.leccion_claves, cuerpo.sistema)
    tareas.lanzar_en_fondo(ids)
    return {"tareas": ids}


@rutas.get("/research/{tarea_id}")
async def ver(tarea_id: int) -> dict:
    t = await tareas.tarea(tarea_id)
    if t is None:
        raise HTTPException(404, "tarea no encontrada")
    return t


@rutas.get("/propuestas")
async def listar(estado: str | None = "pendiente") -> list[dict]:
    return await tareas.propuestas(estado or None)


@rutas.post("/propuestas/{pid}")
async def decidir(pid: int, cuerpo: Decision) -> dict:
    """Aprobar manda la URL a la ingesta entera (validación, duplicados, cuarentena) en la fuente `web`."""
    async with nueva_sesion() as s:
        p = await s.get(Propuesta, pid)
        if p is None:
            raise HTTPException(404, "propuesta no encontrada")
        if p.estado != "pendiente":
            raise HTTPException(409, "esta propuesta ya está decidida")
        plan = await dp.plan_por_id(s, p.plan_id)
        url, tema_id = p.url, plan.tema_id if plan else None
    version_id = None
    if cuerpo.accion == "aprobar":
        fuente = await rf.fuente_o_nueva("web", "web", 1)
        try:
            crudo, tipo = await ingesta.descargar(url)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(422, f"no se pudo descargar: {e}") from None
        version_id = await ingesta.recibir(fuente.id, crudo, url, url, tema_id, tipo)
    async with nueva_sesion() as s, s.begin():
        await s.execute(
            update(Propuesta).where(Propuesta.id == pid).values(
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

    async def guardar(url: str, titulo: str, motivo: str) -> bool:
        encontradas.append({"url": url, "titulo": titulo, "motivo": motivo})
        return True

    h = Herramientas(tareas.web_por_defecto, 0, "libre", None, guardar_propuesta=guardar)
    r = await research_fijo({"tema": "Estudio libre", "titulo": cuerpo.consulta, "objetivos": []}, h, max_urls=8, max_propuestas=4)
    return {"propuestas": encontradas, "motivo_fin": r.get("motivo_fin")}
