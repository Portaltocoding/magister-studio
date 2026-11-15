"""La orden `magister` (desde servidor/: `uv run magister ...`).

    magister fuentes crear --nombre apuntes --tipo pdf --confianza 3
    magister fuentes listar
    magister ingerir <ruta, carpeta o url> --fuente <nombre> [--tema <id>]
    magister reingerir --fuente vault --carpeta ~/vault [--tema <id>]
    magister indexar                       procesa recibidas y pendientes hasta «lista»
    magister indexar --indice v2           crea v2 (250 tokens, 25 de solape) al lado de v1, sin activarla
    magister versiones --duplicadas
    magister trocear --version <id> --solo-contar
    magister calidad [--semanas 8]
    magister ayuda
"""

import argparse
import asyncio
import statistics
import sys

from magister.config import ajustes

CHULETA = """Magister Studio · chuleta (desde servidor/)

  Arrancar           docker compose up -d   (en la raíz)
                     uv run alembic upgrade head
                     uv run uvicorn magister.api.app:app --port 8000
  Web                cd web && npm run dev  ->  http://localhost:5173
  Pruebas            uv run pytest -q
  Crear una fuente   uv run magister fuentes crear --nombre <n> --tipo vault|pdf|libro|web --confianza 1|2|3
  Ingerir            uv run magister ingerir <ruta o url> --fuente <nombre> [--tema <id>]
  Reingerir          uv run magister reingerir --fuente <nombre> --carpeta <ruta>
  Indexar            uv run magister indexar
  Buscar a mano      curl "localhost:8000/api/buscar?q=...&via=hibrida"
  Medir el plan      uv run python -m evals.correr
  Medir el RAG       uv run python -m evals.rag --tabla
  Research           uv run python -m magister.research.agente --plan <id> --leccion <clave>
"""


async def _fuente(nombre: str):
    from magister.datos import repositorio_fuentes as rf
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        f = await rf.fuente_por_nombre(s, nombre)
    if f is None:
        raise SystemExit(f"No existe la fuente «{nombre}». Créala con: magister fuentes crear --nombre {nombre} ...")
    return f


def _resumen(resultados) -> None:
    cuenta: dict[str, int] = {}
    for r in resultados:
        cuenta[r.salida] = cuenta.get(r.salida, 0) + 1
    print("Resumen:", ", ".join(f"{k} {v}" for k, v in sorted(cuenta.items())) or "nada")
    for r in resultados:
        if r.salida in ("cuarentena", "error"):
            print(f"  {r.salida}: {r.uri} · {r.motivo}")


async def principal(args: argparse.Namespace) -> None:
    from magister.datos import repositorio_fuentes as rf
    from magister.datos.sesion import nueva_sesion
    from magister.fuentes import ingesta

    if args.orden == "ayuda":
        print(CHULETA)
    elif args.orden == "fuentes":
        async with nueva_sesion() as s:
            if args.accion == "crear":
                f = await rf.crear_fuente(s, args.nombre, args.tipo, args.confianza)
                print(f"Fuente {f.id} «{f.nombre}» ({f.tipo}, confianza {f.confianza})")
            for f in await rf.listar_fuentes(s):
                print(f"{f.id:>3}  {f.nombre:<20} {f.tipo:<6} confianza {f.confianza}")
    elif args.orden == "ingerir":
        f = await _fuente(args.fuente)
        resultados = await ingesta.ingerir_ruta(f.id, args.ruta, args.tema)
        _resumen(resultados)
        if not args.sin_indexar:
            n = await ingesta.procesar_pendientes()
            print(f"Indexadas: {n} versiones")
    elif args.orden == "reingerir":
        f = await _fuente(args.fuente)
        print(await ingesta.reingerir(f.id, args.carpeta, args.tema))
        await ingesta.procesar_pendientes()
    elif args.orden == "indexar":
        if args.indice:
            await _indice_nuevo(args.indice)
        else:
            print(f"Indexadas: {await ingesta.procesar_pendientes()} versiones")
        async with nueva_sesion() as s:
            print(await rf.contar(s))
    elif args.orden == "versiones":
        await _duplicadas()
    elif args.orden == "trocear":
        await _trocear(args.version)
    elif args.orden == "calidad":
        await _calidad(args.semanas)


async def _indice_nuevo(nombre: str) -> None:
    from sqlalchemy import select

    from magister.datos import repositorio_fuentes as rf
    from magister.datos.fuentes import Configuracion, Version
    from magister.datos.sesion import nueva_sesion
    from magister.fuentes import ingesta

    async with nueva_sesion() as s, s.begin():
        if await rf.configuracion(s, nombre) is None:
            base = await rf.configuracion(s)
            params = {**(base.params if base else {}), "tokens": 250, "solape": 25}
            s.add(Configuracion(nombre=nombre, params=params, activa=False))
            print(f"Configuración {nombre} creada: {params}")
        listas = (await s.scalars(select(Version.id).where(Version.estado == "lista"))).all()
    for vid in listas:
        await ingesta.indexar_version(vid, nombre)
    print(f"{len(listas)} versiones indexadas con {nombre} (sin activar)")


