"""El juego fijo de preguntas del índice: ¿tu biblioteca devuelve lo que debe, y en qué escalón?

    uv run python -m evals.recuperacion                 las preguntas de evals/banco/recuperacion-v1.yaml
    uv run python -m evals.recuperacion --detalle       una línea por pregunta
    uv run python -m evals.recuperacion --estricto      sale con error si no llega a los mínimos (para tras reindexar)

Solo usa los modelos locales (embeddings y reranker): no llama a `claude` ni gasta cuota. Busca en tu base de verdad
con el mismo buscador que el chat; lo único que escribe es la traza de cada búsqueda en `busquedas`, como cualquier
consulta. Es la comprobación del protocolo de reindexado: se lanza antes y después, y sirve para elegir los umbrales
con datos (MAGISTER_UMBRAL_FUENTES y MAGISTER_UMBRAL_RERANKER).

Cada pregunta acaba en un escalón: «densa» (el coseno bastó), «reranker» (hizo falta la segunda puerta) o «nada» (sin
fuentes). Las de `sin_fuentes: true` deben acabar en «nada».
"""

import argparse
import asyncio
import re
import statistics
import sys
import time
import unicodedata
from pathlib import Path

import yaml
from sqlalchemy import text

from magister.config import ajustes
from magister.datos.sesion import cerrar, configurar, nueva_sesion
from magister.fuentes.buscar import BuscadorHibrido

BANCO = Path(__file__).parent / "banco" / "recuperacion-v1.yaml"
K = 5
# Mínimos para dar por bueno un índice (--estricto): se deciden aquí, a la vista, no dentro del modelo.
MIN_CON_FUENTES = 0.85  # de las que tienen respuesta, cuántas encuentran fuentes
MIN_DOCUMENTO = 0.80  # y cuántas traen el documento esperado entre los 3 primeros
MAX_FALSAS = 0.20  # de las de otros temas, cuántas dicen «hay fuentes»

ENCABEZADO = re.compile(r"(?m)^#{1,3} [^\n]+")


def plano(t: str) -> str:
    t = unicodedata.normalize("NFD", t.lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def seccion_de(texto: str, inicio: int) -> str:
    """El último encabezado antes de esa posición (la sección en la que cae un fragmento)."""
    ultimo = ""
    for m in ENCABEZADO.finditer(texto):
        if m.start() > inicio:
            break
        ultimo = m.group(0).lstrip("# ").strip()
    return ultimo


def juzgar(caso: dict, recuperados: list[dict], hay: bool) -> dict:
    """Función pura: lo que salió frente a lo que debía salir. `recuperados`: [{titulo, seccion}] en orden."""
    if caso.get("sin_fuentes"):
        return {"tipo": "ajena", "bien": not hay}
    doc = plano(caso["documento"])
    en_3 = any(doc in plano(r["titulo"]) for r in recuperados[:3])
    sec = caso.get("seccion")
    en_seccion = None if not sec else any(doc in plano(r["titulo"]) and plano(sec) in plano(r["seccion"]) for r in recuperados[:K])
    return {"tipo": "propia", "bien": hay and en_3, "con_fuentes": hay, "documento": en_3, "seccion": en_seccion}


def resumen(filas: list[dict]) -> dict:
    """Función pura: proporciones y recuento por escalón."""
    propias = [f for f in filas if f["tipo"] == "propia"]
    ajenas = [f for f in filas if f["tipo"] == "ajena"]
    con_seccion = [f for f in propias if f["seccion"] is not None]

    def parte(lista: list[dict], clave: str) -> float | None:
        return round(sum(1 for f in lista if f[clave]) / len(lista), 3) if lista else None

    return {
        "propias": len(propias), "ajenas": len(ajenas),
        "con_fuentes": parte(propias, "con_fuentes"), "documento_en_3": parte(propias, "documento"),
        "seccion_en_5": parte(con_seccion, "seccion"),
        "falsas": round(sum(1 for f in ajenas if not f["bien"]) / len(ajenas), 3) if ajenas else None,
        "escalones": {e: sum(1 for f in propias if f["escalon"] == e) for e in ("densa", "reranker", "nada")},
        "ms_mediana": round(statistics.median(f["ms"] for f in filas)) if filas else None,
    }


def cumple(r: dict) -> list[str]:
    fallos = []
    if r["con_fuentes"] is not None and r["con_fuentes"] < MIN_CON_FUENTES:
        fallos.append(f"solo el {r['con_fuentes']:.0%} de las preguntas con respuesta encuentra fuentes (mínimo {MIN_CON_FUENTES:.0%})")
    if r["documento_en_3"] is not None and r["documento_en_3"] < MIN_DOCUMENTO:
        fallos.append(f"solo el {r['documento_en_3']:.0%} trae el documento esperado entre los 3 primeros (mínimo {MIN_DOCUMENTO:.0%})")
    if r["falsas"] is not None and r["falsas"] > MAX_FALSAS:
        fallos.append(f"el {r['falsas']:.0%} de las preguntas de otros temas dice que hay fuentes (máximo {MAX_FALSAS:.0%})")
    return fallos


async def _secciones(recuperados) -> list[dict]:
    """Título y sección de cada recuperado, leyendo el texto de su versión (los ids viajan; el texto se trae al final)."""
    if not recuperados:
        return []
    ids = [r.fragmento_id for r in recuperados]
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select f.id, f.inicio, v.texto from fragmentos f join versiones v on v.id = f.version_id where f.id = any(:i)"),
            {"i": ids})).all()
    por_id = {fid: seccion_de(texto, inicio) for fid, inicio, texto in filas}
    return [{"titulo": r.documento_titulo, "seccion": por_id.get(r.fragmento_id, "")} for r in recuperados]


