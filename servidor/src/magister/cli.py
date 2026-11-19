"""La orden `magister` (desde servidor/: `uv run magister ...`).

    magister fuentes crear --nombre apuntes --tipo pdf --confianza 3
    magister fuentes listar
    magister ingerir <ruta, carpeta o url> --fuente <nombre> [--tema <id>]
    magister reingerir --fuente vault --carpeta ~/vault [--tema <id>]
    magister indexar                       procesa recibidas y pendientes hasta «lista» y recalcula el apoyo
    magister indexar --activar v3          crea v3 (la activa sin bibliografía ni notas, ADR-0018), la activa y reindexa
    magister indexar --reintentar          además, vuelve a indexar lo que quedó en cuarentena al indexar
    magister indexar --en-seco [...]       dice qué haría y por qué, sin escribir nada (con --activar y --reintentar)
    magister indexar --indice v2           crea v2 (250 tokens, 25 de solape) al lado de v1, sin activarla
    magister versiones --duplicadas
    magister trocear --version <id> --solo-contar
    magister calidad [--semanas 8]
    magister exportar --salida <carpeta>
    magister borrar-todo [--confirmar] [--fuentes]
    magister prompts listar <nombre> | activar <nombre> <version>
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
            listas = await indexar_pendientes()
            print(f"Indexadas: {len(listas)} versiones")
            await recalcular_apoyo(listas)
    elif args.orden == "reingerir":
        f = await _fuente(args.fuente)
        print(await ingesta.reingerir(f.id, args.carpeta, args.tema))
        listas = await indexar_pendientes()
        print(f"Indexadas: {len(listas)} versiones")
        await recalcular_apoyo(listas)
    elif args.orden == "indexar":
        if args.en_seco:
            if args.indice:
                raise SystemExit("--en-seco no vale con --indice")
            for linea in await en_seco(args.activar, args.reintentar):
                print(linea)
            return
        if args.indice:
            await _indice_nuevo(args.indice)
        else:
            # Sin --activar, la activa: lo ya listo que no tenga sus fragmentos (por ejemplo, tras la migración que
            # activa v3) se reindexa con ella.
            reindexadas = await activar_config(args.activar)
            if args.reintentar:
                print(f"Vuelven a pendiente: {await reintentar_cuarentena()} versiones que no se pudieron indexar")
            listas = await indexar_pendientes()
            print(f"Indexadas: {len(listas)} versiones")
            await recalcular_apoyo(reindexadas + listas)
        async with nueva_sesion() as s:
            print(await rf.contar(s))
        print("Comprueba el índice: uv run python -m evals.recuperacion --estricto")
    elif args.orden == "versiones":
        await _duplicadas()
    elif args.orden == "trocear":
        await _trocear(args.version)
    elif args.orden == "calidad":
        await _calidad(args.semanas)
    elif args.orden == "exportar":
        from pathlib import Path

        from magister.datos.tus_datos import exportar

        cuentas = await exportar(Path(args.salida))
        print(f"Exportado a {args.salida}: " + ", ".join(f"{k} {v}" for k, v in cuentas.items() if v))
    elif args.orden == "borrar-todo":
        from magister.datos.tus_datos import borrar_todo

        cuentas = await borrar_todo(args.confirmar, args.fuentes)
        print(("Borrado: " if args.confirmar else "Borraría (añade --confirmar): ") + ", ".join(f"{k} {v}" for k, v in cuentas.items() if v))
    elif args.orden == "prompts":
        await _prompts(args.accion, args.nombre, args.version)


async def indexar_pendientes() -> list[int]:
    """Pasadas hasta que no quede nada recibido ni pendiente (cada pasada coge 20). Devuelve las versiones que
    quedaron listas."""
    from magister.fuentes import ingesta

    listas: list[int] = []

    async def apuntar(ids: list[int]) -> None:
        listas.extend(ids)

    while await ingesta.procesar_pendientes(apuntar):
        pass
    return listas


async def reintentar_cuarentena() -> int:
    """Devuelve a pendiente las versiones en cuarentena por un fallo al indexar (no las que no pasaron la validación:
    esas tienen el texto mal)."""
    from sqlalchemy import update

    from magister.datos.fuentes import Version
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s, s.begin():
        r = await s.execute(
            update(Version)
            .where(Version.estado == "cuarentena", Version.motivo.like("no se pudo indexar%"))
            .values(estado="pendiente", motivo=None)
        )
        return r.rowcount or 0


async def recalcular_apoyo(version_ids: list[int]) -> None:
    """Lo mismo que hace el bucle de la API al quedar versiones listas: el apoyo (lecciones_fragmentos) de los planes
    de sus temas."""
    if not version_ids:
        return
    from magister.flujo.fuentes import recalcular_apoyo_por_versiones
    from magister.fuentes.buscar import BuscadorHibrido
    from magister.fuentes.embeber import embeber

    if ajustes.embeddings == "local":
        # La búsqueda no espera a e5 más de unos segundos: sin él, el apoyo saldría por palabras.
        await asyncio.to_thread(embeber, ["calentar"], "consulta")
    await recalcular_apoyo_por_versiones(BuscadorHibrido(), version_ids)
    print(f"Apoyo de las lecciones recalculado ({len(version_ids)} versiones)")


async def activar_config(nombre: str | None) -> list[int]:
    """Crea (si no existe) la configuración `nombre` como la activa más `secciones_fuera` (ADR-0018), la activa y
    reindexa con ella las versiones ya listas que no tengan sus fragmentos. La anterior no se edita: sus fragmentos
    se quedan a un lado. Si ya existe (la crea la migración), solo la activa. Sin `nombre`, la activa."""
    from sqlalchemy import select, update

    from magister.datos import repositorio_fuentes as rf
    from magister.datos.fuentes import Configuracion, Fragmento, Version
    from magister.datos.sesion import nueva_sesion
    from magister.fuentes import ingesta
    from magister.fuentes.trocear import SECCIONES_FUERA

    async with nueva_sesion() as s, s.begin():
        if nombre is None:
            activa = await rf.configuracion(s)
            if activa is None:
                raise SystemExit("No hay ninguna configuración del índice activa.")
            nombre = activa.nombre
        conf = await rf.configuracion(s, nombre)
        if conf is None:
            base = await rf.configuracion(s)
            params = {**(base.params if base else {}), "secciones_fuera": SECCIONES_FUERA}
            conf = Configuracion(nombre=nombre, params=params, activa=False)
            s.add(conf)
            await s.flush()
            print(f"Configuración {nombre} creada: {params}")
        if not conf.activa:
            await s.execute(update(Configuracion).where(Configuracion.activa.is_(True)).values(activa=False))
            await s.execute(update(Configuracion).where(Configuracion.id == conf.id).values(activa=True))
            print(f"Configuración {nombre} activa")
        con_fragmentos = select(Fragmento.version_id).where(Fragmento.config_id == conf.id)
        listas = (await s.scalars(select(Version.id).where(Version.estado == "lista", Version.id.not_in(con_fragmentos)))).all()
    for vid in listas:
        await ingesta.indexar_version(vid, nombre)
    if listas:
        print(f"{len(listas)} versiones ya listas reindexadas con {nombre}")
    return list(listas)


async def en_seco(activar: str | None, reintentar: bool) -> list[str]:
    """Qué haría `magister indexar` con estas opciones, y por qué, sin escribir nada: solo SELECT y trocear en memoria.
    Devuelve las líneas que se imprimen."""
    from sqlalchemy import select

    from magister.datos import plan as dp
    from magister.datos import repositorio_fuentes as rf
    from magister.datos.fuentes import Configuracion, Documento, Fragmento, Fuente, Version
    from magister.datos.sesion import nueva_sesion
    from magister.fuentes import ingesta
    from magister.fuentes.trocear import SECCIONES_FUERA, trocear

    lineas = ["Modo en seco: no escribo nada en la base."]
    async with nueva_sesion() as s:
        activa = await rf.configuracion(s)
        destino = await rf.configuracion(s, activar) if activar else activa
        if destino is None and not activar:
            return [*lineas, "No hay ninguna configuración del índice activa: no podría indexar."]
        if destino is None:
            params = {**(activa.params if activa else {}), "secciones_fuera": SECCIONES_FUERA}
            nombre, config_id = activar, None
            lineas.append(f"Crearía la configuración {activar}: la activa ({activa.nombre if activa else 'ninguna'}) "
                          "sin bibliografía ni notas, y la activaría.")
        else:
            params, nombre, config_id = destino.params, destino.nombre, destino.id
            if destino.activa:
                lineas.append(f"La configuración {nombre} ya está activa: no cambiaría de configuración.")
            else:
                lineas.append(f"Activaría la configuración {nombre} (ahora está activa {activa.nombre if activa else 'ninguna'}).")
        nombres = {c.id: c.nombre for c in (await s.scalars(select(Configuracion))).all()}
        filas = (await s.execute(
            select(Version.id, Version.estado, Version.motivo, Version.texto, Version.crudo_hash, Version.crudo_tipo,
                   Version.metadatos, Documento.titulo, Fuente.tipo)
            .join(Documento, Documento.id == Version.documento_id).join(Fuente, Fuente.id == Documento.fuente_id)
            .where(Version.estado.in_(("recibida", "pendiente", "lista", "cuarentena"))).order_by(Version.id)
        )).all()
        configs_de: dict[int, set[int]] = {}
        for vid, cid in (await s.execute(select(Fragmento.version_id, Fragmento.config_id).distinct())).all():
            configs_de.setdefault(vid, set()).add(cid)
        temas = {f[0]: await rf.tema_de_version(s, f[0]) for f in filas}
        planes = await dp.planes_aceptados(s)

    hara: list[tuple[int, str, str, int | None]] = []  # (versión, título, por qué, trozos)
    ya_listas, sin_reintentar, apartadas = 0, 0, 0
    for vid, estado, motivo, texto, crudo_hash, crudo_tipo, metadatos, titulo, tipo in filas:
        otras = sorted(nombres.get(c, str(c)) for c in configs_de.get(vid, set()) if c != config_id)
        if estado == "lista":
            if config_id is not None and config_id in configs_de.get(vid, set()):
                ya_listas += 1
                continue
            porque = f"tiene fragmentos de otra configuración ({', '.join(otras)})" if otras else "está lista pero sin fragmentos"
        elif estado == "pendiente":
            porque = "nunca indexada"
        elif estado == "recibida":
            porque = "recibida, sin extraer: se extraería antes"
            try:
                crudo = await asyncio.to_thread(ingesta.leer_crudo, crudo_hash)
                e, _, problemas, _ = await asyncio.to_thread(ingesta._preparar, crudo, (metadatos or {}).get("nombre", "documento"), crudo_tipo)
            except Exception as ex:  # noqa: BLE001
                hara.append((vid, titulo, f"{porque}; no se podría extraer ({ex})", None))
                continue
            if problemas:
                apartadas += 1
                hara.append((vid, titulo, f"{porque}; se apartaría al validarla ({problemas[0].motivo})", 0))
                continue
            texto = e.texto
        elif (motivo or "").startswith("no se pudo indexar") and texto is not None:
            if not reintentar:
                sin_reintentar += 1
                continue
            porque = f"en cuarentena por un fallo nuestro al indexar ({motivo[:80]})"
        else:
            continue  # cuarentena por el texto (casi vacío, escaneado): reindexar no lo arregla
        trozos = len(await asyncio.to_thread(trocear, texto or "", titulo, tipo, params)) if texto else 0
        hara.append((vid, titulo, porque, trozos))

    total = sum(t or 0 for *_, t in hara)
    lineas.append(f"Indexaría {len(hara)} versiones con {nombre}, unos {total} fragmentos en total:")
    for vid, titulo, porque, trozos in hara:
        lineas.append(f"  {vid}  «{titulo}»: {porque} · {trozos if trozos is not None else '?'} fragmentos")
    lineas.append(f"No tocaría {ya_listas} versiones ya listas con {nombre}.")
    if sin_reintentar:
        lineas.append(f"{sin_reintentar} versiones en cuarentena por un fallo al indexar se quedan así: añade --reintentar.")
    if apartadas:
        lineas.append(f"{apartadas} de ellas se quedarían en cuarentena al validarlas.")
    afectados = {temas[vid] for vid, *_ in hara}
    n_planes = sum(1 for p, _ in planes if None in afectados or p.tema_id in afectados) if hara else 0
    lineas.append(f"Después recalcularía el apoyo de las lecciones de {n_planes} planes aceptados.")
    return lineas


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


async def _prompts(accion: str, nombre: str, version: str | None) -> None:
    from sqlalchemy import select, update

    from magister.api.instalacion import sincronizar_prompts
    from magister.datos.produccion import PromptActivo, PromptVersion
    from magister.datos.sesion import nueva_sesion

    await sincronizar_prompts()
    async with nueva_sesion() as s, s.begin():
        activa = await s.scalar(select(PromptActivo.version).where(PromptActivo.nombre == nombre))
        if accion == "activar":
            if not await s.get(PromptVersion, (nombre, version)):
                raise SystemExit(f"No existe la versión {version} de {nombre}")
            await s.execute(update(PromptActivo).where(PromptActivo.nombre == nombre).values(version=version))
            print(f"{nombre}: activa la {version} (antes {activa}). Reinicia la API para que la use.")
            return
        for v, creada in (await s.execute(select(PromptVersion.version, PromptVersion.creada)
                                         .where(PromptVersion.nombre == nombre).order_by(PromptVersion.creada))).all():
            print(f"{'*' if v == activa else ' '} {v}  {creada:%Y-%m-%d %H:%M}")


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
    x.add_argument("--activar", metavar="NOMBRE", help="crea la configuración sin bibliografía (ADR-0018) y la activa")
    x.add_argument("--reintentar", action="store_true", help="vuelve a indexar lo que quedó en cuarentena al indexar")
    x.add_argument("--en-seco", action="store_true", help="dice qué haría y por qué, sin escribir nada")
    v = sub.add_parser("versiones")
    v.add_argument("--duplicadas", action="store_true")
    t = sub.add_parser("trocear")
    t.add_argument("--version", type=int, required=True)
    t.add_argument("--solo-contar", action="store_true")
    c = sub.add_parser("calidad")
    c.add_argument("--semanas", type=int, default=8)
    e = sub.add_parser("exportar")
    e.add_argument("--salida", required=True)
    b = sub.add_parser("borrar-todo")
    b.add_argument("--confirmar", action="store_true")
    b.add_argument("--fuentes", action="store_true")
    pr = sub.add_parser("prompts")
    pr.add_argument("accion", choices=["listar", "activar"])
    pr.add_argument("nombre")
    pr.add_argument("version", nargs="?")
    args = ap.parse_args()
    if args.orden == "fuentes" and args.accion == "crear" and not (args.nombre and args.tipo and args.confianza):
        ap.error("fuentes crear necesita --nombre, --tipo y --confianza")
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    _ = ajustes
    asyncio.run(principal(args))


if __name__ == "__main__":
    main()
