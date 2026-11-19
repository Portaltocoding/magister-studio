"""Rejugar el research sin volver a buscar: medir si mejora sin gastar cuota (o gastando lo justo).

    uv run python -m evals.research_rejugar --tareas 31-50 --solo-elegir
    uv run python -m evals.research_rejugar --tareas 31-50 --solo-elegir --max-por-dominio 1 --max-propuestas 4
    uv run python -m evals.research_rejugar --tareas 31-35 --juez          # 1 llamada por lección, a mano

--solo-elegir lee de `tareas_research` las notas que guardó el juez (el paso «puntuar» de la trayectoria) y vuelve a
elegir con otros parámetros. No llama al modelo ni a la web: solo lee la base (SELECT).

--juez reconstruye lo que se leyó desde MAGISTER_CRUDO por el `crudo_sha` de cada lectura (con el mismo extractor) y lo
vuelve a juzgar con la plantilla `research_juez` de ahora: una llamada por lección. Si falta un crudo, avisa y sigue.

Ningún número lo calcula el modelo: cobertura, proporción de cada tipo, dominios repetidos y citas descartadas salen de
aquí y de `evals/estadistica.py`. Las tareas de antes del juez por objetivos (sin «puntuar» ni `crudo_sha`) no se
pueden rejugar: se dice y se saltan.
"""

import argparse
import asyncio
import sys
from collections import Counter
from pathlib import Path

from evals.estadistica import cobertura, media, precision
from magister.research.fijo import MAX_POR_DOMINIO, Nota, elegir
from magister.research.herramientas import dominio

CARPETA = Path(__file__).parent


def notas_guardadas(trayectoria: list[dict]) -> list[dict] | None:
    """Las notas del paso «puntuar», o None si la tarea es de antes."""
    paso = next((x for x in trayectoria or [] if isinstance(x, dict) and x.get("accion") == "puntuar"), None)
    return None if paso is None else list(paso.get("notas") or [])


def elegidas_guardadas(trayectoria: list[dict]) -> list[str]:
    return [x["url"] for x in trayectoria or [] if isinstance(x, dict) and x.get("accion") == "proponer"]


def _como_nota(n: dict) -> Nota:
    return Nota(url=n["url"], objetivos=list(n.get("objetivos") or []), tipo=n.get("tipo", "articulo"),
                profundidad=int(n.get("profundidad", 0)), autoridad=int(n.get("autoridad", 0)),
                cita=n.get("cita", ""), resumen=n.get("resumen", ""))


def medir(elegidas: list[Nota], sin_cubrir: list[int], n_objetivos: int, notas: list[dict], citas_falsas: int) -> dict:
    """Las cifras de una lección rejugada: todo con código."""
    tipos = Counter(n.get("tipo") for n in notas)
    por_dominio = Counter(dominio(e.url) for e in elegidas)
    return {
        "propuestas": len(elegidas), "objetivos": n_objetivos, "cubiertos": n_objetivos - len(sin_cubrir),
        "cobertura": cobertura(n_objetivos - len(sin_cubrir), n_objetivos), "sin_cubrir": sin_cubrir,
        "tipos": dict(tipos), "dominios_repetidos": sum(1 for v in por_dominio.values() if v > 1),
        "citas_descartadas": citas_falsas, "notas": len(notas),
    }


def rejugar_elegir(tarea: dict, n_objetivos: int, max_propuestas: int = 6, max_por_dominio: int = MAX_POR_DOMINIO) -> dict | None:
    """Vuelve a elegir con las notas guardadas, sin modelo. None si la tarea no guardó notas."""
    notas = notas_guardadas(tarea.get("trayectoria") or [])
    if notas is None:
        return None
    pedidos = list((tarea.get("estado_agente") or {}).get("objetivos") or [])
    validas = [_como_nota(n) for n in notas if n.get("valida")]
    a_cubrir = pedidos or list(range(1, n_objetivos + 1))
    elegidas, sin_cubrir = elegir(validas, n_objetivos, max_propuestas, max_por_dominio, a_cubrir if n_objetivos else None)
    citas = sum(1 for x in tarea.get("trayectoria") or [] if isinstance(x, dict) and x.get("accion") == "descartada"
                and x.get("por") == "cita")
    return {**medir(elegidas, sin_cubrir, len(a_cubrir), notas, citas), "elegidas": [e.url for e in elegidas],
            "guardadas": elegidas_guardadas(tarea.get("trayectoria") or [])}