async def _duplicadas() -> None:
    from sqlalchemy import text

    from magister.datos.sesion import nueva_sesion
    from magister.fuentes.duplicados import jaccard

    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select v.id, v.texto, d.titulo, o.id, o.texto, od.titulo from versiones v "
            "join documentos d on d.id = v.documento_id join versiones o on o.id = v.duplicado_de "
            "join documentos od on od.id = o.documento_id"
        ))).all()
    if not filas:
        print("No hay versiones marcadas como duplicadas.")
    for vid, t1, d1, oid, t2, d2 in filas:
        print(f"{vid} «{d1}»  duplicado de  {oid} «{d2}»  · Jaccard {jaccard(t1 or '', t2 or ''):.2f}")


async def _trocear(version_id: int) -> None:
    from magister.datos import repositorio_fuentes as rf
    from magister.datos.fuentes import Documento, Fuente, Version
    from magister.datos.sesion import nueva_sesion
    from magister.fuentes.embeber import contar_tokens
    from magister.fuentes.trocear import trocear

    async with nueva_sesion() as s:
        v = await s.get(Version, version_id)
        d = await s.get(Documento, v.documento_id)
        f = await s.get(Fuente, d.fuente_id)
        conf = await rf.configuracion(s)
    trozos = trocear(v.texto or "", d.titulo, f.tipo, conf.params)
    largos = [contar_tokens(t.texto) for t in trozos]
    print(f"{len(trozos)} fragmentos · tokens mín {min(largos)}, mediana {statistics.median(largos)}, máx {max(largos)}")


async def _calidad(semanas: int) -> None:
    from sqlalchemy import text

    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select fu.nombre, date_trunc('week', v.ingerida_en)::date as semana, count(*), "
            "count(*) filter (where v.estado = 'cuarentena'), count(*) filter (where v.duplicado_de is not null), "
            "coalesce(percentile_cont(0.5) within group (order by length(v.texto)), 0) "
            "from versiones v join documentos d on d.id = v.documento_id join fuentes fu on fu.id = d.fuente_id "
            "where v.ingerida_en > now() - make_interval(weeks => :n) group by 1, 2 order by 1, 2"
        ), {"n": semanas})).all()
    print(f"{'fuente':<20}{'semana':<12}{'ingeridos':>10}{'cuarentena':>12}{'duplicados':>12}{'long. mediana':>15}")
    medianas: dict[str, list[int]] = {}
    for nombre, semana, n, cuar, dup, med in filas:
        medianas.setdefault(nombre, []).append(cuar)
        aviso = "  ⚠ cuarentena alta" if cuar > 2 * max(1, statistics.median(medianas[nombre])) else ""
        print(f"{nombre:<20}{semana!s:<12}{n:>10}{cuar:>12}{dup:>12}{int(med):>15}{aviso}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="magister", description="Magister Studio desde la terminal")
    sub = ap.add_subparsers(dest="orden", required=True)
    sub.add_parser("ayuda")
    f = sub.add_parser("fuentes")
    f.add_argument("accion", choices=["crear", "listar"])
    f.add_argument("--nombre")
    f.add_argument("--tipo", choices=["vault", "pdf", "libro", "web", "audio"])
    f.add_argument("--confianza", type=int, choices=[1, 2, 3])
    i = sub.add_parser("ingerir")
    i.add_argument("ruta")
    i.add_argument("--fuente", required=True)
    i.add_argument("--tema", type=int)
    i.add_argument("--sin-indexar", action="store_true")
    r = sub.add_parser("reingerir")
    r.add_argument("--fuente", required=True)
    r.add_argument("--carpeta", required=True)
    r.add_argument("--tema", type=int)
    x = sub.add_parser("indexar")
    x.add_argument("--indice")
    v = sub.add_parser("versiones")
    v.add_argument("--duplicadas", action="store_true")
    t = sub.add_parser("trocear")
    t.add_argument("--version", type=int, required=True)
    t.add_argument("--solo-contar", action="store_true")
    c = sub.add_parser("calidad")
    c.add_argument("--semanas", type=int, default=8)
    args = ap.parse_args()
    if args.orden == "fuentes" and args.accion == "crear" and not (args.nombre and args.tipo and args.confianza):
        ap.error("fuentes crear necesita --nombre, --tipo y --confianza")
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    _ = ajustes
    asyncio.run(principal(args))


if __name__ == "__main__":
    main()
