"""Mide cuánto del prompt de los jueces se lee de caché. Llama a `claude`: solo a mano.

    uv run python -m evals.cache_jueces tono 11/b1 10/b4 ...            un juicio por bloque, en serie
    uv run python -m evals.cache_jueces completitud 10/b4:BFS 10/b4:DFS  un juicio por concepto

Las llamadas van en serie a propósito: la caché de prompts solo sirve el prefijo cuando la primera
escritura ya ha terminado. Los tokens salen de los registros de `estructurar` (entrada, escritura y
lectura de caché); el porcentaje es lectura / (entrada + escritura + lectura), como en la tabla `llamadas`.
"""

import asyncio
import logging
import re
import sys

from sqlalchemy import text

from magister.datos.sesion import nueva_sesion
from magister.material import completitud
from magister.tono import juez

PATRON = re.compile(r"in=(\S+) out=(\S+) cache_w=(\S+) cache_r=(\S+)")


class Recoger(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.filas: list[tuple[int, int, int, int]] = []

    def emit(self, record: logging.LogRecord) -> None:
        m = PATRON.search(record.getMessage())
        if m:
            self.filas.append(tuple(int(x) if x != "None" else 0 for x in m.groups()))  # type: ignore[arg-type]


async def bloque(clave: str) -> str:
    material, b = clave.split("/")
    async with nueva_sesion() as s:
        return (await s.execute(text("select texto from bloques_material where material_id = :m and clave = :b"),
                                {"m": int(material), "b": b})).scalar_one()


def mostrar(n: int, etiqueta: str, fila: tuple[int, int, int, int]) -> None:
    entrada, salida, escritura, lectura = fila
    total = entrada + escritura + lectura
    print(f"{n:>2} {etiqueta:<22} entrada={entrada:<5} escritura={escritura:<6} lectura={lectura:<6} salida={salida:<5} "
          f"lectura/total={lectura / total:.0%}" if total else f"{n:>2} {etiqueta} sin datos")


async def principal(modo: str, objetivos: list[str]) -> None:
    recoger = Recoger()
    logging.getLogger("magister.estructura").addHandler(recoger)
    logging.getLogger("magister.estructura").setLevel(logging.INFO)
    for n, objetivo in enumerate(objetivos, 1):
        antes = len(recoger.filas)
        if modo == "tono":
            r = await juez.juzgar(await bloque(objetivo))
            resumen = r.motivo if isinstance(r, juez.FalloJuez) else " ".join(
                f"{d}={'A' if getattr(r.veredicto, d).aprueba else 'S'}" for d in juez.DIMENSIONES)
        else:
            clave, nombre = objetivo.split(":")
            r = await completitud._juzgar(await bloque(clave), {"nombre": nombre, "sinonimos": []})
            resumen = str(r.get("explicado") if "fallo_juez" not in r else r["fallo_juez"])
        if len(recoger.filas) > antes:
            mostrar(n, objetivo, recoger.filas[-1])
        print("   ->", resumen)
    todas = recoger.filas
    if len(todas) > 1:
        resto = todas[1:]
        total = sum(e + w + r for e, _, w, r in resto)
        print(f"Desde la segunda llamada: lectura/total = {sum(r for *_, r in resto) / total:.0%} ({len(resto)} llamadas)")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(principal(sys.argv[1], sys.argv[2:]))