def lecturas_desde_crudo(trayectoria: list[dict], carpeta: Path, avisar=print) -> list:
    """Las lecturas buenas de la tarea, rehechas desde el crudo guardado. Si falta uno, se avisa y se sigue."""
    from magister.research.herramientas import _extraer

    salida = []
    for paso in trayectoria or []:
        if not isinstance(paso, dict) or paso.get("accion") not in ("leer", "alternativa"):
            continue
        if paso.get("error"):
            continue
        url = paso.get("alternativa") if paso["accion"] == "alternativa" else paso.get("url")
        sha = paso.get("crudo_sha")
        if not sha or not url:
            continue
        ruta = carpeta / sha
        if not ruta.is_file():
            avisar(f"  falta el crudo de {url} ({sha[:12]}): sigo sin él")
            continue
        lectura = _extraer(url, ruta.read_bytes())
        lectura.crudo_sha = sha
        # Un pedazo no se juzga: su alternativa, si la hubo, viene en el paso siguiente.
        if not lectura.error and not lectura.incompleta:
            salida = [x for x in salida if x.url != url] + [lectura]
    return salida


async def rejugar_juez(tarea: dict, leccion: dict, carpeta: Path, avisar=print) -> dict | None:
    """Vuelve a juzgar lo que se leyó (una llamada) con la plantilla de ahora y vuelve a elegir."""
    from magister.cerebro.estructura import ErrorEstructura, estructurar
    from magister.cerebro.prompts import cargar
    from magister.research.fijo import Notas, cita_en, describir, ficha_de, vale
    from magister.research.herramientas import delimitar

    lecturas = lecturas_desde_crudo(tarea.get("trayectoria") or [], carpeta, avisar)
    if not lecturas:
        avisar("  ninguna lectura que rehacer")
        return None
    n = len(leccion.get("objetivos") or [])
    entrada = describir(leccion) + "\n\n" + "\n\n".join(delimitar(x) for x in lecturas)
    try:
        notas = await estructurar(cargar("research_juez").texto, entrada, Notas)
    except ErrorEstructura as e:
        avisar(f"  el juez no contestó bien: {e}")
        return None
    por_url = {x.url: x for x in lecturas}
    validas, resumen, citas = [], [], 0
    for nota in notas.notas:
        if nota.url not in por_url:
            continue
        nota.objetivos = sorted({o for o in nota.objetivos if 1 <= o <= n})
        if not cita_en(nota.cita, por_url[nota.url].extracto):
            citas += 1
        ok = vale(nota, por_url[nota.url].extracto, exigir_objetivos=n > 0)
        resumen.append({**ficha_de(nota), "url": nota.url, "valida": ok})
        if ok:
            validas.append(nota)
    elegidas, sin_cubrir = elegir(validas, n)
    return {**medir(elegidas, sin_cubrir, n, resumen, citas), "elegidas": [e.url for e in elegidas],
            "guardadas": elegidas_guardadas(tarea.get("trayectoria") or [])}


