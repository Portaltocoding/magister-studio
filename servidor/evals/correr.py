"""Harness del planificador: pasa el banco por el grafo y mide.

    PYTHONUTF8=1 uv run python -m evals.correr --hoy 2026-11-09
    PYTHONUTF8=1 uv run python -m evals.correr --solo bd-basico-15h-mes

Corre el grafo con InMemorySaver (no toca la base: nunca acepta el plan), guarda una
línea por ejecución en evals/resultados/ e imprime la tasa por comprobación con su
margen al 95 % (sobre casos, no ejecuciones).
"""

import argparse
import asyncio
import hashlib
import json
import sys
import time
from collections import defaultdict
from datetime import date
from pathlib import Path

import yaml
from langgraph.checkpoint.memory import InMemorySaver

from evals import comprobaciones as c
from evals.estadistica import margen_wilson
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.flujo.comun import reglas_plan
from magister.flujo.grafo import construir_grafo
from magister.plan.calendario import Calendario, Sesion
from magister.plan.esquemas import Perfil, Plan

CARPETA = Path(__file__).parent
PLANTILLAS = ["diagnostico", "extraer_perfil", "planificar", "negociar"]


def cargar_banco(nombre: str = "plan-v1.yaml") -> tuple[list[dict], str]:
    crudo = (CARPETA / "banco" / nombre).read_bytes()
    casos = yaml.safe_load(crudo)
    for caso in casos:
        for campo in ("clave", "peticion", "espera"):
            if campo not in caso:
                raise ValueError(f"al caso {caso.get('clave')} le falta {campo}")
        if caso["espera"] not in ("cabe", "no_cabe", "pregunta"):
            raise ValueError(f"espera no válida en {caso['clave']}")
    return casos, hashlib.sha256(crudo).hexdigest()[:12]


async def correr_caso(caso: dict, hoy: date) -> dict:
    g = construir_grafo(InMemorySaver())
    config = {"configurable": {"thread_id": caso["clave"]}}
    entrada = {"conversacion_id": None, "fase": "diagnostico", "hoy": hoy.isoformat(),
               "mensaje": caso["peticion"], "turnos": [{"rol": "usuario", "contenido": caso["peticion"]}]}
    nodos: list[str] = []
    propuesta = None
    t0 = time.perf_counter()
    async for modo, datos in g.astream(entrada, config, stream_mode=["custom", "updates"]):
        if modo == "custom" and "fase" in datos:
            nodos.append(datos["fase"])
        elif modo == "updates" and "__interrupt__" in datos:
            propuesta = datos["__interrupt__"][0].value
    valores = (await g.aget_state(config)).values
    final = "cabe" if propuesta else ("no_cabe" if "negociar" in nodos else "pregunta" if "preguntar" in nodos else "fallo")
    return {"caso": caso["clave"], "nodos": nodos, "final": final, "valores": valores,
            "segundos": round(time.perf_counter() - t0, 1)}


def evaluar(caso: dict, ejecucion: dict, hoy: date) -> dict[str, c.Resultado]:
    v = ejecucion["valores"]
    perfil = Perfil.model_validate(v.get("perfil") or {})
    plan = Plan.model_validate(v["plan"]) if v.get("plan") else None
    cal = None
    if v.get("sesiones"):
        cal = Calendario([Sesion(date.fromisoformat(s["fecha"]), None, s["clave"], s["horas"]) for s in v["sesiones"]])
    r: dict[str, c.Resultado] = {"comportamiento": c.comportamiento(caso, ejecucion["final"])}
    r.update({f"perfil.{k}": x for k, x in c.perfil_exacto(caso, perfil, hoy).items()})
    if caso["espera"] == "cabe" and ejecucion["final"] == "cabe":
        reglas = reglas_plan()
        r["esquema"] = c.esquema(caso, perfil, plan, cal)
        r["capacidad"] = c.capacidad_con_holgura(caso, perfil, plan, cal, hoy, reglas)
        r["dependencias"] = c.dependencias_y_conceptos(caso, perfil, plan, cal)
        r["dias"] = c.dias_dentro_de_capacidad(caso, perfil, plan, cal)
        r["orden"] = c.orden_en_calendario(caso, perfil, plan, cal)
        r["verbos"] = c.verbos_observables(caso, perfil, plan, cal)
        r["horas_leccion"] = c.horas_por_leccion(caso, perfil, plan, cal, reglas)
    return r


async def principal() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hoy", default="2026-11-09")
    ap.add_argument("--repeticiones", type=int, default=1)
    ap.add_argument("--solo")
    args = ap.parse_args()
    hoy = date.fromisoformat(args.hoy)
    casos, version_banco = cargar_banco()
    if args.solo:
        casos = [x for x in casos if x["clave"] == args.solo]
    hashes = {n: cargar(n).version for n in PLANTILLAS}
    salida_dir = CARPETA / "resultados"
    salida_dir.mkdir(exist_ok=True)
    fichero = salida_dir / f"{date.today().isoformat()}-{hashlib.sha256(json.dumps(hashes).encode()).hexdigest()[:8]}.jsonl"
    por_comprobacion: dict[str, dict[str, list[bool]]] = defaultdict(lambda: defaultdict(list))
    por_estrato: dict[str, list[bool]] = defaultdict(list)
    with fichero.open("a", encoding="utf-8") as f:
        for caso in casos:
            for rep in range(args.repeticiones):
                ej = await correr_caso(caso, hoy)
                res = evaluar(caso, ej, hoy)
                for nombre, r in res.items():
                    por_comprobacion[nombre][caso["clave"]].append(r.ok)
                estrato = ",".join(f"{k}={v}" for k, v in sorted((caso.get("estrato") or {}).items()))
                por_estrato[estrato].append(all(r.ok for r in res.values()))
                fallos = {k: r.detalle for k, r in res.items() if not r.ok}
                print(f"{caso['clave']} #{rep + 1}: {ej['final']} en {ej['segundos']} s; fallos: {fallos or 'ninguno'}", flush=True)
                f.write(json.dumps({
                    "caso": caso["clave"], "repeticion": rep, "final": ej["final"], "nodos": ej["nodos"],
                    "perfil": ej["valores"].get("perfil"), "plan": ej["valores"].get("plan"),
                    "errores": ej["valores"].get("errores"), "intentos": ej["valores"].get("intentos"),
                    "resultados": {k: {"ok": r.ok, "detalle": r.detalle} for k, r in res.items()},
                    "segundos": ej["segundos"], "banco": version_banco, "plantillas": hashes,
                    "modelo": ajustes.modelo, "motor": ajustes.motor, "hoy": hoy.isoformat(),
                }, ensure_ascii=False) + "\n")
    print("\nComprobación          tasa   margen 95 %   casos")
    for nombre, por_caso in sorted(por_comprobacion.items()):
        # Un caso cuenta como acierto si acierta en la mayoría de sus repeticiones.
        aciertos = sum(1 for v in por_caso.values() if sum(v) * 2 > len(v))
        p, lo, hi = margen_wilson(aciertos, len(por_caso))
        print(f"{nombre:<22}{p:5.0%}   [{lo:4.0%}, {hi:4.0%}]   {len(por_caso)}")
    print("\nEstrato                                   todo bien")
    for estrato, oks in sorted(por_estrato.items()):
        print(f"{estrato:<42}{sum(oks)}/{len(oks)}")
    print(f"\nResultados en {fichero}")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(principal())
