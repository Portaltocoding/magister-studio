"""Lo compartido por los harness de tono: leer el banco y las etiquetas, y guardar informes."""

import json
from datetime import date
from pathlib import Path

from sqlalchemy import text

from magister.datos.sesion import nueva_sesion

RESULTADOS = Path(__file__).resolve().parents[1] / "resultados"


async def bloques_de(particion: str) -> list[dict]:
    if particion == "reserva":
        raise SystemExit("La reserva no se toca: es para la decisión final.")
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select b.material_id, b.clave, b.texto from banco_tono t join bloques_material b "
            "on b.material_id = t.material_id and b.clave = t.clave where t.particion = :p order by t.orden"
        ), {"p": particion})).all()
    return [{"material_id": m, "clave": c, "texto": t} for m, c, t in filas]


async def etiquetas(ronda: int = 1) -> dict[tuple[int, str, str], bool]:
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select material_id, clave, dimension, veredicto from etiquetas where ronda = :r"), {"r": ronda})).all()
    return {(m, c, d): v for m, c, d, v in filas}


def guardar(nombre: str, filas: list[dict]) -> Path:
    RESULTADOS.mkdir(exist_ok=True)
    ruta = RESULTADOS / f"{date.today().isoformat()}-{nombre}.jsonl"
    with ruta.open("w", encoding="utf-8") as f:
        for x in filas:
            f.write(json.dumps(x, ensure_ascii=False) + "\n")
    return ruta
