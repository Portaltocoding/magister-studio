"""¿Sabe el planificador cuándo hace falta buscar fuentes? (ADR-0021)

Un juego fijo de lecciones etiquetadas a mano (`evals/banco/cuando-research-v1.yaml`): el modelo real decide, con los
mismos criterios que al planificar (`comun/fuentes_leccion.md`, por la plantilla `cuando_research`), si cada una
necesita fuentes. Es el juicio barato con el que el research automático etiqueta una lección antes de buscar
(`research/necesidad.py`): el modelo es el de `prompts.cuando_research` en `config/modelos.yaml`. El código cuenta aciertos y, aparte, los fallos caros: «no» donde se esperaba «imprescindible»
(no buscar cuando hacía falta). Toda la estadística sale de `evals/estadistica.py`, nunca del modelo.

Llama a `claude` (gasta cuota): se lanza solo a mano y solo con --gastar. Sin él, dice cuántas llamadas haría.

    uv run python -m evals.cuando_research                                    # cuántas llamadas haría (no gasta nada)
    uv run python -m evals.cuando_research --gastar                           # corto: 9 lecciones, 1 llamada (tope 3)
    uv run python -m evals.cuando_research --gastar --nivel completo          # 30 lecciones, 3 llamadas (tope 9)

Cada reintento de una salida que no vale es otra llamada: el tope (`--max-llamadas`) los cuenta. Al acabar se guarda la
ejecución para `evals.regresion` con la versión de `cuando_research`.
"""

import argparse
import asyncio
import math
import sys
from pathlib import Path

import yaml

from evals import regresion, tope
from evals.estadistica import kappa, margen_wilson, tabla_de
from magister.plan.esquemas import NECESIDADES
# La misma entrada y el mismo esquema que el juicio barato del research automático (research/necesidad.py).
from magister.research.necesidad import LOTE, EtiquetaLeccion, Etiquetas, entrada_de, reglas_de  # noqa: F401

BANCO = Path(__file__).parent / "banco" / "cuando-research-v1.yaml"
# El nivel corto: 3 lecciones de cada etiqueta (las más claras y una dudosa por etiqueta), en una sola llamada.
CORTO = ["dividir-decimales", "bucle-for", "tabla-multiplicar",
         "derivadas", "indices-sql", "recursividad",
         "ultima-version-react", "irpf-tramos", "usucapion"]
TOPES = {"corto": 3, "completo": 9}  # cada lote, 1 llamada y hasta 2 reintentos


def cargar_banco(ruta: Path = BANCO) -> list[dict]:
    with open(ruta, encoding="utf-8") as f:
        casos = yaml.safe_load(f)
    for c in casos:
        if c.get("espera") not in NECESIDADES:
            raise ValueError(f"{c.get('id')}: la etiqueta esperada tiene que ser no, conviene o imprescindible")
    return casos


def lotes(casos: list, tamano: int = LOTE) -> list[list]:
    return [casos[i:i + tamano] for i in range(0, len(casos), max(1, tamano))]


def llamadas_previstas(n_casos: int, tamano: int = LOTE) -> int:
    return math.ceil(n_casos / max(1, tamano)) if n_casos else 0


def recuento(casos: list[dict], predichas: dict[str, str | None]) -> dict:
    """Aciertos (con su intervalo de Wilson), fallos caros, la tabla esperada × dicha y la kappa. Una lección sin
    respuesta cuenta como fallo, nunca como caro."""
    n = len(casos)
    aciertos = sum(1 for c in casos if predichas.get(c["id"]) == c["espera"])
    p, lo, hi = margen_wilson(aciertos, n)
    caros = [c["id"] for c in casos if c["espera"] == "imprescindible" and predichas.get(c["id"]) == "no"]
    respondidas = [c for c in casos if predichas.get(c["id"]) in NECESIDADES]
    tabla = tabla_de([c["espera"] for c in respondidas], [predichas[c["id"]] for c in respondidas], NECESIDADES)
    de_mas = [c["id"] for c in casos if c["espera"] == "no" and predichas.get(c["id"]) == "imprescindible"]
    return {
        "n": n, "aciertos": aciertos, "tasa": p, "ic": (lo, hi),
        "caros": caros, "de_mas": de_mas,
        "sin_respuesta": [c["id"] for c in casos if predichas.get(c["id"]) not in NECESIDADES],
        "tabla": tabla, "kappa": kappa(tabla) if respondidas else 0.0,
        "fallos": [(c["id"], c["espera"], predichas.get(c["id"])) for c in casos if predichas.get(c["id"]) != c["espera"]],
    }


