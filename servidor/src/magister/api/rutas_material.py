"""Material de una lección (Parte IV): trabajos en segundo plano, progreso por SSE,
materiales y sus ficheros, preguntas y el banco de tono para calibrar el juez."""

import random
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.datos.material import BancoTono, BloqueMaterial, Etiqueta, Material, Pregunta
from magister.datos.plan import LeccionFila
from magister.datos.sesion import sesion_por_peticion
from magister.tono.juez import DIMENSIONES, rubrica
from magister.trabajos import cola, eventos

rutas = APIRouter(prefix="/api")
PROMPTS = ["apuntes_contrato", "apuntes_bloque", "apuntes_refinar", "conceptos", "preguntas", "diapositivas", "guion",
           "juez_tono", "juez_completitud"]
FICHEROS = {"pdf": "apuntes.pdf", "md": "apuntes.md", "contacto": "contacto.png", "html": "diapositivas.html",
            "diapositivas_pdf": "diapositivas.pdf", "guion": "guion.md"}


class Preferencias(BaseModel):
    profundidad: Literal["intro", "estandar", "fondo"] = "estandar"
    preguntas: Literal["conceptuales", "practicas", "mezcla"] = "mezcla"
    cantidad: Literal["pocas", "normal", "muchas"] = "normal"
    enfoque: str | None = Field(None, max_length=300)
    estilo: Literal["libro", "ficha"] = "libro"


class PedirMaterial(BaseModel):
    tipos: list[Literal["apuntes", "preguntas", "diapositivas", "guion"]] = ["apuntes", "preguntas", "diapositivas", "guion"]
    forzar: bool = False
    preferencias: Preferencias = Preferencias()


