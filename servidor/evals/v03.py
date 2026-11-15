"""Comprobar la v0.3 con una orden: pruebas, banco del retriever (si existe) y research con mocks.

    uv run python -m evals.v03

Sin red. Sale con código distinto de cero si algo falla, para usarlo antes de cada commit.
"""

import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


def correr(nombre: str, orden: list[str], entorno: dict | None = None) -> bool:
    print(f"\n== {nombre}: {' '.join(orden)}", flush=True)
    r = subprocess.run(orden, cwd=RAIZ, env={**os.environ, "PYTHONUTF8": "1", **(entorno or {})})
    print(f"== {nombre}: {'bien' if r.returncode == 0 else 'MAL'}", flush=True)
    return r.returncode == 0


def main() -> None:
    py = [sys.executable]
    resultados = [correr("pruebas", [*py, "-m", "pytest", "-q"])]
    if (RAIZ / "evals" / "banco_rag.jsonl").exists():
        resultados.append(correr("banco del retriever", [*py, "-m", "evals.banco_rag", "comprobar"]))
        resultados.append(correr("retriever", [*py, "-m", "evals.rag"]))
    else:
        print("\n(sin evals/banco_rag.jsonl: genera el banco con `python -m evals.banco_rag sintetico`)")
    resultados.append(correr("research con mocks", [*py, "-m", "evals.research", "--sistema", "fijo", "--repeticiones", "1"],
                             {"MAGISTER_MOTOR": "eco"}))
    print("\nResumen:", "todo bien" if all(resultados) else "hay fallos")
    sys.exit(0 if all(resultados) else 1)


if __name__ == "__main__":
    main()
