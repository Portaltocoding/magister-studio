"""Ejecuta todos los bancos de `evals/suite.yaml` y escribe un informe con la salida de cada uno.

    uv run python -m evals.suite [--solo plan,corrector] [--modelo extraer=cli:haiku]

El informe va a `evals/informes/informe-<fecha>.md`; compáralo con el anterior (`git diff`).
"""

import argparse
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo")
    ap.add_argument("--modelo", action="append", default=[], help="tarea=motor:modelo, para comparar modelos")
    a = ap.parse_args()
    bancos = yaml.safe_load((Path(__file__).parent / "suite.yaml").read_text(encoding="utf-8"))["bancos"]
    if a.solo:
        bancos = [b for b in bancos if b["nombre"] in a.solo.split(",")]
    entorno = {**os.environ, "PYTHONUTF8": "1"}
    for m in a.modelo:
        tarea, _, valor = m.partition("=")
        entorno[f"MAGISTER_MODELO_{tarea.upper()}"] = valor
    lineas = [f"# Informe de evals ({datetime.now():%Y-%m-%d %H:%M})", ""]
    fallos = 0
    for b in bancos:
        if b.get("requiere") and not (RAIZ / b["requiere"]).exists():
            lineas += [f"## {b['nombre']}", "", f"_Sin {b['requiere']}: no se ejecuta._", ""]
            continue
        print(f"== {b['nombre']}: {b['comando']}", flush=True)
        r = subprocess.run([sys.executable, *b["comando"].split()[1:]], cwd=RAIZ, env=entorno, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        fallos += r.returncode != 0
        salida = (r.stdout + r.stderr).strip().splitlines()[-40:]
        lineas += [f"## {b['nombre']} ({'bien' if r.returncode == 0 else f'código {r.returncode}'})", "", "```", *salida, "```", ""]
    destino = Path(__file__).parent / "informes" / f"informe-{datetime.now():%Y-%m-%d-%H%M}.md"
    destino.parent.mkdir(exist_ok=True)
    destino.write_text("\n".join(lineas), encoding="utf-8")
    print(f"Informe: {destino}")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
