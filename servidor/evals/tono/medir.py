"""Medir el lint y el juez.

    uv run python -m evals.tono.medir lint --carpeta ../salidas          CSV para marcar a mano (columna `real`)
    uv run python -m evals.tono.medir lint --leer resultados/lint.csv    precisión por regla (un veto < 0,9 baja a aviso)
    uv run python -m evals.tono.medir variacion --n 10                   cuántos bloques cambian de veredicto en 3 juicios
    uv run python -m evals.tono.medir sesgos --n 10                      verbosidad y posición, en modo pairwise
"""

import argparse
import asyncio
import csv
import sys
from pathlib import Path

from pydantic import BaseModel

from evals.estadistica import binomial_cola, ic_proporcion
from evals.tono.comun import RESULTADOS, bloques_de
from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.tono.juez import DIMENSIONES, FalloJuez, juzgar
from magister.tono.lint import revisar

RELLENO = (" Como hemos visto, esto es importante. En resumen, conviene tenerlo presente, porque, como se ha dicho, "
           "lo anterior resume la idea principal de este apartado.")


class Preferencia(BaseModel):
    razon: str
    mejor: str  # "A" o "B"


async def lint_csv(carpeta: str) -> None:
    RESULTADOS.mkdir(exist_ok=True)
    ruta = RESULTADOS / "lint.csv"
    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["apuntes", "regla", "gravedad", "fragmento", "real"])
        for md in sorted(Path(carpeta).rglob("apuntes.md")):
            for h in revisar(md.read_text(encoding="utf-8")):
                w.writerow([md.parent.name, h.regla, h.gravedad, h.cita, ""])
    print(f"Marca la columna «real» con 1 o 0 en {ruta}")


def lint_precision(ruta: str) -> None:
    por_regla: dict[str, list[int]] = {}
    with open(ruta, encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            if fila["real"].strip() in ("0", "1"):
                por_regla.setdefault(fila["regla"], []).append(int(fila["real"]))
    for regla, v in sorted(por_regla.items()):
        lo, hi = ic_proporcion(sum(v), len(v))
        print(f"{regla:<18} marcas {len(v):>3} · verdaderas {sum(v):>3} · precisión {sum(v) / len(v):.2f} [{lo:.2f}, {hi:.2f}]")


async def variacion(n: int) -> None:
    bloques = (await bloques_de("alinear"))[:n]
    cambian = 0
    for b in bloques:
        juicios = [j for j in await asyncio.gather(*(juzgar(b["texto"]) for _ in range(3))) if not isinstance(j, FalloJuez)]
        vistos = {tuple(getattr(j.veredicto, d).aprueba for d in DIMENSIONES) for j in juicios}
        cambian += len(vistos) > 1
    print(f"Cambian de veredicto {cambian} de {len(bloques)} bloques")


async def pairwise(a: str, b: str) -> str | None:
    try:
        r = await estructurar("Eres un juez de tono. Di cuál de los dos textos es mejor material de estudio (razonamiento, "
                              "economía y trato), con la razón primero.", f"<A>\n{a}\n</A>\n\n<B>\n{b}\n</B>", Preferencia)
    except ErrorEstructura:
        return None
    return r.mejor.strip().upper()[:1]


async def sesgos(n: int) -> None:
    bloques = (await bloques_de("alinear"))[:n]
    larga, posicion_estable, total = 0, 0, 0
    for b in bloques:
        corto, largo = b["texto"], b["texto"] + RELLENO
        r1 = await pairwise(corto, largo)
        r2 = await pairwise(largo, corto)
        if r1 is None or r2 is None:
            continue
        total += 1
        larga += (r1 == "B") + (r2 == "A")
        posicion_estable += (r1 == "A") == (r2 == "B")
    if total:
        lo, hi = ic_proporcion(larga, 2 * total)
        print(f"Verbosidad: elige la larga {larga} de {2 * total} ({larga / (2 * total):.0%}, IC [{lo:.0%}, {hi:.0%}]), "
              f"cola binomial p={binomial_cola(larga, 2 * total):.3f}")
        print(f"Posición: mantiene el veredicto al cambiar el orden en {posicion_estable} de {total}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("modo", choices=["lint", "variacion", "sesgos"])
    ap.add_argument("--carpeta", default="../salidas")
    ap.add_argument("--leer")
    ap.add_argument("--n", type=int, default=10)
    args = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    if args.modo == "lint":
        lint_precision(args.leer) if args.leer else asyncio.run(lint_csv(args.carpeta))
    elif args.modo == "variacion":
        asyncio.run(variacion(args.n))
    else:
        asyncio.run(sesgos(args.n))


if __name__ == "__main__":
    main()
