"""Exportar los datos para afinar un modelo al tono (Parte VI, «Datos desde los apuntes aprobados»).

    uv run python -m evals.exportar_afinado --salida ../afinar/datos/

- sft.jsonl: conversaciones {messages: [sistema, usuario (contrato del bloque y fragmentos), asistente (bloque aceptado)]}.
- División por lección (80/10/10, semilla apuntada); las lecciones del banco de tono van todas a prueba.
- Se descarta lo que tenga datos personales (detector de la Parte VI).
- manifiesto.json con el SHA-256 de cada fichero.
Los pares de preferencia (chosen/rejected) necesitan guardar la versión suspendida de cada
bloque: el generador de la Parte IV solo guarda la aceptada, así que quedan pendientes.
"""

import argparse
import asyncio
import hashlib
import json
import random
import sys
from pathlib import Path

from sqlalchemy import text

from magister.datos.sesion import nueva_sesion
from magister.seguridad.salida import datos_personales

SISTEMA = "Eres el tutor de Magister: escribes apuntes en español de España, con prosa que razona, sin relleno y sin condescendencia."
SEMILLA = 20261115


async def principal(salida: Path) -> None:
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select m.plan_id, m.leccion_clave, m.contrato, b.clave, b.titulo, b.texto from bloques_material b "
            "join materiales m on m.id = b.material_id where m.tipo = 'apuntes' and m.estado in ('listo', 'revisar') "
            "and not b.marcado"))).all()
        en_banco = {(p, c) for p, c in (await s.execute(text(
            "select distinct m.plan_id, m.leccion_clave from banco_tono t join materiales m on m.id = t.material_id"))).all()}
    lecciones = sorted({(p, c) for p, c, *_ in filas} - en_banco)
    rng = random.Random(SEMILLA)
    rng.shuffle(lecciones)
    n = len(lecciones)
    reparto = {x: "entrenamiento" for x in lecciones[: int(0.8 * n)]}
    reparto.update({x: "validacion" for x in lecciones[int(0.8 * n) : int(0.9 * n)]})
    reparto.update({x: "prueba" for x in lecciones[int(0.9 * n) :]})
    reparto.update({x: "prueba" for x in en_banco})
    salida.mkdir(parents=True, exist_ok=True)
    ficheros = {k: (salida / f"sft-{k}.jsonl").open("w", encoding="utf-8") for k in ("entrenamiento", "validacion", "prueba")}
    descartados = 0
    for plan, clave, contrato, bclave, titulo, texto in filas:
        if datos_personales(texto):
            descartados += 1
            continue
        b = next((x for x in (contrato or {}).get("bloques", []) if x["clave"] == bclave), {})
        usuario = f"Bloque {bclave}: {titulo}\nPropósito: {b.get('proposito', '')}\nConceptos: {', '.join(b.get('conceptos', []))}"
        ejemplo = {"messages": [{"role": "system", "content": SISTEMA}, {"role": "user", "content": usuario},
                                {"role": "assistant", "content": texto}], "leccion": f"{plan}-{clave}"}
        ficheros[reparto.get((plan, clave), "entrenamiento")].write(json.dumps(ejemplo, ensure_ascii=False) + "\n")
    for f in ficheros.values():
        f.close()
    manifiesto = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(salida.glob("*.jsonl"))}
    manifiesto["semilla"] = SEMILLA
    (salida / "manifiesto.json").write_text(json.dumps(manifiesto, indent=1), encoding="utf-8")
    print(f"{len(filas) - descartados} ejemplos en {n + len(en_banco)} lecciones · {descartados} descartados por datos personales")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default="../afinar/datos")
    if sys.platform == "win32":
        import asyncio as _a

        _a.set_event_loop_policy(_a.WindowsProactorEventLoopPolicy())
    asyncio.run(principal(Path(ap.parse_args().salida)))
