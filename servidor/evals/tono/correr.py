"""El harness del tono: evalúa el prompt actual de los bloques o lo compara con una variante.

    uv run python -m evals.tono.correr                       corto: 5 bloques, tope 15 llamadas
    uv run python -m evals.tono.correr --nivel completo      toda la partición `validar`, tope 300
    uv run python -m evals.tono.correr --variante src/magister/cerebro/prompts/experimentos/apuntes_bloque_trato.md

Sobre la partición `validar`: regenera cada bloque con su contrato (solo si no hay salida
guardada para ese SHA-256), aplica lint y juez y saca por dimensión la tasa de aprobados,
la longitud media y la kappa contra tus etiquetas. Con --variante: discordantes, McNemar,
binomial exacta, bootstrap pareado y no inferioridad (margen de 5 puntos, ADR del guardián).
"""

import argparse
import hashlib
import json
from pathlib import Path

from evals import regresion, tope
from evals.estadistica import binomial_cola, bootstrap_pareado, kappa, mcnemar, tabla_de
from evals.tono.comun import RESULTADOS, bloques_de, etiquetas
from magister.cerebro.modelo import Turno, generar
from magister.cerebro.prompts import cargar
from magister.tono.juez import DIMENSIONES, FalloJuez, juzgar
from magister.tono.lint import revisar, vetos

MARGEN = 0.05
BLOQUES_CORTO = 5
CACHE = RESULTADOS / "tono-salidas"


async def regenerar(plantilla: str, version: str, bloque: dict) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    ruta = CACHE / f"{version}-{bloque['material_id']}-{bloque['clave']}.md"
    if ruta.exists():
        return ruta.read_text(encoding="utf-8")
    sistema = (f"{plantilla}\n\n<bloque_original_para_reescribir>\n{bloque['texto']}\n</bloque_original_para_reescribir>"
               if "{" in plantilla else plantilla)
    texto = "".join([t async for t in generar(sistema.replace("{", "(").replace("}", ")"), [Turno("usuario", "Escribe el bloque.")])])
    ruta.write_text(texto, encoding="utf-8")
    return texto


async def evaluar(plantilla: str, bloques: list[dict], t: tope.Tope | None = None) -> list[dict]:
    """Con `t`, se para limpio al llegar al tope: devuelve los bloques que le dio tiempo a evaluar."""
    version = hashlib.sha256(plantilla.encode()).hexdigest()[:12]
    salida = []
    for b in bloques:
        try:
            texto = await regenerar(plantilla, version, b)
            j = await juzgar(texto, [h for h in revisar(texto) if h.gravedad == "sospecha"])
        except tope.TopeAlcanzado:
            if t is not None:
                t.cortado = True
            break
        salida.append({"bloque": [b["material_id"], b["clave"]], "version": version, "longitud": len(texto.split()),
                       "vetos": len(vetos(revisar(texto))),
                       "veredicto": None if isinstance(j, FalloJuez) else {d: getattr(j.veredicto, d).aprueba for d in DIMENSIONES}})
    return salida


def resumen(filas: list[dict], mias: dict) -> None:
    validas = [f for f in filas if f["veredicto"]]
    for d in DIMENSIONES:
        tasa = sum(f["veredicto"][d] for f in validas) / len(validas) if validas else 0
        pares = [(mias[(f["bloque"][0], f["bloque"][1], d)], f["veredicto"][d]) for f in validas if (f["bloque"][0], f["bloque"][1], d) in mias]
        k = kappa(tabla_de([a for a, _ in pares], [b for _, b in pares], [True, False])) if pares else float("nan")
        print(f"{d:<13} aprueba {tasa:.0%}  kappa {k:.2f} (n={len(pares)})")
    print(f"longitud media {sum(f['longitud'] for f in filas) / max(1, len(filas)):.0f} palabras · vetos {sum(f['vetos'] for f in filas)}")


def metricas(filas: list[dict]) -> dict:
    """Para `evals.regresion`: por dimensión, si el juez aprueba cada bloque (los FalloJuez no cuentan)."""
    return {d: regresion.proporcion({f"{f['bloque'][0]}/{f['bloque'][1]}": (int(f["veredicto"][d]), 1)
                                     for f in filas if f["veredicto"]}) for d in DIMENSIONES}


async def principal(args) -> None:
    t = args.tope
    bloques = tope.del_nivel(await bloques_de("validar"), args.nivel, BLOQUES_CORTO)
    if not bloques:
        raise SystemExit("No hay partición validar: reparte el banco desde el panel Etiquetar.")
    mias = await etiquetas(1)
    plantilla = cargar("apuntes_bloque")
    actual = plantilla.texto
    a = await evaluar(actual, bloques, t)
    print("Actual:")
    resumen(a, mias)
    filas = a
    prompts = regresion.versiones(["apuntes_bloque", "juez_tono"])
    if a:
        ej = regresion.ejecucion("tono", args.nivel, prompts, metricas(a), t)
        print(f"Guardada para comparar: {regresion.guardar(ej)}")
    if args.variante:
        texto_variante = Path(args.variante).read_text(encoding="utf-8")
        b = await evaluar(texto_variante, bloques, t)
        print("\nVariante:")
        resumen(b, mias)
        if b:
            # La variante se guarda como otra ejecución de la misma eval: `evals.regresion comparar --eval tono` la
            # compara con la actual, caso a caso.
            variante = {**prompts, "apuntes_bloque": hashlib.sha256(texto_variante.encode()).hexdigest()[:12]}
            print(f"Guardada para comparar: {regresion.guardar(regresion.ejecucion('tono', args.nivel, variante, metricas(b), t))}")
        for d in DIMENSIONES:
            # Solo los bloques que las dos llegaron a evaluar (el tope puede cortar la variante antes).
            pares = [(x["veredicto"][d], y["veredicto"][d]) for x, y in zip(a, b, strict=False) if x["veredicto"] and y["veredicto"]]
            gana = sum(1 for x, y in pares if not x and y)
            pierde = sum(1 for x, y in pares if x and not y)
            dif, lo, hi = bootstrap_pareado([(float(x), float(y)) for x, y in pares], 5000) if pares else (0, 0, 0)
            print(f"{d:<13} discordantes +{gana}/-{pierde} · McNemar {mcnemar(gana, pierde):.2f} · "
                  f"binomial p={binomial_cola(max(gana, pierde), gana + pierde):.3f} · dif {dif:+.2f} [{lo:+.2f}, {hi:+.2f}] · "
                  f"no inferior: {'sí' if lo > -MARGEN else 'no'}")
        filas = a + b
    RESULTADOS.mkdir(exist_ok=True)
    ruta = RESULTADOS / f"tono-{a[0]['version'] if a else 'x'}.jsonl"
    ruta.write_text("\n".join(json.dumps(f, ensure_ascii=False) for f in filas), encoding="utf-8")
    print(f"\n{ruta}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--variante")
    # Por bloque: regenerarlo (1 llamada, 0 si ya está en la caché de disco) y juzgarlo (1, más 1 reintento). Con
    # --variante, el doble. Corto: 5 bloques de `validar`.
    tope.argumentos(ap, corto=15, completo=300)
    args = ap.parse_args()
    args.tope = tope.de_args(args)
    tope.correr(principal(args), args.tope)
