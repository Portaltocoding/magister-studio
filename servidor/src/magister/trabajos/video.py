"""El trabajo «video_mp4»: exportar un vídeo (un guion) a MP4 con la voz de Magister.

Idempotente: el destino depende del material y de la voz, y se escribe entero al final (un fichero a medias nunca
queda con el nombre bueno). Al lado se guarda qué escenas y qué voz lo hicieron, para saber si sigue al día.
"""

import asyncio
import hashlib
import json
from pathlib import Path

from magister.config import ajustes
from magister.datos.material import Material
from magister.datos.sesion import nueva_sesion
from magister.material.generador import Cancelado
from magister.trabajos import cola
from magister.voz import video

FASE = "video_mp4"


def carpeta(plan_id: int, clave: str) -> Path:
    return Path(ajustes.salidas) / f"{plan_id}-{clave}"


def ruta_mp4(plan_id: int, clave: str, material_id: int) -> Path:
    return carpeta(plan_id, clave) / f"video-{material_id}.mp4"


def huella(escenas: list[dict], voz: str) -> str:
    return hashlib.sha256(json.dumps({"escenas": escenas, "voz": voz}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def leer_meta(mp4: Path) -> dict | None:
    meta = mp4.with_suffix(".json")
    try:
        return json.loads(meta.read_text(encoding="utf-8")) if mp4.exists() and meta.exists() else None
    except (OSError, ValueError):
        return None


async def ejecutar(trabajo_id: int, parametros: dict) -> None:
    mid = int(parametros["material_id"])
    async with nueva_sesion() as s:
        m = await s.get(Material, mid)
        if m is None or m.tipo != "guion":
            raise LookupError(f"el vídeo {mid} ya no existe")
        plan_id, clave = m.plan_id, m.leccion_clave
    escenas = [
        video.EscenaVideo(
            marca=e.get("marca") or "",
            frases=tuple(video.Frase(f["texto"], f.get("dicho") or f["texto"]) for f in e.get("frases", []) if f.get("texto")),
            pagina=e.get("pagina"),
        )
        for e in parametros["escenas"]
    ]
    pdf = carpeta(plan_id, clave) / "diapositivas.pdf"
    destino = ruta_mp4(plan_id, clave, mid)

    async def avance(paso: int, total: int) -> None:
        if await cola.cancelado(trabajo_id):
            raise Cancelado()
        await cola.fase(trabajo_id, FASE, paso, total)

    await cola.fase(trabajo_id, FASE, 0, len(escenas))
    try:
        segundos = await video.exportar(escenas, parametros["voz"], destino, pdf=pdf if any(e.pagina for e in escenas) else None,
                                        titulo=parametros.get("titulo") or clave, avance=avance)
    except video.ErrorVideo as e:
        # No es transitorio (falta Piper o ffmpeg, o el guion no tiene escenas): sin reintentos.
        raise LookupError(str(e)) from None
    # ffmpeg puede acabar entre dos avances: si te lo cancelaron (o borraste el vídeo) mientras, el MP4 no se queda.
    if await cola.cancelado(trabajo_id):
        await asyncio.to_thread(destino.unlink, missing_ok=True)
        raise Cancelado()
    meta = {"huella": huella(parametros["escenas"], parametros["voz"]), "voz": parametros["voz"], "segundos": round(segundos, 1)}
    await asyncio.to_thread(destino.with_suffix(".json").write_text, json.dumps(meta), encoding="utf-8")
