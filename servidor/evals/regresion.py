"""Regresión de prompts: cada ejecución de una eval se guarda con las versiones de las plantillas que la produjeron, y
dos ejecuciones se comparan (qué prompts cambiaron y cómo se movió cada métrica, con su intervalo).

    uv run python -m evals.regresion listar [--eval research_base]
    uv run python -m evals.regresion comparar --eval research_base           las dos últimas de esa eval
    uv run python -m evals.regresion comparar A.json B.json                  dos ficheros concretos (A antes, B después)

No llama al modelo. Las ejecuciones van a `evals/resultados/regresion/` (fuera de git). Toda la estadística sale de
`evals/estadistica.py`:

- Cada métrica guarda su valor por caso. Una `proporcion` guarda (aciertos, total) por caso y se resume con Wilson; una
  `media`, un número por caso y se resume con bootstrap.
- Si las dos ejecuciones comparten al menos 2 casos, la diferencia es pareada (bootstrap de las diferencias por caso);
  si la métrica es de sí o no por caso, además los discordantes y el p exacto de McNemar. Si no, Newcombe para las
  proporciones y bootstrap de dos muestras para las medias.
- Se avisa si cambian el nivel, el banco, el motor o el modelo: entonces la diferencia no es solo de los prompts.
"""

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from evals import estadistica as est

CARPETA = Path(__file__).parent / "resultados" / "regresion"
MIN_PARES = 2


# --- Construir y guardar --------------------------------------------------------------------------------------------


def proporcion(por_caso: dict[str, tuple[int, int]], mejor: str = "alto") -> dict:
    """Una métrica de aciertos: (aciertos, total) por caso. `mejor`: «alto» o «bajo» (los fallos caros, mejor pocos)."""
    for caso, (k, n) in por_caso.items():
        if not 0 <= k <= n:
            raise ValueError(f"{caso}: {k} aciertos de {n} no es una proporción")
    return {"tipo": "proporcion", "mejor": mejor, "por_caso": {c: [int(k), int(n)] for c, (k, n) in por_caso.items()}}


def media(por_caso: dict[str, float], mejor: str = "alto") -> dict:
    return {"tipo": "media", "mejor": mejor, "por_caso": {c: float(v) for c, v in por_caso.items()}}


def versiones(nombres: list[str]) -> dict[str, str]:
    """La versión (SHA-256, 12 caracteres) de cada plantilla de `cerebro/prompts/`, como la usaría el cerebro. No pasa
    por `cargar` para no tocar el prompt en uso de la llamada siguiente."""
    from magister.cerebro import prompts

    return {n: (prompts.ACTIVAS.get(n) or prompts._del_fichero(n)).version for n in sorted(set(nombres))}


def huella(ruta: Path) -> str:
    return hashlib.sha256(Path(ruta).read_bytes()).hexdigest()[:12]


def ejecucion(nombre: str, nivel: str, prompts: dict[str, str], metricas: dict[str, dict], tope=None,
              banco: str | None = None, momento: datetime | None = None, extra: dict | None = None) -> dict:
    """Lo que se guarda de una ejecución. `prompts`: {plantilla: versión} (de `versiones`). `tope`: el `evals.tope.Tope`."""
    from magister.config import ajustes

    momento = momento or datetime.now(timezone.utc)
    return {
        "eval": nombre, "nivel": nivel, "momento": momento.isoformat(timespec="seconds"), "motor": ajustes.motor,
        "modelo": ajustes.modelo, "banco": banco, "prompts": dict(sorted(prompts.items())),
        "llamadas": tope.hechas if tope else None, "tope": tope.maximo if tope else None,
        "cortado": bool(tope and tope.cortado), "metricas": metricas, "extra": extra or {},
    }


def guardar(ej: dict, carpeta: Path = CARPETA) -> Path:
    carpeta.mkdir(parents=True, exist_ok=True)
    sello = ej["momento"].replace(":", "").replace("-", "")[:15]
    prompts = hashlib.sha256(json.dumps(ej["prompts"], sort_keys=True).encode()).hexdigest()[:8]
    ruta = carpeta / f"{ej['eval']}-{ej['nivel']}-{sello}-{prompts}.json"
    ruta.write_text(json.dumps(ej, ensure_ascii=False, indent=1), encoding="utf-8")
    return ruta


def leer(ruta: Path) -> dict:
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def ejecuciones(nombre: str | None = None, carpeta: Path = CARPETA) -> list[Path]:
    """Las guardadas, de la más antigua a la más nueva (por su momento, no por el nombre del fichero)."""
    if not carpeta.exists():
        return []
    rutas = [r for r in carpeta.glob("*.json") if nombre is None or leer(r).get("eval") == nombre]
    return sorted(rutas, key=lambda r: leer(r).get("momento", ""))


