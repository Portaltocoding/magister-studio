"""Línea base del research por objetivos (ADR-0020) y de cuándo hace falta buscar (ADR-0021), sobre un banco fijo.

Cada lección del banco (`evals/banco/research-base-v1.yaml`) trae su web falsa (cualquier búsqueda devuelve sus
páginas, sin red) y, puesto a mano, qué objetivos cubre de verdad cada página, su autoridad (0 a 3) y si es mala
(portada, comercial, espejo). El research fijo corre de verdad (consultas y juez con el modelo; filtros, citas y
elección por código) y la decisión de `necesita_fuentes` sale de la plantilla `cuando_research`, como en
`evals.cuando_research`. Lo que se mide, todo con código (`evals/estadistica.py` y `evals.regresion`):

- cobertura_juez: objetivos cubiertos por las propuestas según la ficha del juez (lo que ve la app).
- cobertura_real: los mismos, según el banco (lo que cubren de verdad las páginas elegidas).
- autoridad_banco: autoridad media, según el banco, de lo propuesto. Aparte, la que dijo el juez (solo informativa).
- citas_verificadas: notas del juez cuya cita está de verdad en la página (las otras se descartan).
- malas_elegidas: propuestas marcadas como malas en el banco (mejor, ninguna).
- necesita_acierta: si la etiqueta de `necesita_fuentes` coincide con la del banco; fallo caro, «no» donde hacía falta.

Llama a `claude` (gasta cuota): solo a mano. Sin modelo: `MAGISTER_MOTOR=eco` (las consultas y el juez salen del
banco, como en `evals.research`): mide el código, no al modelo.

    uv run python -m evals.research_base                    corto: 2 lecciones, unas 5 llamadas (tope 9)
    uv run python -m evals.research_base --nivel completo   6 lecciones, unas 13 llamadas (tope 25)
"""

import argparse
from pathlib import Path

import yaml

from evals import regresion, tope
from evals.estadistica import margen_wilson, media
from magister.plan.esquemas import NECESIDADES

BANCO = Path(__file__).parent / "banco" / "research-base-v1.yaml"
CORTO = ["http-json", "rgpd-plazos"]
TOPES = {"corto": 9, "completo": 25}
PROMPTS = ["research_consultas", "research_juez", "cuando_research"]


def cargar_banco(ruta: Path = BANCO) -> list[dict]:
    with open(ruta, encoding="utf-8") as f:
        casos = yaml.safe_load(f)
    for c in casos:
        n = len(c["objetivos"])
        if c.get("espera") not in NECESIDADES:
            raise ValueError(f"{c.get('id')}: espera tiene que ser no, conviene o imprescindible")
        for p in c["paginas"]:
            if not 0 <= p.get("autoridad", -1) <= 3:
                raise ValueError(f"{c['id']}: la autoridad de {p['url']} va de 0 a 3")
            if any(not 1 <= o <= n for o in p.get("cubre") or []):
                raise ValueError(f"{c['id']}: {p['url']} cubre un objetivo que no existe")
    return casos


def leccion_de(caso: dict) -> dict:
    return {"clave": "L1", "titulo": caso["titulo"], "tema": caso["tema"], "objetivos": list(caso["objetivos"])}


def medir(caso: dict, propuestas: list[dict], trayectoria: list[dict]) -> dict:
    """Las cifras de una lección, todas por código. `propuestas`: las de `Herramientas.propuestas` (con su ficha);
    `trayectoria`: la de `research_fijo` (el paso «puntuar» y los «descartada» por cita)."""
    por_url = {p["url"]: p for p in caso["paginas"]}
    n = len(caso["objetivos"])
    urls = [p["url"] for p in propuestas]
    del_juez = {o for p in propuestas for o in ((p.get("ficha") or {}).get("objetivos") or []) if 1 <= o <= n}
    reales = {o for u in urls for o in (por_url.get(u, {}).get("cubre") or [])}
    notas = next((x.get("notas") or [] for x in trayectoria if x.get("accion") == "puntuar"), [])
    citas_falsas = sum(1 for x in trayectoria if x.get("accion") == "descartada" and x.get("por") == "cita")
    return {
        "objetivos": n, "propuestas": len(urls),
        "cubiertos_juez": len(del_juez), "cubiertos_reales": len(reales),
        "autoridad_banco": [por_url[u]["autoridad"] for u in urls if u in por_url],
        "autoridad_juez": [(p.get("ficha") or {}).get("autoridad") for p in propuestas
                           if isinstance((p.get("ficha") or {}).get("autoridad"), int)],
        "notas": len(notas), "citas_ok": max(0, len(notas) - citas_falsas),
        "malas": [u for u in urls if por_url.get(u, {}).get("mala")],
        "sin_cubrir_reales": [o for o in range(1, n + 1) if o not in reales],
    }