async def etiquetar(casos: list[dict], tamano: int = LOTE, t: tope.Tope | None = None) -> dict[str, str | None]:
    """Con `t`, no empieza un lote si no cabe ni su primera llamada, y un lote cortado por el tope deja sus lecciones
    sin respuesta (fuera del recuento, ver `recuento(solo_respondidas=...)`)."""
    from magister.cerebro.estructura import ErrorEstructura, estructurar
    from magister.cerebro.prompts import cargar

    predichas: dict[str, str | None] = {}
    for lote in lotes(casos, tamano):
        if t is not None and not t.cabe(1):
            t.cortado = True
            break
        sistema = cargar("cuando_research").texto
        try:
            # Sin `tarea`: el modelo lo pone config/modelos.yaml (prompts.cuando_research), el mismo que en producción.
            salida = await estructurar(sistema, entrada_de(lote), Etiquetas, reglas_de(len(lote)))
        except tope.TopeAlcanzado:
            break
        except ErrorEstructura as e:
            print(f"  un lote no dio salida válida: {e}")
            predichas.update({c["id"]: None for c in lote})
            continue
        por_numero = {e.n: e.necesita_fuentes for e in salida.etiquetas}
        predichas.update({c["id"]: por_numero.get(i) for i, c in enumerate(lote, start=1)})
    return predichas


def informe(r: dict, version: str) -> str:
    lo, hi = r["ic"]
    filas = "\n".join(
        f"  {esperada:<15} " + " ".join(f"{x:>5}" for x in fila) for esperada, fila in zip(NECESIDADES, r["tabla"])
    )
    fallos = "\n".join(f"  {i}: se esperaba {e}, dijo {d}" for i, e, d in r["fallos"]) or "  ninguno"
    return (
        f"cuando_research@{version} · {r['n']} lecciones\n"
        f"Aciertos: {r['aciertos']}/{r['n']} ({r['tasa']:.0%}, IC 95 % {lo:.0%}-{hi:.0%}) · kappa {r['kappa']:.2f}\n"
        f"Fallos caros («no» donde hacía falta buscar): {len(r['caros'])} {r['caros'] or ''}\n"
        f"«imprescindible» donde bastaba «no»: {len(r['de_mas'])} {r['de_mas'] or ''}\n"
        f"Sin respuesta: {len(r['sin_respuesta'])}\n"
        f"Esperada (filas) × dicha (columnas: no, conviene, imprescindible):\n{filas}\n"
        f"Fallos:\n{fallos}"
    )


def metricas(casos: list[dict], predichas: dict[str, str | None]) -> dict:
    """Para `evals.regresion`: acierto por lección y, en las de «imprescindible», si fue un fallo caro."""
    return {
        "aciertos": regresion.proporcion({c["id"]: (int(predichas.get(c["id"]) == c["espera"]), 1) for c in casos}),
        "fallos_caros": regresion.proporcion({c["id"]: (int(predichas.get(c["id"]) == "no"), 1) for c in casos
                                              if c["espera"] == "imprescindible"}, mejor="bajo"),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--gastar", action="store_true", help="lanzarla de verdad con el modelo (gasta cuota)")
    ap.add_argument("--lote", type=int, default=LOTE, help="lecciones por llamada")
    ap.add_argument("--banco", type=Path, default=BANCO)
    tope.argumentos(ap, **TOPES)
    args = ap.parse_args(argv)
    from magister.cerebro.enrutador import tarea_de_prompt

    casos = cargar_banco(args.banco)
    casos = tope.del_nivel(casos, args.nivel, CORTO if args.banco == BANCO else LOTE)
    t = tope.de_args(args)
    n = llamadas_previstas(len(casos), args.lote)
    print(f"Nivel {args.nivel}: {len(casos)} lecciones de {args.banco.name}, de {args.lote} en {args.lote}: {n} llamadas al "
          f"modelo (tarea {tarea_de_prompt('cuando_research')}), más algún reintento si una salida no vale. Tope duro: {t.maximo}.")
    if not args.gastar:
        print("No lanzo nada. Para gastarlas, añade --gastar.")
        return 2
    from magister.cerebro.prompts import cargar

    with tope.contar(t):
        predichas = asyncio.run(etiquetar(casos, args.lote, t))
    hechos = [c for c in casos if c["id"] in predichas]
    if hechos:
        print(informe(recuento(hechos, predichas), cargar("cuando_research").version))
        ej = regresion.ejecucion("cuando_research", args.nivel, regresion.versiones(["cuando_research"]),
                                 metricas(hechos, predichas), t, regresion.huella(args.banco))
        print(f"Guardada para comparar: {regresion.guardar(ej)}")
    print(t.resumen())
    return 0


if __name__ == "__main__":
    sys.exit(main())
