"""Borrar lo que ya no quieres: planes, el material de una lección, exámenes y fuentes.

Siempre se confirma en la pantalla antes de llamar aquí. Lo que cuelga de cada cosa se va con ella
(la base lo hace en cascada) y lo que no tiene clave ajena se limpia a mano.
"""

import shutil
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from magister.config import ajustes
from magister.datos.sesion import sesion_por_peticion

rutas = APIRouter(prefix="/api")


def _borrar_carpetas(plan_id: int, clave: str | None = None) -> None:
    base = Path(ajustes.salidas)
    patron = f"{plan_id}-{clave}" if clave else f"{plan_id}-*"
    for carpeta in base.glob(patron):
        if carpeta.is_dir() and base.resolve() in carpeta.resolve().parents:
            shutil.rmtree(carpeta, ignore_errors=True)


@rutas.delete("/temas/{tema_id}/plan")
async def borrar_plan(tema_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """El plan de un tema con todas sus versiones: lecciones, calendario, material, fichas, repasos y exámenes.

    Las conversaciones se quedan (se borran aparte); el tema también, por si vuelves a planificarlo.
    """
    ids = (await s.scalars(text("select id from planes where tema_id = :t"), {"t": tema_id})).all()
    if not ids:
        raise HTTPException(404, "este tema no tiene plan")
    for tabla in ("servidas", "trabajos"):
        await s.execute(text(f"delete from {tabla} where plan_id = any(:ids)"), {"ids": list(ids)})
    await s.execute(text("delete from planes where id = any(:ids)"), {"ids": list(ids)})
    await s.commit()
    for pid in ids:
        _borrar_carpetas(pid)
    return {"planes": len(ids)}


@rutas.delete("/planes/{plan_id}/lecciones/{clave}/material")
async def borrar_material(plan_id: int, clave: str, tipo: Literal["apuntes", "diapositivas", "guion", "todo"] = "todo",
                          s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """El material de una lección. «todo» quita también sus fichas y deja la lección sin preparar; tus repasos se quedan."""
    tipos = ["apuntes", "diapositivas", "guion"] if tipo == "todo" else [tipo]
    n = (await s.execute(text("delete from materiales where plan_id = :p and leccion_clave = :c and tipo = any(:t)"),
                         {"p": plan_id, "c": clave, "t": tipos})).rowcount
    if tipo == "todo":
        await s.execute(text("delete from preguntas where plan_id = :p and leccion_clave = :c"), {"p": plan_id, "c": clave})
    await s.commit()
    if tipo == "todo":
        _borrar_carpetas(plan_id, clave)
    else:
        carpeta = Path(ajustes.salidas) / f"{plan_id}-{clave}"
        nombres = {"apuntes": ["apuntes.pdf", "apuntes.md"], "diapositivas": ["diapositivas.html", "diapositivas.pdf", "diapositivas.md"],
                   "guion": ["guion.md"]}[tipo]
        for nombre in nombres:
            (carpeta / nombre).unlink(missing_ok=True)
    return {"materiales": n}


@rutas.delete("/examenes/{examen_id}", status_code=204)
async def borrar_examen(examen_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> None:
    """Quita el examen del historial. Las respuestas ya contaron para tu repaso y ahí se quedan."""
    n = (await s.execute(text("delete from examenes where id = :i"), {"i": examen_id})).rowcount
    await s.commit()
    if not n:
        raise HTTPException(404, "examen no encontrado")


@rutas.delete("/fuentes/{fid}", status_code=204)
async def borrar_fuente(fid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> None:
    """Una fuente con sus documentos, versiones y fragmentos indexados; las citas a ella desaparecen de las respuestas."""
    versiones = "select v.id from versiones v join documentos d on d.id = v.documento_id where d.fuente_id = :f"
    await s.execute(text(f"update versiones set duplicado_de = null where duplicado_de in ({versiones})"), {"f": fid})
    await s.execute(text(f"update propuestas set version_id = null where version_id in ({versiones})"), {"f": fid})
    n = (await s.execute(text("delete from fuentes where id = :f"), {"f": fid})).rowcount
    await s.commit()
    if not n:
        raise HTTPException(404, "fuente no encontrada")


@rutas.delete("/fuentes/{fid}/documentos/{did}", status_code=204)
async def borrar_documento(fid: int, did: int, s: AsyncSession = Depends(sesion_por_peticion)) -> None:
    versiones = "select id from versiones where documento_id = :d"
    await s.execute(text(f"update versiones set duplicado_de = null where duplicado_de in ({versiones})"), {"d": did})
    await s.execute(text(f"update propuestas set version_id = null where version_id in ({versiones})"), {"d": did})
    n = (await s.execute(text("delete from documentos where id = :d and fuente_id = :f"), {"d": did, "f": fid})).rowcount
    await s.commit()
    if not n:
        raise HTTPException(404, "documento no encontrado")
