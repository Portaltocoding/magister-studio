"""Diapositivas en Markdown de Marp. El modelo da el contenido; el formato lo monta el código.

Se pintan con `npx @marp-team/marp-cli` a HTML y a PDF (sin `--allow-local-files`).
"""

import asyncio
import os
import re
import shutil

from pydantic import BaseModel, Field

from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.material.almacen import carpeta_salidas
from magister.tono.hallazgo import Hallazgo

MAX_LINEAS, MAX_PALABRAS = 3, 12


class Diapositiva(BaseModel):
    titulo: str
    lineas: list[str] = Field(default_factory=list, max_length=5)
    tabla: str | None = None
    nota: str


class Presentacion(BaseModel):
    diapositivas: list[Diapositiva] = Field(min_length=2, max_length=12)


async def generar_diapositivas(apuntes: str) -> Presentacion:
    sistema = cargar("diapositivas").rellenar(apuntes=apuntes.split("\n# Repaso")[0][:20000])
    return await estructurar(sistema, "Devuelve las diapositivas.", Presentacion)


def montar_marp(p: Presentacion, titulo: str) -> str:
    partes = ["---\nmarp: true\npaginate: true\ntheme: default\n---", f"# {titulo}"]
    for d in p.diapositivas:
        cuerpo = d.tabla.strip() if d.tabla else "\n".join(d.lineas)
        nota = d.nota.replace("-->", "->")
        partes.append(f"## {d.titulo}\n\n{cuerpo}\n\n<!-- {nota} -->")
    return "\n\n---\n\n".join(partes) + "\n"


def auditar_diapositivas(marp: str) -> list[Hallazgo]:
    hallazgos = []
    for i, d in enumerate(marp.split("\n---\n")[2:], start=1):
        visibles = [x for x in re.sub(r"<!--.*?-->", "", d, flags=re.S).splitlines() if x.strip() and not x.startswith("#")]
        if "<!--" not in d:
            hallazgos.append(Hallazgo(cita=d.strip()[:60] or "-", regla="sin_nota", por_que=f"la diapositiva {i} no tiene nota", gravedad="aviso"))
        if not any(x.startswith("|") for x in visibles) and len(visibles) > MAX_LINEAS:
            hallazgos.append(Hallazgo(cita=visibles[0][:60], regla="lineas", por_que=f"{len(visibles)} líneas visibles", gravedad="aviso"))
        for x in visibles:
            if not x.startswith("|") and len(x.split()) > MAX_PALABRAS:
                hallazgos.append(Hallazgo(cita=x[:80], regla="palabras", por_que=f"{len(x.split())} palabras en una línea", gravedad="aviso"))
            if re.match(r"\s{2,}[-*]", x):
                hallazgos.append(Hallazgo(cita=x.strip()[:60], regla="anidadas", por_que="viñetas anidadas", gravedad="aviso"))
    return hallazgos


async def pintar_marp(marp: str, plan_id: int, clave: str) -> dict:
    carpeta = carpeta_salidas(plan_id, clave)
    md = carpeta / "diapositivas.md"
    md.write_text(marp, encoding="utf-8")
    rutas = {"md": str(md)}
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if npx is None:
        return {**rutas, "error": "no encuentro npx (Node.js)"}
    for formato in ("html", "pdf"):
        salida = carpeta / f"diapositivas.{formato}"
        try:
            proc = await asyncio.create_subprocess_exec(
                npx, "--yes", ajustes.marp, str(md), f"--{formato}", "-o", str(salida),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env={**os.environ},
            )
            await asyncio.wait_for(proc.communicate(), timeout=240)
        except (TimeoutError, OSError) as e:
            rutas["error"] = f"Marp no respondió: {e}"
            continue
        if salida.exists():
            rutas[formato] = str(salida)
    return rutas