async def correr(banco: list[dict]) -> list[dict]:
    buscador = BuscadorHibrido()
    filas = []
    for caso in banco:
        t0 = time.perf_counter()
        r = await buscador.buscar(caso["pregunta"], K)
        ms = (time.perf_counter() - t0) * 1000
        hay = r.hay_fuentes(ajustes.umbral_fuentes, ajustes.umbral_reranker)
        escalon = "nada" if not hay else "densa" if r.mejor_similitud >= ajustes.umbral_fuentes else "reranker"
        fila = juzgar(caso, await _secciones(r.recuperados), hay)
        filas.append({**fila, "pregunta": caso["pregunta"], "escalon": escalon, "ms": ms, "via": r.via,
                      "similitud": round(r.mejor_similitud, 3), "reranker": r.mejor_reranker,
                      "primero": r.recuperados[0].documento_titulo[:40] if r.recuperados else ""})
    return filas


async def principal() -> None:
    ap = argparse.ArgumentParser(description="El juego fijo de preguntas del índice (solo modelos locales; no gasta cuota).")
    ap.add_argument("--banco", default=str(BANCO))
    ap.add_argument("--detalle", action="store_true")
    ap.add_argument("--estricto", action="store_true")
    args = ap.parse_args()
    banco = yaml.safe_load(Path(args.banco).read_text(encoding="utf-8"))["preguntas"]
    configurar()
    try:
        async with nueva_sesion() as s:
            n = await s.scalar(text("select count(*) from fragmentos"))
        if not n:
            print("No hay ningún fragmento indexado: no hay nada que medir. Indexa primero (uv run magister indexar).")
            sys.exit(2 if args.estricto else 0)
        filas = await correr(banco)
    finally:
        await cerrar()
    if args.detalle:
        for f in filas:
            rr = "" if f["reranker"] is None else f" rr={f['reranker']:.2f}"
            marca = "bien" if f["bien"] else "MAL "
            print(f"{marca} {f['escalon']:<8} sim={f['similitud']:.3f}{rr} {f['ms']:>5.0f} ms · {f['pregunta'][:70]} → {f['primero']}")
    r = resumen(filas)
    print(f"\n{n} fragmentos · umbral denso {ajustes.umbral_fuentes} · umbral reranker {ajustes.umbral_reranker}")
    print(f"Con respuesta ({r['propias']}): con fuentes {r['con_fuentes']:.0%} · documento entre los 3 primeros {r['documento_en_3']:.0%}"
          + (f" · sección entre los {K} primeros {r['seccion_en_5']:.0%}" if r["seccion_en_5"] is not None else ""))
    print(f"  por escalón: densa {r['escalones']['densa']}, reranker {r['escalones']['reranker']}, sin fuentes {r['escalones']['nada']}")
    if r["ajenas"]:
        print(f"De otros temas ({r['ajenas']}): dicen «hay fuentes» {r['falsas']:.0%}")
    print(f"Latencia mediana {r['ms_mediana']} ms")
    fallos = cumple(r)
    for f in fallos:
        print("NO LLEGA:", f)
    if args.estricto and fallos:
        sys.exit(1)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(principal())