# --- Resumir y comparar ---------------------------------------------------------------------------------------------


def _valores(m: dict) -> dict[str, float]:
    """El valor de cada caso: la tasa en una proporción, el número en una media. Los casos sin total no cuentan."""
    if m["tipo"] == "proporcion":
        return {c: k / n for c, (k, n) in m["por_caso"].items() if n}
    return dict(m["por_caso"])


def resumir(m: dict) -> dict:
    """Valor, IC al 95 % y n de una métrica."""
    if m["tipo"] == "proporcion":
        k = sum(x[0] for x in m["por_caso"].values())
        n = sum(x[1] for x in m["por_caso"].values())
        p, lo, hi = est.margen_wilson(k, n)
        return {"valor": p, "ic": (lo, hi), "n": n, "k": k}
    xs = list(m["por_caso"].values())
    if not xs:
        return {"valor": 0.0, "ic": (0.0, 0.0), "n": 0}
    lo, hi = est.bootstrap_ic(xs, est.media, 2000) if len(xs) > 1 else (xs[0], xs[0])
    return {"valor": est.media(xs), "ic": (lo, hi), "n": len(xs)}


def _binaria(m: dict) -> bool:
    return m["tipo"] == "proporcion" and all(n == 1 for _, n in m["por_caso"].values())


def comparar_metrica(a: dict, b: dict) -> dict:
    """Cómo se mueve una métrica de la ejecución a a la b."""
    if a["tipo"] != b["tipo"]:
        raise ValueError(f"no se pueden comparar una {a['tipo']} y una {b['tipo']}")
    ra, rb = resumir(a), resumir(b)
    va, vb = _valores(a), _valores(b)
    comunes = sorted(set(va) & set(vb))
    salida = {"a": ra, "b": rb, "mejor": b.get("mejor", "alto"), "pares": len(comunes)}
    if len(comunes) >= MIN_PARES:
        d, lo, hi = est.bootstrap_pareado([(va[c], vb[c]) for c in comunes], 5000)
        salida.update(dif=d, ic_dif=(lo, hi), metodo="pareado por caso (bootstrap)")
        if _binaria(a) and _binaria(b):
            gana = sum(1 for c in comunes if va[c] == 0 and vb[c] == 1)
            pierde = sum(1 for c in comunes if va[c] == 1 and vb[c] == 0)
            salida.update(discordantes=(gana, pierde), p_mcnemar=est.binomial_dos_colas(gana, pierde))
    elif a["tipo"] == "proporcion" and ra["n"] and rb["n"]:
        d, lo, hi = est.newcombe(ra["k"], ra["n"], rb["k"], rb["n"])
        salida.update(dif=d, ic_dif=(lo, hi), metodo="independientes (Newcombe)")
    elif ra["n"] and rb["n"]:
        d, lo, hi = est.bootstrap_diferencia(list(a["por_caso"].values()), list(b["por_caso"].values()), 5000)
        salida.update(dif=d, ic_dif=(lo, hi), metodo="independientes (bootstrap)")
    else:
        salida.update(dif=None, ic_dif=None, metodo="sin datos en una de las dos")
    if salida["dif"] is not None:
        lo, hi = salida["ic_dif"]
        sube, baja = lo > 0, hi < 0
        if not (sube or baja):
            salida["veredicto"] = "sin cambio claro"
        else:
            mejora = sube if salida["mejor"] == "alto" else baja
            salida["veredicto"] = "mejora" if mejora else "empeora"
    else:
        salida["veredicto"] = "no comparable"
    return salida


def comparar(a: dict, b: dict) -> dict:
    """Lo que cambió entre dos ejecuciones de la misma eval: prompts, avisos y cada métrica."""
    if a["eval"] != b["eval"]:
        raise ValueError(f"son evals distintas: {a['eval']} y {b['eval']}")
    pa, pb = a.get("prompts") or {}, b.get("prompts") or {}
    prompts = {
        "cambiados": [(n, pa[n], pb[n]) for n in sorted(set(pa) & set(pb)) if pa[n] != pb[n]],
        "iguales": [n for n in sorted(set(pa) & set(pb)) if pa[n] == pb[n]],
        "nuevos": [(n, pb[n]) for n in sorted(set(pb) - set(pa))],
        "quitados": [(n, pa[n]) for n in sorted(set(pa) - set(pb))],
    }
    avisos = [f"cambia {campo}: {a.get(campo)} → {b.get(campo)}" for campo in ("nivel", "banco", "motor", "modelo")
              if a.get(campo) != b.get(campo)]
    avisos += [f"la ejecución {x} se cortó al llegar al tope: es parcial" for x, e in (("A", a), ("B", b)) if e.get("cortado")]
    metricas = {}
    for nombre in sorted(set(a["metricas"]) | set(b["metricas"])):
        if nombre not in a["metricas"] or nombre not in b["metricas"]:
            avisos.append(f"la métrica {nombre} solo está en {'B' if nombre in b['metricas'] else 'A'}")
            continue
        metricas[nombre] = comparar_metrica(a["metricas"][nombre], b["metricas"][nombre])
    return {"eval": a["eval"], "momentos": (a["momento"], b["momento"]), "prompts": prompts, "avisos": avisos,
            "metricas": metricas}