def metricas(casos: list[dict], medidas: dict[str, dict], predichas: dict[str, str | None]) -> dict:
    """Para `evals.regresion`, por lección. Una lección sin propuestas no tiene autoridad media (no cuenta en esa)."""
    m = {
        "cobertura_juez": regresion.proporcion({c: (x["cubiertos_juez"], x["objetivos"]) for c, x in medidas.items()}),
        "cobertura_real": regresion.proporcion({c: (x["cubiertos_reales"], x["objetivos"]) for c, x in medidas.items()}),
        "autoridad_banco": regresion.media({c: media(x["autoridad_banco"]) for c, x in medidas.items() if x["autoridad_banco"]}),
        "citas_verificadas": regresion.proporcion({c: (x["citas_ok"], x["notas"]) for c, x in medidas.items()}),
        "malas_elegidas": regresion.proporcion({c: (len(x["malas"]), x["propuestas"]) for c, x in medidas.items()}, mejor="bajo"),
    }
    respondidas = [c for c in casos if c["id"] in predichas]
    if respondidas:
        m["necesita_acierta"] = regresion.proporcion({c["id"]: (int(predichas[c["id"]] == c["espera"]), 1) for c in respondidas})
        caros = {c["id"]: (int(predichas[c["id"]] == "no"), 1) for c in respondidas if c["espera"] == "imprescindible"}
        if caros:
            m["necesita_fallo_caro"] = regresion.proporcion(caros, mejor="bajo")
    return {k: v for k, v in m.items() if v["por_caso"]}


def informe(casos: list[dict], medidas: dict[str, dict], predichas: dict[str, str | None]) -> str:
    lineas = []
    for c in casos:
        if c["id"] not in medidas:
            continue
        x = medidas[c["id"]]
        dicha = predichas.get(c["id"], "—")
        lineas.append(
            f"{c['id']:<20} {x['propuestas']} propuestas · objetivos {x['cubiertos_juez']}/{x['objetivos']} según el juez, "
            f"{x['cubiertos_reales']}/{x['objetivos']} de verdad · autoridad {media(x['autoridad_banco']):.1f} (juez "
            f"{media(x['autoridad_juez']):.1f}) · citas {x['citas_ok']}/{x['notas']} · malas {len(x['malas'])} · "
            f"necesita: {dicha} (esperado {c['espera']})")
    lineas.append("")
    for nombre, m in metricas(casos, medidas, predichas).items():
        r = regresion.resumir(m)
        if m["tipo"] == "proporcion":
            p, lo, hi = margen_wilson(r["k"], r["n"])
            lineas.append(f"{nombre:<22} {r['k']}/{r['n']} ({p:.0%}, IC 95 % {lo:.0%}-{hi:.0%})")
        else:
            lineas.append(f"{nombre:<22} {r['valor']:.2f} (IC 95 % {r['ic'][0]:.2f}-{r['ic'][1]:.2f}, {r['n']} lecciones)")
    return "\n".join(lineas)


def encolar_eco(caso: dict) -> None:
    """Con el motor eco, las salidas del modelo salen del banco (como `evals.research.encolar_eco`): una consulta por
    objetivo y, por página, una nota con los objetivos que cubre de verdad y su autoridad."""
    from evals.research import encolar_eco as base

    tarea = {"leccion": leccion_de(caso), "paginas": [
        {**p, "nota": {"objetivos": p.get("cubre") or [], "autoridad": p["autoridad"],
                       "tipo": "comercial" if p.get("mala") else "tutorial"}} for p in caso["paginas"]]}
    base(tarea)


async def correr(casos: list[dict], t: tope.Tope) -> tuple[dict[str, dict], dict[str, str | None]]:
    from evals.cuando_research import etiquetar
    from evals.research import WebDeBanco
    from magister.config import ajustes
    from magister.research.fijo import research_fijo
    from magister.research.herramientas import Herramientas

    medidas: dict[str, dict] = {}
    for c in casos:
        if not t.cabe(2):  # el research fijo son 2 llamadas por lección
            t.cortado = True
            break
        if ajustes.motor == "eco":
            encolar_eco(c)
        h = Herramientas(WebDeBanco({"paginas": c["paginas"]}), 0, "L1")
        try:
            r = await research_fijo(leccion_de(c), h)
        except tope.TopeAlcanzado:
            break
        medidas[c["id"]] = medir(c, h.propuestas, r.get("trayectoria") or [])
        print(f"  {c['id']}: {r.get('motivo_fin')} ({r.get('llamadas')} llamadas)", flush=True)
    predichas: dict[str, str | None] = {}
    if t.cabe(1) and not t.cortado:
        if ajustes.motor == "eco":
            from evals.cuando_research import Etiquetas
            from magister.cerebro.estructura import eco

            eco.encolar(Etiquetas, [{"etiquetas": [{"n": i, "necesita_fuentes": "conviene", "fuentes_por_que": "eco"}
                                                    for i in range(1, len(casos) + 1)]}])
        todas = await etiquetar([{**c, "objetivos": c["objetivos"]} for c in casos], len(casos) or 1, t)
        predichas = {k: v for k, v in todas.items() if v is not None}
    return medidas, predichas


async def principal(args) -> None:
    from magister.config import ajustes

    t = args.tope
    casos = tope.del_nivel(cargar_banco(args.banco), args.nivel, CORTO if args.banco == BANCO else 2)
    print(f"research_base · nivel {args.nivel} · {len(casos)} lecciones · motor={ajustes.motor} modelo={ajustes.modelo}")
    medidas, predichas = await correr(casos, t)
    print("\n" + informe(casos, medidas, predichas))
    if medidas or predichas:
        ej = regresion.ejecucion("research_base", args.nivel, regresion.versiones(PROMPTS),
                                 metricas(casos, medidas, predichas), t, regresion.huella(args.banco))
        print(f"\nGuardada para comparar: {regresion.guardar(ej)}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Línea base del research por objetivos sobre un banco fijo (gasta cuota).")
    ap.add_argument("--banco", type=Path, default=BANCO)
    tope.argumentos(ap, **TOPES)
    args = ap.parse_args(argv)
    args.tope = tope.de_args(args)
    tope.correr(principal(args), args.tope)


if __name__ == "__main__":
    main()
