"""Modo examen y evaluación: preguntas del banco de las lecciones que elijas y una nota.

La corrección de cada respuesta va por `/api/practica/intentos`, la misma del repaso: un examen
también es práctica de recuperación y mueve el repaso espaciado y la calibración.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from magister.aprender import examen
from magister.datos.aprender import Examen
from magister.datos.material import Pregunta, PreguntaConcepto
from magister.datos.plan import LeccionFila
from magister.datos.sesion import sesion_por_peticion

rutas = APIRouter(prefix="/api")


class NuevoExamen(BaseModel):
    plan_id: int
    lecciones: list[str] = Field(min_length=1, max_length=50)
    cantidad: int = Field(ge=1, le=40)
    minutos: int | None = Field(default=None, ge=1, le=240)
    modo: Literal["examen", "evaluacion"] = "examen"


class Resultado(BaseModel):
    pregunta_id: str
    respuesta: str = ""
    nota: Literal["fallo", "parcial", "bien", "perfecta"] | None = None
    intento_id: str | None = None
    explicacion: str = Field(default="", max_length=20000)
    confianza: float | None = None


class Final(BaseModel):
    resultados: list[Resultado]
    segundos: int = Field(ge=0)


def _resumen(e: Examen) -> dict:
    return {"id": e.id, "plan_id": e.plan_id, "modo": e.modo, "lecciones": e.lecciones, "minutos": e.minutos,
            "creado": e.creado.isoformat(), "terminado": e.terminado.isoformat() if e.terminado else None,
            "segundos": e.segundos, "nota": e.nota, "preguntas": len(e.preguntas)}


@rutas.get("/planes/{plan_id}/examen/opciones")
async def opciones(plan_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    """Las lecciones con preguntas activas: solo de esas puede salir un examen."""
    filas = (await s.execute(
        select(LeccionFila.clave, LeccionFila.titulo, LeccionFila.orden, func.count(Pregunta.id))
        .join(Pregunta, (Pregunta.plan_id == LeccionFila.plan_id) & (Pregunta.leccion_clave == LeccionFila.clave)
              & (Pregunta.estado == "activa"), isouter=True)
        .where(LeccionFila.plan_id == plan_id)
        .group_by(LeccionFila.clave, LeccionFila.titulo, LeccionFila.orden)
        .order_by(LeccionFila.orden))).all()
    return [{"clave": c, "titulo": t, "preguntas": n} for c, t, _, n in filas]


@rutas.post("/examenes")
async def crear(cuerpo: NuevoExamen, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    filas = (await s.execute(
        select(Pregunta.id, Pregunta.leccion_clave, Pregunta.tipo, Pregunta.enunciado, PreguntaConcepto.concepto_id)
        .join(PreguntaConcepto, PreguntaConcepto.pregunta_id == Pregunta.id)
        .where(Pregunta.plan_id == cuerpo.plan_id, Pregunta.leccion_clave.in_(cuerpo.lecciones), Pregunta.estado == "activa")
    )).all()
    por_leccion: dict[str, list[dict]] = {}
    vistas: set[str] = set()
    for pid, clave, tipo, enunciado, cid in filas:
        if pid in vistas:  # una pregunta con varios conceptos sale una sola vez
            continue
        vistas.add(pid)
        por_leccion.setdefault(clave, []).append(
            {"pregunta_id": pid, "leccion_clave": clave, "tipo": tipo, "enunciado": enunciado, "concepto_id": cid})
    elegidas = examen.elegir(por_leccion, cuerpo.cantidad)
    if not elegidas:
        raise HTTPException(400, "Esas lecciones aún no tienen preguntas: genera su material primero.")
    e = Examen(plan_id=cuerpo.plan_id, modo=cuerpo.modo, lecciones=sorted(por_leccion), preguntas=elegidas,
               minutos=cuerpo.minutos)
    s.add(e)
    await s.commit()
    await s.refresh(e)
    return {**_resumen(e), "preguntas": elegidas}


@rutas.post("/examenes/{examen_id}/terminar")
async def terminar(examen_id: int, cuerpo: Final, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    e = await s.get(Examen, examen_id)
    if e is None:
        raise HTTPException(404, "examen no encontrado")
    por_id = {r.pregunta_id: r for r in cuerpo.resultados}
    referencias = dict((await s.execute(
        select(Pregunta.id, Pregunta.fantasma).where(Pregunta.id.in_([p["pregunta_id"] for p in e.preguntas])))).all())
    preguntas = []
    for p in e.preguntas:
        r = por_id.get(p["pregunta_id"])
        preguntas.append({**p, "respuesta": r.respuesta if r else "", "nota": r.nota if r else None,
                          "intento_id": r.intento_id if r else None,
                          "explicacion": r.explicacion if r else "", "confianza": r.confianza if r else None, "referencia": referencias.get(p["pregunta_id"], "")})
    e.preguntas = preguntas
    e.nota = examen.nota([p["nota"] for p in preguntas])
    e.segundos = cuerpo.segundos
    e.terminado = datetime.now(timezone.utc)
    await s.commit()
    return {**_resumen(e), "detalle": preguntas}


@rutas.get("/examenes")
async def listar(plan_id: int | None = None, s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    q = select(Examen).where(Examen.terminado.is_not(None)).order_by(Examen.creado.desc()).limit(30)
    if plan_id is not None:
        q = q.where(Examen.plan_id == plan_id)
    return [_resumen(e) for e in (await s.scalars(q)).all()]


@rutas.get("/examenes/{examen_id}")
async def ver(examen_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    e = await s.get(Examen, examen_id)
    if e is None:
        raise HTTPException(404, "examen no encontrado")
    return {**_resumen(e), "detalle": e.preguntas if e.terminado else []}