def tabla(filas: list[tuple[int, str, dict]]) -> str:
    lineas = ["| Tarea | Lección | Propuestas | Cobertura | Sin fuente | Dominios repetidos | Citas descartadas | Tipos |",
              "|---|---|---|---|---|---|---|---|"]
    for tid, clave, m in filas:
        tipos = ", ".join(f"{k} {v}" for k, v in sorted(m["tipos"].items(), key=lambda x: -x[1]))
        lineas.append(f"| {tid} | {clave} | {m['propuestas']} | {m['cubiertos']}/{m['objetivos']} | {m['sin_cubrir']} | "
                      f"{m['dominios_repetidos']} | {m['citas_descartadas']} | {tipos} |")
    if filas:
        cubiertos = sum(m["cubiertos"] for _, _, m in filas)
        total = sum(m["objetivos"] for _, _, m in filas)
        todas = Counter()
        for _, _, m in filas:
            todas.update(m["tipos"])
        malas = sum(todas.get(t, 0) for t in ("portada", "comercial", "espejo", "muro"))
        lineas.append(f"\nCobertura total: {cubiertos}/{total} ({cobertura(cubiertos, total):.0%}); propuestas por lección: "
                      f"{media([m['propuestas'] for _, _, m in filas]):.1f}; notas de páginas malas (portada, comercial, "
                      f"espejo, muro): {precision(malas, sum(todas.values())):.0%}.")
    return "\n".join(lineas)


async def _cargar(desde: int, hasta: int) -> list[dict]:
    """Solo lectura: las tareas y los objetivos de sus lecciones."""
    from sqlalchemy import select

    from magister.datos import plan as dp
    from magister.datos.fuentes import TareaResearch
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        filas = (await s.scalars(select(TareaResearch).where(TareaResearch.id.between(desde, hasta))
                                 .order_by(TareaResearch.id))).all()
        objetivos: dict[tuple[int, str], int] = {}
        for t in filas:
            if (t.plan_id, t.leccion_clave) not in objetivos:
                for lec in await dp.lecciones(s, t.plan_id):
                    objetivos[(t.plan_id, lec.clave)] = len(lec.objetivos or [])
    return [{"id": t.id, "plan_id": t.plan_id, "leccion_clave": t.leccion_clave, "trayectoria": t.trayectoria or [],
             "estado_agente": t.estado_agente or {}, "n_objetivos": objetivos.get((t.plan_id, t.leccion_clave), 0)}
            for t in filas]


async def principal() -> None:
    from magister.config import ajustes

    ap = argparse.ArgumentParser()
    ap.add_argument("--tareas", required=True, help="un rango de ids de tareas_research, como 31-50")
    modo = ap.add_mutually_exclusive_group(required=True)
    modo.add_argument("--solo-elegir", action="store_true", help="sin modelo: vuelve a elegir con las notas guardadas")
    modo.add_argument("--juez", action="store_true", help="vuelve a juzgar desde el crudo: 1 llamada por lección")
    ap.add_argument("--max-propuestas", type=int, default=6)
    ap.add_argument("--max-por-dominio", type=int, default=MAX_POR_DOMINIO)
    ap.add_argument("--guardar", action="store_true", help="añade la tabla a RESULTADOS-research.md")
    args = ap.parse_args()
    desde, _, hasta = args.tareas.partition("-")
    tareas = await _cargar(int(desde), int(hasta or desde))
    filas: list[tuple[int, str, dict]] = []
    for t in tareas:
        if args.solo_elegir:
            m = rejugar_elegir(t, t["n_objetivos"], args.max_propuestas, args.max_por_dominio)
        else:
            from magister.research.tareas import _leccion

            print(f"tarea {t['id']} ({t['leccion_clave']}): juzgando de nuevo…", flush=True)
            leccion = await _leccion(t["plan_id"], t["leccion_clave"])
            m = await rejugar_juez(t, leccion, Path(ajustes.crudo)) if leccion else None
        if m is None:
            print(f"tarea {t['id']} ({t['leccion_clave']}): de antes del juez por objetivos o sin lecturas; la salto")
            continue
        filas.append((t["id"], t["leccion_clave"], m))
    texto = tabla(filas)
    print(texto)
    if args.guardar and filas:
        modo_txt = "solo elegir" if args.solo_elegir else "juez de nuevo"
        with (CARPETA / "RESULTADOS-research.md").open("a", encoding="utf-8") as f:
            f.write(f"\n### Rejugar {args.tareas} ({modo_txt}, max_propuestas={args.max_propuestas}, "
                    f"max_por_dominio={args.max_por_dominio})\n\n{texto}\n")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(principal())
