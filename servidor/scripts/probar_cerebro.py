"""Prueba el cerebro suelto: `uv run python scripts/probar_cerebro.py "pregunta"`."""

import asyncio
import sys
import time

from magister.cerebro.modelo import Turno, generar
from magister.cerebro.prompts import cargar


async def principal(pregunta: str) -> None:
    t0 = time.perf_counter()
    primero = None
    n = 0
    async for trozo in generar(cargar("libre").texto, [Turno("usuario", pregunta)]):
        if primero is None:
            primero = time.perf_counter() - t0
        n += 1
        print(trozo, end="", flush=True)
    total = time.perf_counter() - t0
    print(f"\n\n{n} trozos · primero {primero or 0:.2f} s · total {total:.2f} s", flush=True)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(principal(" ".join(sys.argv[1:]) or "Qué es una clave primaria"))
