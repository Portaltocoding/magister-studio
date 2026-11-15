"""Eval del retriever sobre el banco de preguntas.

    uv run python -m evals.rag --indice v1 [--via hibrida] [--reranker]
    uv run python -m evals.rag --tabla          densa, léxica, híbrida, híbrida + reranker (y v2 si existe)

Escribe una fila por pregunta en evals/resultados/<config>__<hash del banco>.csv y, con
--tabla, evals/RESULTADOS.md. Las preguntas sin respuesta no cuentan aquí.
"""

import argparse
import asyncio
import csv
import hashlib
import json
import statistics
import sys
import time
from pathlib import Path

from sqlalchemy import text

from evals.metricas import media_y_error, ndcg_en, pasaje_en, rango_reciproco, recall_en
from magister.cerebro.contratos import Consulta, Filtros
from magister.datos.sesion import nueva_sesion
from magister.fuentes.buscar import BuscadorHibrido

CARPETA = Path(__file__).parent
BANCO = CARPETA / "banco_rag.jsonl"


def cargar(ruta: Path = BANCO) -> tuple[list[dict], str]:
    crudo = ruta.read_bytes()
    filas = [json.loads(x) for x in crudo.decode("utf-8").splitlines() if x.strip()]
    return filas, hashlib.sha256(crudo).hexdigest()[:12]


async def intervalos(ids: list[int]) -> dict[int, tuple[int, int, int]]:
    if not ids:
        return {}
    async with nueva_sesion() as s:
        filas = (await s.execute(text("select id, version_id, inicio, fin from fragmentos where id = any(:i)"), {"i": ids})).all()
    return {i: (v, a, b) for i, v, a, b in filas}


async def evaluar(indice: str | None, via: str, reranker: bool, banco: list[dict], k: int = 10) -> tuple[list[dict], float]:
    b = BuscadorHibrido()
    filas = []
    tiempos = []
    for p in banco:
        if p.get("origen") == "sin_respuesta" or not p.get("relevantes"):
            continue
        t0 = time.perf_counter()
        r = await b.buscar(p["pregunta"], k, Filtros(), Consulta(indice, via, 30, reranker))
        tiempos.append(time.perf_counter() - t0)
        ids = [x.fragmento_id for x in r.recuperados]
        rel = set(p["relevantes"])
        fila = {
            "id": p["id"], "origen": p.get("origen"),
            "recall@1": recall_en(ids, rel, 1), "recall@5": recall_en(ids, rel, 5), "recall@10": recall_en(ids, rel, 10),
            "mrr": rango_reciproco(ids, rel), "ndcg@10": ndcg_en(ids, rel, 10),
        }
        if p.get("pasaje"):
            iv = await intervalos(ids)
            fila["pasaje@5"] = pasaje_en([iv[i] for i in ids if i in iv], tuple(p["pasaje"]), 5)
        filas.append(fila)
    return filas, statistics.median(tiempos) if tiempos else 0.0


METRICAS = ["recall@1", "recall@5", "recall@10", "mrr", "ndcg@10", "pasaje@5"]


def resumen(filas: list[dict]) -> dict[str, tuple[float, float]]:
    return {m: media_y_error([f[m] for f in filas if m in f]) for m in METRICAS}


async def principal() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--indice")
    ap.add_argument("--via", default="hibrida", choices=["densa", "lexica", "hibrida"])
    ap.add_argument("--reranker", action="store_true")
    ap.add_argument("--banco", default=str(BANCO))
    ap.add_argument("--tabla", action="store_true")
    args = ap.parse_args()
    banco, h = cargar(Path(args.banco))
    (CARPETA / "resultados").mkdir(exist_ok=True)
    if not args.tabla:
        filas, ms = await evaluar(args.indice, args.via, args.reranker, banco)
        nombre = f"{args.indice or 'activa'}-{args.via}{'-rr' if args.reranker else ''}__{h}.csv"
        with (CARPETA / "resultados" / nombre).open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["id", "origen", *METRICAS])
            w.writeheader()
            w.writerows(filas)
        for m, (media, err) in resumen(filas).items():
            print(f"{m:<10} {media:.3f} ± {err:.3f}")
        print(f"{len(filas)} preguntas · latencia mediana {ms * 1000:.0f} ms · {nombre}")
        return
    casos = [("v1", "densa", False), ("v1", "lexica", False), ("v1", "hibrida", False), ("v1", "hibrida", True)]
    async with nueva_sesion() as s:
        if await s.scalar(text("select 1 from configuraciones where nombre = 'v2'")):
            casos.append(("v2", "hibrida", False))
    lineas = [f"# Resultados del retriever (banco {h})", "", "| Índice | Vía | Reranker | " + " | ".join(METRICAS) + " | Latencia |",
              "|---|---|---|" + "---|" * len(METRICAS) + "---|"]
    por_caso = {}
    for indice, via, rr in casos:
        filas, ms = await evaluar(indice, via, rr, banco)
        por_caso[(indice, via, rr)] = {f["id"]: f["recall@5"] for f in filas}
        celdas = " | ".join(f"{m:.2f} ± {e:.2f}" for m, e in resumen(filas).values())
        lineas.append(f"| {indice} | {via} | {'sí' if rr else 'no'} | {celdas} | {ms * 1000:.0f} ms |")
        print(lineas[-1], flush=True)
    d, lx = por_caso[("v1", "densa", False)], por_caso[("v1", "lexica", False)]
    solo_d = sum(1 for i in d if d[i] > 0 and lx.get(i, 0) == 0)
    solo_l = sum(1 for i in lx if lx[i] > 0 and d.get(i, 0) == 0)
    lineas += ["", f"Aciertan en recall@5 solo con la densa: {solo_d}; solo con la léxica: {solo_l}."]
    (CARPETA / "RESULTADOS.md").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    print(f"\nEscrito evals/RESULTADOS.md")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(principal())
