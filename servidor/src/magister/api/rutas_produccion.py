"""Producción (Parte VI): valorar respuestas, alertas, candidatos al banco y estado del sistema."""

import json
import re
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from magister.config import RAIZ_SERVIDOR
from magister.datos.produccion import Alerta, CandidatoBanco, Puntuacion
from magister.datos.sesion import sesion_por_peticion
from magister.observar import afinado, juez_online, trazas
from magister.observar.registro import puntuar

rutas = APIRouter(prefix="/api")
RUNBOOKS = "docs/runbooks"


class Feedback(BaseModel):
    bien: bool
    comentario: str | None = Field(None, max_length=2000)
    otra: bool = False  # pidió otra explicación
    # Qué falló, de la lista de `tono.confianza.MOTIVOS` («largo», «sin_ejemplo»...): afina la confianza y las reglas.
    motivos: list[Annotated[str, Field(max_length=20)]] = Field(default_factory=list, max_length=8)


class Triaje(BaseModel):
    accion: Literal["aceptar", "descartar"]
    banco: str | None = Field(None, pattern=r"^[a-z_]+$")
    respuesta_buena: str | None = Field(None, max_length=8000)
    # Tu feedback: qué falló (los motivos de «no me sirve»), un comentario y, si vino del juez, si acertó.
    comentario: str | None = Field(None, max_length=2000)
    motivos: list[Annotated[str, Field(max_length=20)]] = Field(default_factory=list, max_length=8)
    juez_acerto: bool | None = None


