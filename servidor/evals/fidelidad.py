"""Fidelidad de las respuestas con un juez `claude -p` (en lugar de RAGAS).

    uv run python -m evals.fidelidad                    corto: las 5 últimas respuestas con citas (tope 8 llamadas)
    uv run python -m evals.fidelidad --nivel completo   las 20 últimas (tope 40)
    uv run python -m evals.fidelidad --n 50 --max-llamadas 80
    uv run python -m evals.fidelidad --comprobar        el ejemplo de Einstein: debe dar 0,5 (1 llamada)

Una llamada por respuesta (más los reintentos de una salida que no valida, que también cuentan para el tope). Lee la
base (solo SELECT) y guarda la ejecución para `evals.regresion` (el juez va en este fichero: su versión es la de SISTEMA).

Para cada respuesta: el juez parte la respuesta en afirmaciones y dice cuáles sostienen
los fragmentos que vio el generador (de la traza), no una búsqueda nueva. Se lee junto
al recall@5: fidelidad alta con recall bajo, arregla la recuperación; recall alto con
fidelidad baja, arregla el prompt.
"""

import argparse
import asyncio
import csv
import hashlib
import sys
from pathlib import Path

from pydantic import BaseModel, Field
from sqlalchemy import text

from evals import regresion, tope
from magister.cerebro.estructura import estructurar
from magister.datos.sesion import nueva_sesion

N_NIVEL = {"corto": 5, "completo": 20}

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


async def medir(n: int, t: tope.Tope | None = None) -> None:
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
    # Con return_exceptions, una respuesta cortada por el tope (o con un juez que no valida) no tira las demás.
    crudos = await asyncio.gather(*(fidelidad(r, c) for _, r, c in salida), return_exceptions=True)
    hechas = [(s, r) for s, r in zip(salida, crudos, strict=True) if not isinstance(r, BaseException)]
    if t is not None and any(isinstance(r, tope.TopeAlcanzado) for r in crudos):
        t.cortado = True
    sin_juez = sum(1 for r in crudos if isinstance(r, Exception))
    ruta = Path(__file__).parent / "resultados" / "fidelidad.csv"
    ruta.parent.mkdir(exist_ok=True)
    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["mensaje_id", "fidelidad", "afirmaciones"])
        for (mid, _, _), (fid, a) in hechas:
            w.writerow([mid, f"{fid:.2f}", len(a)])
    if hechas:
        print(f"Fidelidad media en {len(hechas)} respuestas: {sum(x for _, (x, _) in hechas) / len(hechas):.2f} · {ruta}"
              + (f" · {sin_juez} sin veredicto válido (no cuentan)" if sin_juez else ""))
        if t is not None:
            ej = regresion.ejecucion("fidelidad", t.nivel, {"fidelidad_sistema": hashlib.sha256(SISTEMA.encode()).hexdigest()[:12]},
                                     {"fidelidad": regresion.media({str(mid): fid for (mid, _, _), (fid, _) in hechas})}, t)
            print(f"Guardada para comparar: {regresion.guardar(ej)}")
    else:
        print("No hay respuestas con citas todavía.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=None, help="cuántas respuestas (por defecto, 5 en corto y 20 en completo)")
    ap.add_argument("--comprobar", action="store_true")
    tope.argumentos(ap, corto=8, completo=40)
    args = ap.parse_args()
    t = tope.de_args(args)
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    with tope.contar(t):
        try:
            asyncio.run(comprobar() if args.comprobar else medir(args.n or N_NIVEL[args.nivel], t))
        except tope.TopeAlcanzado:
            print("Cortado al llegar al tope.")
    print(t.resumen())


if __name__ == "__main__":
    main()
