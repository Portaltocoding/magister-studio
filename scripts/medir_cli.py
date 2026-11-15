"""Mide los tiempos de `claude -p` en streaming: init, primer trozo y resultado."""

import argparse
import json
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time

PREGUNTA = "Explica en dos frases qué es una clave foránea en una base de datos."
TIMEOUT_S = 180


def lanzar(ejecutable: str, modelo: str, carpeta: str) -> dict[str, float | None]:
    orden = [
        ejecutable,
        "-p",
        "--model", modelo,
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools", "",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--no-session-persistence",
    ]
    tiempos: dict[str, float | None] = {"init": None, "primer_trozo": None, "result": None}
    inicio = time.perf_counter()
    proceso = subprocess.Popen(
        orden,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        cwd=carpeta,
    )
    temporizador = threading.Timer(TIMEOUT_S, proceso.kill)
    temporizador.start()
    try:
        proceso.stdin.write(PREGUNTA)
        proceso.stdin.close()
        for linea in proceso.stdout:
            ahora = time.perf_counter() - inicio
            try:
                evento = json.loads(linea)
            except json.JSONDecodeError:
                continue
            tipo = evento.get("type")
            if tipo == "system" and evento.get("subtype") == "init":
                if tiempos["init"] is None:
                    tiempos["init"] = ahora
            elif tipo == "stream_event":
                if (
                    tiempos["primer_trozo"] is None
                    and evento.get("event", {}).get("type") == "content_block_delta"
                ):
                    tiempos["primer_trozo"] = ahora
            elif tipo == "result":
                tiempos["result"] = ahora
                break
    finally:
        temporizador.cancel()
        proceso.kill()
        proceso.wait()
    return tiempos


def formatear(valor: float | None) -> str:
    return "—" if valor is None else f"{valor:6.2f} s"


def main() -> int:
    analizador = argparse.ArgumentParser(description=__doc__)
    analizador.add_argument("ejecuciones", type=int, help="número de ejecuciones (N)")
    analizador.add_argument("modelo", help="modelo, por ejemplo sonnet")
    argumentos = analizador.parse_args()
    if argumentos.ejecuciones < 1:
        analizador.error("el número de ejecuciones debe ser al menos 1")

    ejecutable = shutil.which("claude")
    if ejecutable is None:
        print("No se encuentra `claude` en el PATH.", file=sys.stderr)
        return 1

    resultados = []
    with tempfile.TemporaryDirectory() as carpeta:
        for numero in range(1, argumentos.ejecuciones + 1):
            tiempos = lanzar(ejecutable, argumentos.modelo, carpeta)
            resultados.append(tiempos)
            print(
                f"{numero:>3}  init {formatear(tiempos['init'])}  "
                f"primer trozo {formatear(tiempos['primer_trozo'])}  "
                f"result {formatear(tiempos['result'])}"
            )

    medianas = {}
    for clave in ("init", "primer_trozo", "result"):
        valores = [r[clave] for r in resultados if r[clave] is not None]
        medianas[clave] = statistics.median(valores) if valores else None
    print(
        f"med  init {formatear(medianas['init'])}  "
        f"primer trozo {formatear(medianas['primer_trozo'])}  "
        f"result {formatear(medianas['result'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
