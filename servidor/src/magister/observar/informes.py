"""Informes sobre `llamadas` y `puntuaciones`.

    uv run python -m magister.observar.informes aprobados --semanas 4
    uv run python -m magister.observar.informes prefijos --dias 7
    uv run python -m magister.observar.informes coste --semanas 4 --vatios 20 --kwh 0.15 --horas-dia 3 --mantenimiento 4
"""

import argparse
import asyncio
import sys

from sqlalchemy import text

from magister.datos.sesion import nueva_sesion

ROJO, FIN = "\033[31m", "\033[0m"


def intervalo(k: int, n: int) -> tuple[float, float]:
    from evals.estadistica import intervalo_proporcion

    return intervalo_proporcion(k, n)


async def aprobados(semanas: int) -> None:
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select date_trunc('week', creada)::date, nombre, count(*), sum(valor) from puntuaciones "
            "where nombre in ('tono_juez', 'feedback_usuario', 'lint_tono') and creada > now() - make_interval(weeks => :n) "
            "group by 1, 2 order by 1, 2"), {"n": semanas})).all()
    for semana, nombre, n, k in filas:
        lo, hi = intervalo(int(k), n)
        print(f"{semana}  {nombre:<17} {int(k)}/{n} = {k / n:.0%}  IC 95 % [{lo:.0%}, {hi:.0%}]")


async def prefijos(dias: int) -> None:
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select funcion, percentile_cont(0.5) within group (order by t), max(t), "
            "sum(tokens_cache_lectura)::float / nullif(sum(t), 0) from ("
            " select funcion, tokens_cache_lectura, tokens_entrada + tokens_cache_lectura + tokens_cache_escritura as t from llamadas"
            " where creada > now() - make_interval(days => :d)) x group by funcion order by 2 desc"), {"d": dias})).all()
    for funcion, mediana, maximo, cache in filas:
        marca = ROJO if mediana and mediana > 20000 else ""
        print(f"{marca}{funcion:<18} mediana {int(mediana or 0):>7} · máx {int(maximo or 0):>7} · caché {cache or 0:.0%}{FIN if marca else ''}")


async def coste(semanas: int, vatios: float, kwh: float, horas_dia: float, mantenimiento: float) -> None:
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select funcion, count(*), sum(tokens_entrada + tokens_cache_lectura + tokens_cache_escritura), sum(tokens_salida), "
            "sum(coste_equivalente) from llamadas where creada > now() - make_interval(weeks => :n) group by 1 order by 5 desc"),
            {"n": semanas})).all()
    factor = 52 / semanas
    total = 0.0
    print(f"Extrapolado a 12 meses desde {semanas} semanas:")
    for funcion, n, te, ts, c in filas:
        total += (c or 0) * factor
        print(f"  {funcion:<18} {int(n * factor):>7} llamadas · {int((te or 0) * factor):>11} tokens de entrada · "
              f"{int((ts or 0) * factor):>9} de salida · {(c or 0) * factor:8.2f} USD equivalentes")
    maquina = vatios / 1000 * horas_dia * 365 * kwh
    print(f"\nModelo (equivalente en API): {total:.2f} USD · máquina: {maquina:.2f} EUR · mantenimiento: {mantenimiento * 12:.0f} h")
    print(f"Escenarios: tu uso {total:.0f} USD · el doble {2 * total:.0f} USD · 1.000 usuarios en API {1000 * total:,.0f} USD")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("informe", choices=["aprobados", "prefijos", "coste"])
    ap.add_argument("--semanas", type=int, default=4)
    ap.add_argument("--dias", type=int, default=7)
    ap.add_argument("--vatios", type=float, default=20)
    ap.add_argument("--kwh", type=float, default=0.15)
    ap.add_argument("--horas-dia", type=float, default=3)
    ap.add_argument("--mantenimiento", type=float, default=4)
    a = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    if a.informe == "aprobados":
        asyncio.run(aprobados(a.semanas))
    elif a.informe == "prefijos":
        asyncio.run(prefijos(a.dias))
    else:
        asyncio.run(coste(a.semanas, a.vatios, a.kwh, a.horas_dia, a.mantenimiento))


if __name__ == "__main__":
    main()
