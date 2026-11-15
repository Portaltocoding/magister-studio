"""Fidelidad de las respuestas con un juez `claude -p` (en lugar de RAGAS).

    uv run python -m evals.fidelidad --n 20
    uv run python -m evals.fidelidad --comprobar      el ejemplo de Einstein: debe dar 0,5

Para cada respuesta: el juez parte la respuesta en afirmaciones y dice cuáles sostienen
los fragmentos que vio el generador (de la traza), no una búsqueda nueva. Se lee junto
al recall@5: fidelidad alta con recall bajo, arregla la recuperación; recall alto con
fidelidad baja, arregla el prompt.
"""

import argparse
import asyncio
import csv
import sys
from pathlib import Path

from pydantic import BaseModel, Field
from sqlalchemy import text

from magister.cerebro.estructura import estructurar
from magister.datos.sesion import nueva_sesion

SISTEMA = """Eres un juez estricto. Partes la RESPUESTA en afirmaciones simples y, para cada una, dices si el
CONTEXTO la sostiene (sí o no). Solo cuenta lo que dice el contexto, no lo que tú sabes."""

semaforo = asyncio.Semaphore(4)


class Afirmacion(BaseModel):
    afirmacion: str
    sostenida: bool


class Veredicto(BaseModel):
    afirmaciones: list[Afirmacion] = Field(min_length=1)


async def fidelidad(respuesta: str, contexto: str) -> tuple[float, list[Afirmacion]]:
    async with semaforo:
        v = await estructurar(SISTEMA, f"CONTEXTO:\n{contexto}\n\nRESPUESTA:\n{respuesta}", Veredicto)
    a = v.afirmaciones
    return sum(x.sostenida for x in a) / len(a), a


async def comprobar() -> None:
    contexto = "Albert Einstein (14 de marzo de 1879 - 18 de abril de 1955) fue un físico teórico alemán."
    respuesta = "Einstein nació en Alemania el 20 de marzo de 1879."
    f, a = await fidelidad(respuesta, contexto)
    for x in a:
        print(f"  {'sí' if x.sostenida else 'no'} · {x.afirmacion}")
    print(f"Fidelidad: {f:.2f} (esperado 0,5: dos afirmaciones, una sostenida)")


async def medir(n: int) -> None:
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select m.id, m.contenido, mc.busqueda_id from mensajes m "
            "join mensajes_citas mc on mc.mensaje_id = m.id where m.rol = 'tutor' and m.estado = 'completo' "
            "group by m.id, mc.busqueda_id order by m.id desc limit :n"
        ), {"n": n})).all()
        salida = []
        for mid, contenido, bid in filas:
            ids = (await s.execute(text("select jsonb_path_query_array(fusion, '$[*][0]') from busquedas where id = :b"), {"b": bid})).scalar()
            textos = (await s.execute(text("select id, texto from fragmentos where id = any(:i)"), {"i": list(ids or [])})).all()
            salida.append((mid, contenido, "\n\n".join(f"[{i}] {t}" for i, t in textos)))
    resultados = await asyncio.gather(*(fidelidad(r, c) for _, r, c in salida))
    ruta = Path(__file__).parent / "resultados" / "fidelidad.csv"
    ruta.parent.mkdir(exist_ok=True)
    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["mensaje_id", "fidelidad", "afirmaciones"])
        for (mid, _, _), (fid, a) in zip(salida, resultados, strict=True):
            w.writerow([mid, f"{fid:.2f}", len(a)])
    if resultados:
        print(f"Fidelidad media en {len(resultados)} respuestas: {sum(x for x, _ in resultados) / len(resultados):.2f} · {ruta}")
    else:
        print("No hay respuestas con citas todavía.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--comprobar", action="store_true")
    args = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(comprobar() if args.comprobar else medir(args.n))


if __name__ == "__main__":
    main()
