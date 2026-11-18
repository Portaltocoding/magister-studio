"""¿El plan tiene el tamaño de lo que se pide? Un concepto suelto no puede salir en 11 lecciones ni un temario de máster
en dos. Cada caso lleva un rango razonable de horas y de lecciones (puesto a mano, con su porqué); el planificador
real hace el plan y el código mira si cae dentro. El presupuesto es amplio a propósito: lo que se mide es si lo llena.

Llama a `claude` (gasta cuota): se lanza solo a mano.

    uv run python -m evals.tamano_plan [--a-la-vez 4]
"""

import argparse
import asyncio
from dataclasses import dataclass
from datetime import date, timedelta

from magister.cerebro.prompts import cargar
from magister.flujo.nodos.planificar import planificar


@dataclass
class Caso:
    id: str
    tema: str
    objetivo: str
    nivel: str
    horas: tuple[float, float]
    lecciones: tuple[int, int]
    porque: str


CASOS = [
    Caso("dividir", "Dividir", "aprender a dividir", "basico", (1, 2.5), (1, 2),
         "un procedimiento elemental: entenderlo y practicarlo hasta hacerlo solo"),
    Caso("acimut", "Topografía", "entender qué es el acimut y calcularlo entre dos puntos", "basico", (0.5, 3), (1, 3),
         "un concepto concreto con una cuenta que hay que practicar"),
    Caso("usucapion", "Derecho civil", "entender la usucapión: requisitos, plazos y clases", "basico", (1, 3), (1, 3),
         "un concepto de grado con varios requisitos"),
    Caso("derivadas", "Derivadas", "saber derivar y aplicar derivadas en bachillerato", "basico", (5, 12), (3, 8),
         "un tema de una asignatura"),
    Caso("bbdd", "Bases de datos", "preparar entrevistas de backend: modelar, SQL, índices y transacciones", "basico", (12, 30), (5, 9),
         "un tema amplio con práctica"),
    Caso("delirios", "Filosofía de la psicopatología",
         "máster oficial de Lógica y Filosofía (UNED): ¿son creencias los delirios?, delirio e irracionalidad, confabulación "
         "y sensibilidad a la evidencia; nivel de lectura y discusión de literatura", "avanzado", (6, 20), (3, 8),
         "un tema de máster: lecturas y argumentos, no una asignatura entera"),
]


def dentro(valor: float, rango: tuple[float, float]) -> bool:
    return rango[0] <= valor <= rango[1]


async def uno(c: Caso, hoy: date) -> dict:
    perfil = {"tema": c.tema, "objetivo": c.objetivo, "nivel": c.nivel, "horas_por_dia": [2, 2, 2, 2, 2, 0, 0],
              "inicio_por_dia": ["18:00"] * 5 + [None, None], "plazo": (hoy + timedelta(days=60)).isoformat(),
              "sin_plazo": False, "preferencias": None, "notas": None}
    r = await planificar({"perfil": perfil, "hoy": hoy.isoformat()})
    lecciones = (r.get("plan") or {}).get("lecciones", [])
    horas = round(sum(float(x["horas"]) for x in lecciones), 2)
    return {"caso": c, "errores": r.get("errores") or [], "alcance": (r.get("plan") or {}).get("alcance"), "horas": horas, "n": len(lecciones), "titulos": [x["titulo"] for x in lecciones],
            "ok": bool(lecciones) and dentro(horas, c.horas) and dentro(len(lecciones), c.lecciones)}


async def principal(a_la_vez: int, solo: list[str] | None = None) -> None:
    limite = asyncio.Semaphore(a_la_vez)
    hoy = date.today()

    async def con_turno(c: Caso) -> dict:
        async with limite:
            return await uno(c, hoy)

    resultados = await asyncio.gather(*(con_turno(c) for c in CASOS if not solo or c.id in solo))
    print(f"Plantilla: {cargar('planificar').etiqueta}\n")
    for r in resultados:
        c: Caso = r["caso"]
        marca = "bien" if r["ok"] else "FUERA"
        print(f"{marca:5s} {c.id:10s} [{r['alcance']}] {r['horas']:5.1f} h ({c.horas[0]:g}-{c.horas[1]:g}) · {r['n']} lecciones "
              f"({c.lecciones[0]}-{c.lecciones[1]}) · {' / '.join(r['titulos'])}")
        if not r["titulos"]:
            print("      sin plan; errores de sus intentos:", *dict.fromkeys(r["errores"]), sep="\n        ")
    print(f"\n{sum(r['ok'] for r in resultados)} de {len(resultados)} dentro de su rango")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--a-la-vez", type=int, default=4)
    p.add_argument("--solo", nargs="*", help="ids de los casos que se lanzan (por defecto, todos)")
    a = p.parse_args()
    asyncio.run(principal(a.a_la_vez, a.solo))
