"""Cómo explica el tutor en cada área de conocimiento: saca sus respuestas reales a preguntas de alumno.

Lee un JSON con preguntas ([{"id": "est-1", "pregunta": "..."}]), responde cada una con el prompt de la charla
(`conversar`, que incluye el núcleo de cómo explica Magister) para un alumno nuevo, sin plan ni preferencias, y
escribe las respuestas con la versión del prompt que las produjo. Juzgarlas es cosa de quien lo lanza.

Llama a `claude` (gasta cuota): se lanza solo a mano.

    uv run python -m evals.areas preguntas.json respuestas.json [--a-la-vez 3] [--perfil derecho]

Con `--perfil` (o un campo `perfil` en cada pregunta) la respuesta lleva el perfil de explicación de esa materia
(`cerebro/prompts/comun/materias/<perfil>.md`), como si el tema ya lo tuviera; sin él, el alumno nuevo de siempre.
"""

import argparse
import asyncio
import json
import time
from pathlib import Path

from magister.cerebro import materias
from magister.cerebro.modelo import Turno, generar
from magister.cerebro.prompts import cargar
from magister.flujo.comun import sistema_de_estudio


async def responder(pregunta: str, perfil: str | None = None) -> tuple[str, float]:
    plantilla = cargar("conversar")
    sistema = await sistema_de_estudio(plantilla.texto, {})
    if perfil:
        sistema += "\n\n" + materias.texto(perfil)
    inicio = time.perf_counter()
    texto = "".join([t async for t in generar(sistema, [Turno("usuario", pregunta)])])
    return texto, time.perf_counter() - inicio


async def principal(entrada: Path, salida: Path, a_la_vez: int, perfil: str | None = None) -> None:
    preguntas = json.loads(entrada.read_text(encoding="utf-8"))
    version = cargar("conversar").etiqueta
    limite = asyncio.Semaphore(a_la_vez)

    async def una(p: dict) -> dict:
        async with limite:
            try:
                este = p.get("perfil") or perfil
                texto, segundos = await responder(p["pregunta"], este)
                return {**p, "respuesta": texto, "segundos": round(segundos, 1), "prompt": version, "perfil": materias.version(este)}
            except Exception as e:  # noqa: BLE001  (una pregunta que falla no tumba las demás)
                return {**p, "respuesta": None, "error": f"{type(e).__name__}: {e}", "prompt": version}

    resultados = await asyncio.gather(*(una(p) for p in preguntas))
    salida.write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding="utf-8")
    fallos = sum(1 for r in resultados if r.get("respuesta") is None)
    print(f"{len(resultados)} respuestas en {salida} ({fallos} fallos) con {version}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("entrada", type=Path)
    ap.add_argument("salida", type=Path)
    ap.add_argument("--a-la-vez", type=int, default=3)
    ap.add_argument("--perfil", choices=materias.PERFILES, default=None, help="perfil de explicación para todas las preguntas")
    a = ap.parse_args()
    asyncio.run(principal(a.entrada, a.salida, a.a_la_vez, a.perfil))


if __name__ == "__main__":
    main()
