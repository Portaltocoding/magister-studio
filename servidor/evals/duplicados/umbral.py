"""El umbral de preguntas casi duplicadas.

    uv run python -m evals.duplicados.umbral etiquetar     20 pares de enunciados con su similitud a un CSV
    uv run python -m evals.duplicados.umbral umbral        precisión y recall de 0,75 a 0,95 con tu columna `repetida`
"""

import argparse
import asyncio
import csv
import random
import sys
from itertools import combinations
from pathlib import Path

from sqlalchemy import text

from magister.datos.sesion import nueva_sesion
from magister.material.preguntas import similitud

CSV = Path(__file__).resolve().parents[1] / "resultados" / "duplicados.csv"


async def etiquetar() -> None:
    async with nueva_sesion() as s:
        filas = (await s.execute(text("select id, plan_id, leccion_clave, enunciado from preguntas"))).all()
    por_leccion: dict = {}
    for i, p, c, e in filas:
        por_leccion.setdefault((p, c), []).append((i, e))
    pares = [(a, b, similitud(a[1], b[1])) for g in por_leccion.values() for a, b in combinations(g, 2)]
    pares.sort(key=lambda x: -x[2])
    rng = random.Random(7)
    elegidos = pares[:10] + rng.sample(pares[10:], min(10, max(0, len(pares) - 10)))
    CSV.parent.mkdir(exist_ok=True)
    with CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["a", "b", "enunciado_a", "enunciado_b", "similitud", "repetida"])
        for a, b, s in elegidos:
            w.writerow([a[0], b[0], a[1], b[1], f"{s:.3f}", ""])
    print(f"Marca «repetida» con 1 o 0 en {CSV}")


def umbral() -> None:
    with CSV.open(encoding="utf-8") as f:
        filas = [(float(r["similitud"]), r["repetida"].strip() == "1") for r in csv.DictReader(f) if r["repetida"].strip()]
    for u in (0.75, 0.80, 0.85, 0.90, 0.95):
        vp = sum(1 for s, r in filas if s >= u and r)
        fp = sum(1 for s, r in filas if s >= u and not r)
        fn = sum(1 for s, r in filas if s < u and r)
        p = vp / (vp + fp) if vp + fp else float("nan")
        rc = vp / (vp + fn) if vp + fn else float("nan")
        print(f"umbral {u:.2f}: precisión {p:.2f} · recall {rc:.2f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("modo", choices=["etiquetar", "umbral"])
    a = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(etiquetar()) if a.modo == "etiquetar" else umbral()