@rutas.post("/trazas/{traza_id}/feedback")
async def feedback(traza_id: str, cuerpo: Feedback, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Votar dos veces la misma traza sobrescribe: una sola puntuación `feedback_usuario`."""
    # Lo aprendido cuenta cada respuesta una vez: repetir el mismo voto no suma de nuevo; cambiarlo, sí (el nuevo).
    previo = await s.scalar(select(Puntuacion.valor).where(Puntuacion.traza_id == traza_id, Puntuacion.nombre == "feedback_usuario"))
    await puntuar(traza_id, "feedback_usuario", 1.0 if cuerpo.bien else 0.0, cuerpo.comentario, sobrescribir=True)
    if previo is None or bool(previo) != cuerpo.bien:
        await afinado.registrar_valoracion(cuerpo.bien, cuerpo.motivos)
    if not cuerpo.bien:
        entrada = await s.scalar(text(
            "select contenido from mensajes m where m.rol = 'usuario' and m.creado_en <= now() order by m.id desc limit 1")) or ""
        await juez_online.candidato(traza_id, "otra_explicacion" if cuerpo.otra else "feedback", entrada, None, cuerpo.comentario)
    if cuerpo.otra:
        await puntuar(traza_id, "otra_explicacion", 1.0, cuerpo.comentario, sobrescribir=True)
    return {"traza_id": traza_id, "id": f"fb-{traza_id}"}


@rutas.get("/afinado")
async def ver_afinado() -> dict:
    """Lo que Magister ha aprendido de tus valoraciones y cuánto revisa ya el juez."""
    return await afinado.estado_publico()


@rutas.post("/afinado/reglas/{motivo}/quitar")
async def quitar_regla(motivo: str) -> dict:
    try:
        await afinado.quitar_regla(motivo)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return await afinado.estado_publico()


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


# Qué miró el juez en cada dimensión, en palabras tuyas (las mismas que en Ajustes).
NOMBRES_DIMENSION = {"razonamiento": "Que se entienda y razone bien", "economia": "Que vaya al grano", "trato": "Que el tono sea el tuyo"}


def _motivos_del_juez(nota: str | None) -> list[dict]:
    """La crítica del juez viene como «razonamiento: …; economia: …»: se parte por dimensión."""
    if not nota:
        return []
    partes = re.split(r"(?:^|; )(razonamiento|economia|trato): ", nota)
    if len(partes) < 3:
        return [{"dimension": None, "nombre": "Por qué", "razon": nota}]
    return [{"dimension": d, "nombre": NOMBRES_DIMENSION[d], "razon": r.strip()} for d, r in zip(partes[1::2], partes[2::2])]


@rutas.get("/candidatos")
async def candidatos(s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    """Los pendientes, con lo que preguntaste y lo que respondió el tutor (del hilo, por la traza) para leerlos a gusto.
    La entrada guardada del juez es el prompt de sistema: no se envía."""
    filas = (await s.scalars(select(CandidatoBanco).where(CandidatoBanco.estado == "pendiente").order_by(CandidatoBanco.id))).all()
    hilo: dict[str, tuple[str | None, str]] = {}
    if filas:
        for traza, pregunta, respuesta in (await s.execute(text(
            "select t.traza_id, (select u.contenido from mensajes u where u.conversacion_id = t.conversacion_id "
            "and u.rol = 'usuario' and u.id < t.id order by u.id desc limit 1), t.contenido "
            "from mensajes t where t.rol = 'tutor' and t.traza_id = any(:t)"), {"t": [c.traza_id for c in filas]})).all():
            hilo[traza] = (pregunta, respuesta)
    salida = []
    for c in filas:
        pregunta, respuesta = hilo.get(c.traza_id, (None, None))
        if pregunta is None and c.origen != "juez":
            pregunta = c.entrada
        salida.append({
            "id": c.id, "traza_id": c.traza_id, "origen": c.origen, "creado": c.creado.isoformat(),
            "pregunta": (pregunta or "")[-2000:] or None, "respuesta": (respuesta or c.salida or "")[-6000:] or None,
            "nota": c.nota, "motivos_juez": _motivos_del_juez(c.nota) if c.origen == "juez" else [],
        })
    return salida


@rutas.post("/candidatos/{cid}")
async def triar(cid: int, cuerpo: Triaje, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    c = await s.get(CandidatoBanco, cid)
    if c is None:
        raise HTTPException(404, "candidato no encontrado")
    motivos = afinado.motivos_validos(cuerpo.motivos)
    if cuerpo.accion == "aceptar":
        if not cuerpo.banco:
            raise HTTPException(422, "falta el banco")
        carpeta = RAIZ_SERVIDOR / "evals" / "banco" / cuerpo.banco
        carpeta.mkdir(parents=True, exist_ok=True)
        (carpeta / f"{c.traza_id}.json").write_text(json.dumps(
            {"trace_id": c.traza_id, "origen": c.origen, "entrada": c.entrada, "salida_mala": c.salida,
             "respuesta_buena": cuerpo.respuesta_buena, "nota": c.nota, "comentario": cuerpo.comentario, "motivos": motivos},
            ensure_ascii=False, indent=1), encoding="utf-8")
    # Si dices si el juez acertó, cuenta como tu valoración de esa respuesta (una sola vez, aunque deshagas y vuelvas).
    if c.origen == "juez" and cuerpo.juez_acerto is not None and c.juez_acerto is None:
        await afinado.registrar_valoracion(not cuerpo.juez_acerto, motivos if cuerpo.juez_acerto else [])
    c.estado = "aceptado" if cuerpo.accion == "aceptar" else "descartado"
    c.banco, c.respuesta_buena = cuerpo.banco if cuerpo.accion == "aceptar" else None, cuerpo.respuesta_buena
    c.comentario, c.motivos = cuerpo.comentario, motivos
    if cuerpo.juez_acerto is not None:
        c.juez_acerto = cuerpo.juez_acerto
    await s.commit()
    return {"id": cid, "estado": c.estado}


@rutas.post("/candidatos/{cid}/deshacer")
async def deshacer_triaje(cid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Vuelve a dejarlo pendiente; si estaba en el banco, quita su fichero."""
    c = await s.get(CandidatoBanco, cid)
    if c is None:
        raise HTTPException(404, "candidato no encontrado")
    if c.estado == "aceptado" and c.banco:
        (RAIZ_SERVIDOR / "evals" / "banco" / c.banco / f"{c.traza_id}.json").unlink(missing_ok=True)
    c.estado, c.banco = "pendiente", None
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