def _num(m: dict, x: float) -> str:
    return f"{x:.0%}" if m["tipo"] == "proporcion" else f"{x:.2f}"


def informe(c: dict, a: dict, b: dict) -> str:
    lineas = [f"{c['eval']}: A {c['momentos'][0]} → B {c['momentos'][1]}", ""]
    p = c["prompts"]
    if p["cambiados"] or p["nuevos"] or p["quitados"]:
        lineas.append("Prompts que cambian:")
        lineas += [f"  {n}: {va} → {vb}" for n, va, vb in p["cambiados"]]
        lineas += [f"  {n}: nuevo ({v})" for n, v in p["nuevos"]]
        lineas += [f"  {n}: quitado (era {v})" for n, v in p["quitados"]]
    else:
        lineas.append("Ningún prompt cambia: lo que se mueva es ruido del modelo o de otra cosa.")
    if p["iguales"]:
        lineas.append(f"Iguales: {', '.join(p['iguales'])}")
    if c["avisos"]:
        lineas += ["", "Ojo:"] + [f"  {x}" for x in c["avisos"]]
    lineas += ["", f"{'Métrica':<26}{'A':>18}{'B':>18}   diferencia (IC 95 %)"]
    for nombre, m in c["metricas"].items():
        tipo = a["metricas"][nombre]
        ra, rb = m["a"], m["b"]
        celda = lambda r: f"{_num(tipo, r['valor'])} [{_num(tipo, r['ic'][0])}-{_num(tipo, r['ic'][1])}]"  # noqa: E731
        if m["dif"] is None:
            dif = "no comparable"
        else:
            lo, hi = m["ic_dif"]
            escala = 100 if tipo["tipo"] == "proporcion" else 1
            unidad = " pp" if tipo["tipo"] == "proporcion" else ""
            dif = f"{m['dif'] * escala:+.1f}{unidad} [{lo * escala:+.1f}, {hi * escala:+.1f}] · {m['veredicto']}"
            if "discordantes" in m:
                g, q = m["discordantes"]
                dif += f" · discordantes +{g}/-{q}, p={m['p_mcnemar']:.3f}"
        lineas.append(f"{nombre:<26}{celda(ra):>18}{celda(rb):>18}   {dif}")
        lineas.append(f"{'':<26}{'n=' + str(ra['n']):>18}{'n=' + str(rb['n']):>18}   {m['metodo']}")
    return "\n".join(lineas)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Regresión de prompts: guardar y comparar ejecuciones de las evals (sin modelo).")
    sub = ap.add_subparsers(dest="orden", required=True)
    pl = sub.add_parser("listar")
    pl.add_argument("--eval")
    pc = sub.add_parser("comparar")
    pc.add_argument("ficheros", nargs="*", type=Path, help="A y B; sin ellos, las dos últimas de --eval")
    pc.add_argument("--eval")
    args = ap.parse_args(argv)
    if args.orden == "listar":
        for r in ejecuciones(args.eval):
            e = leer(r)
            cortado = " (cortada)" if e.get("cortado") else ""
            print(f"{e['momento']}  {e['eval']:<18} {e['nivel']:<9} {e['motor']}/{e['modelo']} llamadas={e.get('llamadas')}"
                  f"{cortado}  {r.name}")
        return 0
    if len(args.ficheros) == 2:
        ra, rb = args.ficheros
    elif not args.ficheros and args.eval:
        rutas = ejecuciones(args.eval)
        if len(rutas) < 2:
            print(f"Hacen falta dos ejecuciones guardadas de {args.eval} y hay {len(rutas)}.")
            return 2
        ra, rb = rutas[-2], rutas[-1]
    else:
        print("Dame dos ficheros (A y B) o --eval para comparar las dos últimas.")
        return 2
    a, b = leer(ra), leer(rb)
    print(informe(comparar(a, b), a, b))
    return 0


if __name__ == "__main__":
    sys.exit(main())
