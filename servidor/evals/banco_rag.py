"""El banco de preguntas del retriever.

    uv run python -m evals.banco_rag sintetico --n 60     genera preguntas desde fragmentos al azar y las revisas
    uv run python -m evals.banco_rag comprobar            ids que existan en versiones «lista» y reparto por documento
    uv run python -m evals.banco_rag hash

Las preguntas sintéticas prohíben copiar las palabras clave del fragmento (si no, el banco
favorece a la vía léxica). Mézclalas con preguntas reales tuyas y algunas sin respuesta.
"""

import argparse
import asyncio
import hashlib
import json
import random
import sys
from collections import Counter

from pydantic import BaseModel
from sqlalchemy import text

from evals.rag import BANCO
from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.datos.sesion import nueva_sesion

SISTEMA = """Escribes una pregunta de examen que el fragmento dado responda, y su respuesta de referencia.
Regla: la pregunta NO puede copiar las palabras clave del fragmento; dila con otras palabras, como la haría
alguien que no ha leído el texto. En español de España."""


class Pregunta(BaseModel):
    pregunta: str
    referencia: str


async def sintetico(n: int, revisar: bool) -> None:
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select f.id, f.texto, f.version_id, f.inicio, f.fin, d.fuente_id, d.tema_id from fragmentos f "
            "join versiones v on v.id = f.version_id join documentos d on d.id = v.documento_id "
            "join configuraciones c on c.id = f.config_id where v.estado = 'lista' and c.activa and length(f.texto) > 200"
        ))).all()
    if not filas:
        raise SystemExit("No hay fragmentos indexados: ingiere algo primero.")
    por_estrato: dict = {}
    for f in filas:
        por_estrato.setdefault((f[5], f[6]), []).append(f)
    rng = random.Random(7)
    elegidos = []
    while len(elegidos) < min(n, len(filas)):
        for grupo in por_estrato.values():
            if grupo and len(elegidos) < n:
                elegidos.append(grupo.pop(rng.randrange(len(grupo))))
    existentes = BANCO.read_text(encoding="utf-8").splitlines() if BANCO.exists() else []
    siguiente = len(existentes) + 1
    with BANCO.open("a", encoding="utf-8") as salida:
        for fid, texto, vid, ini, fin, *_ in elegidos:
            try:
                p = await estructurar(SISTEMA, f"<fragmento>\n{texto}\n</fragmento>", Pregunta)
            except ErrorEstructura:
                continue
            if revisar:
                print(f"\n[{fid}] {texto[:300]}…\n  P: {p.pregunta}\n  R: {p.referencia}")
                op = input("  ¿(a)ceptar, (e)ditar, (t)irar? ").strip().lower()
                if op.startswith("t"):
                    continue
                if op.startswith("e"):
                    p.pregunta = input("  Pregunta: ").strip() or p.pregunta
            fila = {"id": f"s{siguiente}", "pregunta": p.pregunta, "relevantes": [fid], "pasaje": [vid, ini, fin],
                    "referencia": p.referencia, "origen": "sintetica"}
            salida.write(json.dumps(fila, ensure_ascii=False) + "\n")
            siguiente += 1
    print(f"Banco: {BANCO}")


async def comprobar() -> None:
    filas = [json.loads(x) for x in BANCO.read_text(encoding="utf-8").splitlines() if x.strip()]
    ids = sorted({i for f in filas for i in f.get("relevantes", [])})
    async with nueva_sesion() as s:
        vivos = (await s.execute(text(
            "select f.id, d.titulo from fragmentos f join versiones v on v.id = f.version_id "
            "join documentos d on d.id = v.documento_id where f.id = any(:i) and v.estado = 'lista'"
        ), {"i": ids})).all()
    vivos_d = dict(vivos)
    malos = [i for i in ids if i not in vivos_d]
    print(f"{len(filas)} preguntas · {Counter(f.get('origen') for f in filas)}")
    print(f"Ids inexistentes o no «lista»: {malos or 'ninguno'}")
    print(f"Documentos distintos: {len(set(vivos_d.values()))}")
    if malos:
        raise SystemExit(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("orden", choices=["sintetico", "comprobar", "hash"])
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--sin-revisar", action="store_true")
    args = ap.parse_args()
    if args.orden == "hash":
        print(hashlib.sha256(BANCO.read_bytes()).hexdigest())
        return
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(sintetico(args.n, not args.sin_revisar) if args.orden == "sintetico" else comprobar())


if __name__ == "__main__":
    main()