@rutas.post("/planes/{plan_id}/lecciones/{clave}/material", status_code=202)
async def pedir_material(plan_id: int, clave: str, cuerpo: PedirMaterial, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    if await s.get(LeccionFila, (plan_id, clave)) is None:
        raise HTTPException(404, "lección no encontrada")
    fuentes = (await s.execute(text(
        "select coalesce(max(f.version_id), 0), count(*) from lecciones_fragmentos lf join fragmentos f on f.id = lf.fragmento_id "
        "where lf.plan_id = :p and lf.leccion_clave = :c"), {"p": plan_id, "c": clave})).one()
    await s.close()
    clave_trabajo = cola.clave_idempotencia(
        plan_id=plan_id, leccion=clave, fuentes=list(fuentes), prompts={n: cargar(n).version for n in PROMPTS},
        modelo=ajustes.modelo, tipos=sorted(cuerpo.tipos), preferencias=cuerpo.preferencias.model_dump(), forzar=datetime.now().isoformat() if cuerpo.forzar else None,
    )
    tid, nuevo = await cola.encolar("material", plan_id, clave,
                                    {"tipos": cuerpo.tipos, "preferencias": cuerpo.preferencias.model_dump()}, clave_trabajo)
    return {"trabajo_id": tid, "nuevo": nuevo}


@rutas.get("/planes/{plan_id}/materiales")
async def materiales_del_plan(plan_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Por lección: el estado del último material de cada tipo, cuántas fichas tiene y si hay un trabajo en marcha."""
    filas = (await s.execute(text(
        "select distinct on (leccion_clave, tipo) leccion_clave, tipo, estado, id from materiales "
        "where plan_id = :p order by leccion_clave, tipo, id desc"), {"p": plan_id})).all()
    fichas = dict((await s.execute(text(
        "select leccion_clave, count(*) from preguntas where plan_id = :p and estado = 'activa' and not sonda "
        "group by leccion_clave"), {"p": plan_id})).all())
    en_marcha = set((await s.scalars(text(
        "select leccion_clave from trabajos where plan_id = :p and tipo = 'material' and estado in ('pendiente', 'en_curso')"),
        {"p": plan_id})).all())
    salida: dict[str, dict] = {}
    for clave, tipo, estado, mid in filas:
        d = salida.setdefault(clave, {"tipos": {}, "fichas": 0, "en_marcha": False})
        d["tipos"][tipo] = estado
        if tipo == "apuntes":
            d["apuntes_id"] = mid  # para abrir la lección en modo foco
    for clave in set(fichas) | en_marcha:
        salida.setdefault(clave, {"tipos": {}, "fichas": 0, "en_marcha": False})
    for clave, d in salida.items():
        d["fichas"] = fichas.get(clave, 0)
        d["en_marcha"] = clave in en_marcha
    return salida


class CambiarEstilo(BaseModel):
    estilo: Literal["libro", "ficha"]


@rutas.post("/materiales/{mid}/estilo")
async def cambiar_estilo(mid: int, cuerpo: CambiarEstilo, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Vuelve a pintar los apuntes en otro estilo, sin llamar al modelo."""
    from magister.material import almacen
    from magister.material.render import pintar

    m = await s.get(Material, mid)
    if m is None or m.tipo != "apuntes":
        raise HTTPException(404, "apuntes no encontrados")
    await s.close()
    md = await almacen.montar_markdown(mid, cuerpo.estilo)
    r = await pintar(md, m.plan_id, m.leccion_clave, estilo=cuerpo.estilo)
    return {"estilo": cuerpo.estilo, "paginas": r.paginas, "error": r.error}


@rutas.get("/trabajos/{tid}")
async def ver_trabajo(tid: int) -> dict:
    t = await cola.leer(tid)
    if t is None:
        raise HTTPException(404, "trabajo no encontrado")
    return t


@rutas.post("/trabajos/{tid}/cancelar", status_code=202)
async def cancelar(tid: int) -> dict:
    if await cola.leer(tid) is None:
        raise HTTPException(404, "trabajo no encontrado")
    return {"cancelado": await cola.cancelar(tid)}


@rutas.get("/trabajos/{tid}/eventos", response_class=EventSourceResponse)
async def eventos_trabajo(tid: int) -> AsyncIterator[ServerSentEvent]:
    async for ev in eventos.seguir(tid):
        yield ServerSentEvent(data={k: v for k, v in ev.items() if k != "tipo"}, event=ev["tipo"])


def _material(m: Material, con_texto: bool = False) -> dict:
    salida = {"id": m.id, "tipo": m.tipo, "estado": m.estado, "motivo": m.motivo, "trabajo_id": m.trabajo_id,
              "ficheros": [k for k, v in FICHEROS.items() if Path(ajustes.salidas, f"{m.plan_id}-{m.leccion_clave}", v).exists()
                           and (k in ("pdf", "md", "contacto") if m.tipo == "apuntes" else k in ("html", "diapositivas_pdf") if m.tipo == "diapositivas" else k == "guion")],
              "informes": m.informes, "actualizado_en": m.actualizado_en.isoformat()}
    if con_texto:
        salida["texto"] = m.texto
        salida["contrato"] = m.contrato
    if m.tipo == "apuntes":
        from magister.material.almacen import estilo_de

        salida["estilo"] = estilo_de(m)
    return salida


@rutas.get("/planes/{plan_id}/lecciones/{clave}/material")
async def material_de_leccion(plan_id: int, clave: str, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    mats = (await s.scalars(select(Material).where(Material.plan_id == plan_id, Material.leccion_clave == clave)
                            .order_by(Material.id.desc()))).all()
    ultimo: dict[str, Material] = {}
    for m in mats:
        ultimo.setdefault(m.tipo, m)
    preguntas = (await s.scalars(select(Pregunta).where(Pregunta.plan_id == plan_id, Pregunta.leccion_clave == clave,
                                                        Pregunta.estado == "activa").order_by(Pregunta.id))).all()
    trabajo = await s.scalar(text("select id from trabajos where plan_id = :p and leccion_clave = :c order by id desc limit 1"),
                             {"p": plan_id, "c": clave})
    return {
        "materiales": {t: _material(m) for t, m in ultimo.items()},
        "preguntas": [{"id": p.id, "tipo": p.tipo, "enunciado": p.enunciado, "fantasma": p.fantasma, "donde": p.donde} for p in preguntas],
        "ultimo_trabajo": await cola.leer(trabajo) if trabajo else None,
    }


@rutas.get("/materiales/{mid}")
async def ver_material(mid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    m = await s.get(Material, mid)
    if m is None:
        raise HTTPException(404, "material no encontrado")
    return _material(m, con_texto=True)


@rutas.get("/materiales/{mid}/fichero/{nombre}")
async def fichero(mid: int, nombre: str, s: AsyncSession = Depends(sesion_por_peticion)) -> FileResponse:
    m = await s.get(Material, mid)
    if m is None or nombre not in FICHEROS:
        raise HTTPException(404, "fichero no encontrado")
    base = Path(ajustes.salidas).resolve()
    ruta = (base / f"{m.plan_id}-{m.leccion_clave}" / FICHEROS[nombre]).resolve()
    if base not in ruta.parents or not ruta.exists():
        raise HTTPException(404, "fichero no encontrado")
    return FileResponse(ruta, filename=f"{m.leccion_clave}-{ruta.name}" if nombre != "html" else None)


# El banco de tono y las etiquetas (calibrar el juez)


class EtiquetaEntrada(BaseModel):
    material_id: int
    clave: str
    dimension: Literal["razonamiento", "economia", "trato", "completitud"]
    veredicto: bool
    critica: str | None = Field(None, max_length=2000)
    ronda: Literal[1, 2] = 1


@rutas.post("/banco/repartir", status_code=201)
async def repartir(semilla: int = 20261115, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    if await s.scalar(select(func.count()).select_from(BancoTono)):
        raise HTTPException(409, "el banco ya está repartido")
    filas = (await s.execute(select(BloqueMaterial.material_id, BloqueMaterial.clave, Material.plan_id, Material.leccion_clave)
                             .join(Material, Material.id == BloqueMaterial.material_id))).all()
    if not filas:
        raise HTTPException(409, "todavía no hay bloques generados")
    rng = random.Random(semilla)
    lecciones = sorted({(f[2], f[3]) for f in filas})
    apartadas = set(rng.sample(lecciones, min(3, max(0, len(lecciones) - 1)))) if len(lecciones) > 3 else set()
    resto = [f for f in filas if (f[2], f[3]) not in apartadas]
    rng.shuffle(resto)
    resto = resto[:160]
    n_alinear = min(40, len(resto) // 4)
    asignados = [(f, "alinear") for f in resto[:n_alinear]] + [(f, "validar") for f in resto[n_alinear:]]
    asignados += [(f, "reserva") for f in filas if (f[2], f[3]) in apartadas]
    for orden, (f, particion) in enumerate(asignados):
        s.add(BancoTono(material_id=f[0], clave=f[1], particion=particion, semilla=semilla, orden=orden))
    await s.commit()
    return {"alinear": sum(p == "alinear" for _, p in asignados), "validar": sum(p == "validar" for _, p in asignados),
            "reserva": sum(p == "reserva" for _, p in asignados), "semilla": semilla}


@rutas.get("/etiquetar/siguiente")
async def siguiente(ronda: int = 1, particion: str | None = None, s: AsyncSession = Depends(sesion_por_peticion)) -> dict | None:
    """Un bloque sin versión ni autor, en el orden aleatorio del reparto."""
    consulta = (select(BancoTono, BloqueMaterial.texto).join(BloqueMaterial, (BloqueMaterial.material_id == BancoTono.material_id)
                                                             & (BloqueMaterial.clave == BancoTono.clave))
                .where(BancoTono.particion != "reserva").order_by(BancoTono.orden))
    if particion:
        consulta = consulta.where(BancoTono.particion == particion)
    for banco, texto in (await s.execute(consulta)).all():
        hechas = await s.scalar(select(func.count()).select_from(Etiqueta).where(
            Etiqueta.material_id == banco.material_id, Etiqueta.clave == banco.clave, Etiqueta.ronda == ronda))
        if ronda == 2 and banco.particion != "validar":
            continue
        if not hechas:
            total = await s.scalar(select(func.count()).select_from(BancoTono).where(BancoTono.particion != "reserva"))
            return {"material_id": banco.material_id, "clave": banco.clave, "texto": texto, "dimensiones": list(DIMENSIONES),
                    "ronda": ronda, "pendientes": total}
    return None


@rutas.post("/etiquetas", status_code=201)
async def etiquetar(cuerpo: EtiquetaEntrada, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    _, version = rubrica()
    await s.execute(insert(Etiqueta).values(**cuerpo.model_dump(), version_rubrica=version).on_conflict_do_update(
        constraint="uq_etiquetas_unica", set_={"veredicto": cuerpo.veredicto, "critica": cuerpo.critica}))
    await s.commit()
    return {"ok": True}


@rutas.get("/trabajos-salud")
async def salud_trabajos() -> dict:
    return {"trabajador_vivo": await cola.trabajador_vivo(), "en_api": ajustes.trabajos_en_api}
