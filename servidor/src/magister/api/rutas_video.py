"""Descargar un vídeo en MP4: se pide (un trabajo de la cola lo monta con Piper y ffmpeg), se mira cómo va y se baja.

La web manda las escenas tal como las narra el reproductor, con el texto ya preparado para la voz (glosario de
pronunciación aplicado): así el MP4 suena igual que lo que oyes en pantalla.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from magister.config import ajustes
from magister.datos.material import Material
from magister.datos.sesion import sesion_por_peticion
from magister.trabajos import cola
from magister.trabajos.video import huella, leer_meta, ruta_mp4
from magister.voz import piper

rutas = APIRouter(prefix="/api")


class FraseVideo(BaseModel):
    texto: str = Field(min_length=1, max_length=piper.MAX_TEXTO)
    dicho: str | None = Field(None, max_length=piper.MAX_TEXTO)


class EscenaVideo(BaseModel):
    marca: str = Field("", max_length=40)
    frases: list[FraseVideo] = Field(min_length=1, max_length=60)
    pagina: int | None = Field(None, ge=1, le=500)


class PedirMp4(BaseModel):
    voz: str = Field(max_length=40)
    titulo: str = Field("", max_length=200)
    escenas: list[EscenaVideo] = Field(min_length=1, max_length=80)


async def _guion(mid: int, s: AsyncSession) -> Material:
    m = await s.get(Material, mid)
    if m is None or m.tipo != "guion":
        raise HTTPException(404, "vídeo no encontrado")
    return m


async def _ultimo_trabajo(mid: int, s: AsyncSession) -> dict | None:
    tid = await s.scalar(text("select id from trabajos where tipo = 'video_mp4' and (parametros->>'material_id')::bigint = :m "
                              "order by id desc limit 1"), {"m": mid})
    return await cola.leer(tid) if tid else None


@rutas.post("/materiales/{mid}/mp4", status_code=202)
async def pedir_mp4(mid: int, cuerpo: PedirMp4, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    m = await _guion(mid, s)
    plan_id, clave = m.plan_id, m.leccion_clave
    await s.close()
    if not any(v.id == cuerpo.voz for v in piper.disponibles()):
        raise HTTPException(409, "para descargar el vídeo hace falta la voz de Magister (Piper) instalada")
    escenas = [e.model_dump() for e in cuerpo.escenas]
    marca = huella(escenas, cuerpo.voz)
    # Si ya está hecho con estas escenas y esta voz, no se repite.
    meta = leer_meta(ruta_mp4(plan_id, clave, mid))
    if meta and meta.get("huella") == marca:
        return {"trabajo_id": None, "listo": True}
    tid, nuevo = await cola.encolar("video_mp4", plan_id, clave, {"material_id": mid, "voz": cuerpo.voz, "titulo": cuerpo.titulo,
                                                                   "escenas": escenas}, cola.clave_idempotencia(video_mp4=mid, huella=marca))
    return {"trabajo_id": tid, "nuevo": nuevo, "listo": False}


@rutas.get("/materiales/{mid}/mp4")
async def estado_mp4(mid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Si ya hay MP4 (y con qué voz y cuánto dura) y cómo va el último trabajo que lo monta."""
    m = await _guion(mid, s)
    meta = leer_meta(ruta_mp4(m.plan_id, m.leccion_clave, mid))
    return {"listo": meta is not None, "voz": (meta or {}).get("voz"), "segundos": (meta or {}).get("segundos"),
            "huella": (meta or {}).get("huella"), "trabajo": await _ultimo_trabajo(mid, s),
            "trabajador": await cola.trabajador_vivo()}


@rutas.get("/materiales/{mid}/mp4/fichero")
async def fichero_mp4(mid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> FileResponse:
    m = await _guion(mid, s)
    base = Path(ajustes.salidas).resolve()
    ruta = ruta_mp4(m.plan_id, m.leccion_clave, mid).resolve()
    if base not in ruta.parents or not ruta.exists():
        raise HTTPException(404, "el MP4 aún no está hecho")
    return FileResponse(ruta, media_type="video/mp4", filename=f"{m.leccion_clave}-video-{mid}.mp4")
