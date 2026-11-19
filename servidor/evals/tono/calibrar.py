"""Calibrar el juez de tono contra tus etiquetas.

    uv run python -m evals.tono.calibrar --particion alinear|validar       corto: 6 bloques, tope 12 llamadas
    uv run python -m evals.tono.calibrar --particion validar --nivel completo   toda la partición, tope 200
    uv run python -m evals.tono.calibrar --techo          kappa entre tu ronda 1 y tu ronda 2 (sin modelo)

Por dimensión: tabla 2x2, kappa con IC por bootstrap, y recall y precisión de los suspensos.
Se niega a correr sobre la reserva. El informe se guarda con el SHA-256 del juez y de la rúbrica.
"""

import argparse

from evals import tope
from evals.estadistica import bootstrap_ic, kappa, tabla_de
from evals.tono.comun import bloques_de, etiquetas, guardar
from magister.cerebro.prompts import cargar
from magister.tono.juez import DIMENSIONES, FalloJuez, juzgar, rubrica

BLOQUES_CORTO = 6


def informe(pares: list[tuple[bool, bool]], nombre: str) -> dict:
    """pares: (tú, juez). Positivo = suspende."""
    if not pares:
        return {"dimension": nombre, "n": 0}
    tu = [not a for a, _ in pares]
    juez = [not b for _, b in pares]
    t = tabla_de(tu, juez, [True, False])
    k = kappa(t)
    lo, hi = bootstrap_ic(list(zip(tu, juez, strict=True)), lambda xs: kappa(tabla_de([a for a, _ in xs], [b for _, b in xs], [True, False])), 2000)
    vp = t[0][0]
    recall = vp / (t[0][0] + t[0][1]) if t[0][0] + t[0][1] else float("nan")
    precision = vp / (t[0][0] + t[1][0]) if t[0][0] + t[1][0] else float("nan")
    return {"dimension": nombre, "n": len(pares), "tabla_suspende_si_no": t, "kappa": round(k, 3), "ic": [round(lo, 3), round(hi, 3)],
            "recall_suspensos": round(recall, 3), "precision_suspensos": round(precision, 3)}


async def principal(args) -> None:
    if args.techo:
        r1, r2 = await etiquetas(1), await etiquetas(2)
        for d in DIMENSIONES:
            pares = [(r1[k], v) for k, v in r2.items() if k[2] == d and k in r1]
            print(informe(pares, d))
        return
    bloques = tope.del_nivel(await bloques_de(args.particion), args.nivel, BLOQUES_CORTO)
    mias = await etiquetas(1)
    juicios = await tope.a_la_vez(args.tope, (juzgar(b["texto"]) for b in bloques))
    filas, fallos = [], 0
    pares: dict[str, list[tuple[bool, bool]]] = {d: [] for d in DIMENSIONES}
    for b, j in zip(bloques, juicios, strict=True):
        if j is None:  # cortado por el tope: ni fallo ni veredicto
            continue
        if isinstance(j, FalloJuez):
            fallos += 1
            continue
        for d in DIMENSIONES:
            clave = (b["material_id"], b["clave"], d)
            if clave in mias:
                pares[d].append((mias[clave], getattr(j.veredicto, d).aprueba))
        filas.append({"bloque": [b["material_id"], b["clave"]], "veredicto": j.veredicto.model_dump()})
    informes = [informe(pares[d], d) for d in DIMENSIONES]
    for x in informes:
        print(x)
    print(f"Fallos del juez: {fallos} de {len(bloques)}")
    ruta = guardar(f"calibrar-{args.particion}-{cargar('juez_tono').version}-{rubrica()[1]}", [*informes, *filas])
    print(f"Informe: {ruta}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--particion", default="validar", choices=["alinear", "validar", "reserva"])
    ap.add_argument("--techo", action="store_true")
    # Un juicio por bloque (con un reintento: 2 llamadas como mucho). Corto: los 6 primeros de la partición.
    tope.argumentos(ap, corto=12, completo=200)
    args = ap.parse_args()
    args.tope = tope.de_args(args)
    tope.correr(principal(args), args.tope)
