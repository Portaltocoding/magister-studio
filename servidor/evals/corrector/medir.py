"""Medir el corrector contra tus notas.

    uv run python -m evals.corrector.medir [--corrector real|siempre_bien]

El banco (`evals/corrector/banco.jsonl`) lleva una línea por caso con `enunciado`,
`referencia`, `respuesta`, `nota_humana` y `tipo_caso` (parafrasis, error_anadido,
fuera_de_tema, parcial o confusion). Los casos de ejemplo son provisionales: el libro pide
los tuyos, con más fallos de los que saldrían al azar.
"""

import argparse
import asyncio
import json
import math
import sys
from datetime import date
from pathlib import Path

from evals.estadistica import kappa_ponderada, tabla_de
from magister.aprender.corrector import corregir
from magister.cerebro.prompts import cargar

CARPETA = Path(__file__).parent
NOTAS = ["fallo", "parcial", "bien", "perfecta"]


async def principal(cual: str) -> None:
    casos = [json.loads(x) for x in (CARPETA / "banco.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    humanas, juez = [], []
    for c in casos:
        if cual == "siempre_bien":
            nota = "bien"
        else:
            r, _ = await corregir(c["enunciado"], c["referencia"], c.get("fragmentos", []), c["respuesta"])
            nota = r.nota
        humanas.append(c["nota_humana"])
        juez.append(nota)
        print(f"{c['tipo_caso']:<14} tú {c['nota_humana']:<9} juez {nota}", flush=True)
    t = tabla_de(humanas, juez, NOTAS)
    vp = t[0][0]
    fallos = sum(t[0])
    recall = vp / fallos if fallos else float("nan")
    precision = vp / sum(t[i][0] for i in range(4)) if sum(t[i][0] for i in range(4)) else float("nan")
    ee = math.sqrt(recall * (1 - recall) / fallos) if fallos else float("nan")
    informe = {"matriz_filas_tu_columnas_juez": t, "orden": NOTAS, "kappa_ponderada": round(kappa_ponderada(t), 3),
               "recall_fallo": round(recall, 3), "ee_recall": round(ee, 3), "precision_fallo": round(precision, 3),
               "corrector": cual, "version": cargar("corrector").version, "n": len(casos)}
    print(json.dumps(informe, ensure_ascii=False, indent=1))
    (CARPETA / "resultados").mkdir(exist_ok=True)
    (CARPETA / "resultados" / f"{date.today().isoformat()}-{informe['version']}.json").write_text(
        json.dumps(informe, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--corrector", choices=["real", "siempre_bien"], default="real")
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(principal(ap.parse_args().corrector))
