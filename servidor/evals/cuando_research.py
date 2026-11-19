"""¿Sabe el planificador cuándo hace falta buscar fuentes? (ADR-0021)

Un juego fijo de lecciones etiquetadas a mano (`evals/banco/cuando-research-v1.yaml`): el modelo real decide, con los
mismos criterios que al planificar (`comun/fuentes_leccion.md`, por la plantilla `cuando_research`), si cada una
necesita fuentes. El código cuenta aciertos y, aparte, los fallos caros: «no» donde se esperaba «imprescindible»
(no buscar cuando hacía falta). Toda la estadística sale de `evals/estadistica.py`, nunca del modelo.

Llama a `claude` (gasta cuota): se lanza solo a mano y solo con --gastar. Sin él, dice cuántas llamadas haría.

    uv run python -m evals.cuando_research            # cuántas llamadas haría (no gasta nada)
    uv run python -m evals.cuando_research --gastar   # 3 llamadas con el banco v1 (30 lecciones, de 10 en 10)
"""

import argparse
import asyncio
import math
import sys
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from evals.estadistica import kappa, margen_wilson, tabla_de
from magister.plan.esquemas import NECESIDADES, Necesidad

BANCO = Path(__file__).parent / "banco" / "cuando-research-v1.yaml"
LOTE = 10  # lecciones por llamada: pocas llamadas y cada lección con su número


class EtiquetaLeccion(BaseModel):
    n: int = Field(description="El número de la lección, tal como va en la lista.")
    necesita_fuentes: Necesidad
    fuentes_por_que: str = Field(min_length=3, description="Una frase corta para el alumno.")


class Etiquetas(BaseModel):
    etiquetas: list[EtiquetaLeccion]


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


def entrada_de(lote: list[dict]) -> str:
    """Las lecciones numeradas desde 1, cada una con su tema, su título y sus objetivos."""
    partes = []
    for i, c in enumerate(lote, start=1):
        objetivos = "\n".join(f"   - {o}" for o in c["objetivos"])
        partes.append(f"{i}. Tema: {c['tema']}\n   Título: {c['titulo']}\n   Objetivos:\n{objetivos}")
    return "\n\n".join(partes)


def reglas_de(n: int):
    """Una entrada por lección, del 1 al n, sin repetir ni saltarse ninguna."""

    def reglas(salida: Etiquetas) -> list[str]:
        numeros = [e.n for e in salida.etiquetas]
        errores = []
        if sorted(numeros) != list(range(1, n + 1)):
            errores.append(f"tiene que haber una entrada por lección, de la 1 a la {n}, sin repetir: has dado {numeros}")
        return errores

    return reglas


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


async def etiquetar(casos: list[dict], tamano: int = LOTE) -> dict[str, str | None]:
    from magister.cerebro.estructura import ErrorEstructura, estructurar
    from magister.cerebro.prompts import cargar

    predichas: dict[str, str | None] = {}
    for lote in lotes(casos, tamano):
        sistema = cargar("cuando_research").texto
        try:
            salida = await estructurar(sistema, entrada_de(lote), Etiquetas, reglas_de(len(lote)), tarea="planificar")
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--gastar", action="store_true", help="lanzarla de verdad con el modelo (gasta cuota)")
    ap.add_argument("--lote", type=int, default=LOTE, help="lecciones por llamada")
    ap.add_argument("--banco", type=Path, default=BANCO)
    args = ap.parse_args(argv)
    casos = cargar_banco(args.banco)
    n = llamadas_previstas(len(casos), args.lote)
    print(f"{len(casos)} lecciones de {args.banco.name}, de {args.lote} en {args.lote}: {n} llamadas al modelo "
          f"(tarea planificar), más algún reintento si una salida no vale.")
    if not args.gastar:
        print("No lanzo nada. Para gastarlas, añade --gastar.")
        return 2
    from magister.cerebro.prompts import cargar

    predichas = asyncio.run(etiquetar(casos, args.lote))
    print(informe(recuento(casos, predichas), cargar("cuando_research").version))
    return 0


if __name__ == "__main__":
    sys.exit(main())
