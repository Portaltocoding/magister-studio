"""Producción (Parte VI): valorar respuestas, alertas, candidatos al banco y estado del sistema."""

import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from magister.config import RAIZ_SERVIDOR
from magister.datos.produccion import Alerta, CandidatoBanco
from magister.datos.sesion import sesion_por_peticion
from magister.observar import juez_online, trazas
from magister.observar.registro import puntuar

rutas = APIRouter(prefix="/api")
RUNBOOKS = "docs/runbooks"


class Feedback(BaseModel):
    bien: bool
    comentario: str | None = Field(None, max_length=2000)


class Triaje(BaseModel):
    accion: Literal["aceptar", "descartar"]
    banco: str | None = Field(None, pattern=r"^[a-z_]+$")
    respuesta_buena: str | None = None


@rutas.post("/trazas/{traza_id}/feedback")
async def feedback(traza_id: str, cuerpo: Feedback, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Votar dos veces la misma traza sobrescribe: una sola puntuación `feedback_usuario`."""
    await puntuar(traza_id, "feedback_usuario", 1.0 if cuerpo.bien else 0.0, cuerpo.comentario, sobrescribir=True)
    if not cuerpo.bien:
        entrada = await s.scalar(text(
            "select contenido from mensajes m where m.rol = 'usuario' and m.creado_en <= now() order by m.id desc limit 1")) or ""
        await juez_online.candidato(traza_id, "feedback", entrada, None, cuerpo.comentario)
    return {"traza_id": traza_id, "id": f"fb-{traza_id}"}


@rutas.get("/alertas")
async def alertas(s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    filas = (await s.scalars(select(Alerta).where(Alerta.resuelta.is_(False)).order_by(Alerta.id.desc()).limit(20))).all()
    return [{"id": a.id, "nombre": a.nombre, "detalle": a.detalle, "leida": a.leida, "creada": a.creada.isoformat(),
             "runbook": f"{RUNBOOKS}/{a.nombre}.md"} for a in filas]


@rutas.post("/alertas/{aid}/resolver")
async def resolver(aid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    await s.execute(update(Alerta).where(Alerta.id == aid).values(leida=True, resuelta=True))
    await s.commit()
    return {"id": aid}


@rutas.get("/candidatos")
async def candidatos(s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    filas = (await s.scalars(select(CandidatoBanco).where(CandidatoBanco.estado == "pendiente").order_by(CandidatoBanco.id))).all()
    return [{"id": c.id, "traza_id": c.traza_id, "origen": c.origen, "entrada": c.entrada[-2000:], "salida": (c.salida or "")[-3000:],
             "nota": c.nota} for c in filas]


@rutas.post("/candidatos/{cid}")
async def triar(cid: int, cuerpo: Triaje, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    c = await s.get(CandidatoBanco, cid)
    if c is None:
        raise HTTPException(404, "candidato no encontrado")
    if cuerpo.accion == "aceptar":
        if not cuerpo.banco:
            raise HTTPException(422, "falta el banco")
        carpeta = RAIZ_SERVIDOR / "evals" / "banco" / cuerpo.banco
        carpeta.mkdir(parents=True, exist_ok=True)
        (carpeta / f"{c.traza_id}.json").write_text(json.dumps(
            {"trace_id": c.traza_id, "origen": c.origen, "entrada": c.entrada, "salida_mala": c.salida,
             "respuesta_buena": cuerpo.respuesta_buena, "nota": c.nota}, ensure_ascii=False, indent=1), encoding="utf-8")
    c.estado = "aceptado" if cuerpo.accion == "aceptar" else "descartado"
    c.banco, c.respuesta_buena = cuerpo.banco, cuerpo.respuesta_buena
    await s.commit()
    return {"id": cid, "estado": c.estado}


@rutas.get("/estado")
async def estado(s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """La salud ampliada: base, Langfuse, trabajador, alertas y gasto de hoy."""
    from magister.trabajos import cola

    await s.execute(text("select 1"))
    hoy = (await s.execute(text(
        "select count(*), coalesce(sum(coste_equivalente), 0), coalesce(sum(tokens_entrada + tokens_salida), 0) "
        "from llamadas where creada::date = current_date"))).one()
    alertas_abiertas = await s.scalar(text("select count(*) from alertas where not resuelta"))
    return {"db": "ok", "langfuse": "ok" if trazas.cliente() else "ausente", "trabajador": await cola.trabajador_vivo(),
            "alertas": alertas_abiertas, "llamadas_hoy": hoy[0], "coste_equivalente_hoy": round(float(hoy[1]), 4),
            "tokens_hoy": int(hoy[2])}


