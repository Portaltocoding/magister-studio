"""Tus datos: exportarlos todos y borrarlos (Parte VI, «El registro de datos y la ficha del sistema»)."""

import asyncio
import json
import os
import re
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from sqlalchemy import text

from magister.config import ajustes
from magister.datos.sesion import nueva_sesion

TABLAS = ["temas", "conversaciones", "mensajes", "mensajes_citas", "planes", "lecciones", "conceptos", "dependencias", "sesiones",
          "materiales", "bloques_material", "preguntas", "preguntas_concepto", "intentos", "servidas", "etiquetas",
          "llamadas", "puntuaciones", "candidatos_banco", "eventos", "notas", "examenes", "proyectos",
          "proyecto_decisiones", "asesor_cambios", "propuestas", "tareas_research", "lecciones_apoyo",
          "lecciones_fragmentos", "banco_tono"]
# Las tablas que no son tuyas: de la instalación (el canario está en `instalacion`), la cola, cachés y avisos.
# Toda tabla está en TABLAS, en FUENTES o aquí (lo comprueba un test): así una nueva no se queda fuera sin decidirlo.
NO_SON_DEL_USUARIO = ["alembic_version", "instalacion", "configuraciones", "prompts_activos", "prompts_versiones",
                      "trabajadores", "trabajos", "cache_respuestas", "alertas"]
# Lo que borra `borrar-todo` (las fuentes, solo con --fuentes). El orden respeta las claves foráneas.
BORRAR = ["asesor_cambios", "proyecto_decisiones", "proyectos", "notas", "examenes", "candidatos_banco", "puntuaciones", "llamadas", "servidas", "intentos", "etiquetas", "banco_tono", "preguntas_concepto",
          "preguntas", "bloques_material", "materiales", "trabajos", "propuestas", "tareas_research", "lecciones_apoyo",
          "lecciones_fragmentos", "sesiones", "dependencias", "conceptos", "lecciones", "planes", "mensajes_citas", "mensajes",
          "conversaciones", "temas", "cache_respuestas", "alertas", "eventos"]
FUENTES = ["busquedas", "fragmentos", "versiones", "documentos", "fuentes"]

LEEME = """Exportación de Magister Studio

Un fichero JSON por tabla, con todas sus filas. Lo principal:
- conversaciones.json y mensajes.json: tus conversaciones con el tutor (rol, contenido, estado y tiempos).
- planes.json: tus planes, con tu perfil de estudio (perfil) en cada versión; lecciones, conceptos y sesiones del calendario.
- materiales.json, bloques_material.json y preguntas.json: los apuntes, diapositivas, guiones y fichas generados.
- intentos.json: cada respuesta tuya en el repaso, con la nota del corrector, tu nota si la corregiste, tu confianza y la latencia.
- servidas.json: lo que el tutor apostaba (p_predicha) antes de cada pregunta.
- llamadas.json y puntuaciones.json: el registro de llamadas al modelo (tokens, tiempos) y sus métricas.
- notas.json y examenes.json: Mis notas y tus exámenes y evaluaciones.
- proyectos.json, proyecto_decisiones.json y asesor_cambios.json: tus proyectos, su diario y los cambios del asesor.
- propuestas.json y tareas_research.json: las fuentes que se te propusieron y las búsquedas que las trajeron.
Las fuentes (documentos y fragmentos) no se exportan aquí: los originales están en servidor/crudo.
"""


def _a_json(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (UUID, Decimal)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return [_a_json(x) for x in v]
    if isinstance(v, str) and len(v) > 2000 and v.startswith("["):
        return v
    if hasattr(v, "tolist"):
        return v.tolist()
    return v


async def _existentes(s, tablas: list[str]) -> list[str]:
    """Las que ya están en la base: con una migración sin aplicar, exportar y borrar no fallan por una tabla nueva."""
    hay = set((await s.execute(text("select tablename from pg_tables where schemaname = current_schema()"))).scalars())
    return [t for t in tablas if t in hay]


async def exportar(carpeta: Path) -> dict[str, int]:
    # Las escrituras van en un hilo: la API también exporta (Descargar mis datos) y no puede parar el bucle.
    await asyncio.to_thread(carpeta.mkdir, parents=True, exist_ok=True)
    cuentas = {}
    async with nueva_sesion() as s:
        for t in await _existentes(s, TABLAS):
            filas = (await s.execute(text(f"select * from {t}"))).mappings().all()
            datos = [{k: _a_json(v) for k, v in f.items()} for f in filas]
            await asyncio.to_thread((carpeta / f"{t}.json").write_text,
                                    json.dumps(datos, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
            cuentas[t] = len(datos)
    await asyncio.to_thread((carpeta / "LEEME.txt").write_text, LEEME, encoding="utf-8")
    return cuentas


async def borrar_todo(confirmar: bool, fuentes: bool = False) -> dict[str, int]:
    cuentas = {}
    async with nueva_sesion() as s, s.begin():
        tablas = await _existentes(s, BORRAR + (FUENTES if fuentes else []))
        for t in tablas:
            cuentas[t] = await s.scalar(text(f"select count(*) from {t}"))
        if confirmar:
            await s.execute(text(f"truncate {', '.join(tablas)} restart identity cascade"))
    return cuentas


# --- Descargar mis datos (Ajustes): el paquete de `magister exportar` más tus ficheros, en un ZIP ---

# Las carpetas con ficheros tuyos que no están en la base (ajustes.salidas y ajustes.crudo).
CARPETAS_TUYAS = {"salidas": "los PDF, las diapositivas y los guiones generados",
                  "crudo": "los originales de tus fuentes, tal como se descargaron"}
LISTA_FUERA_MAX = 200


def _es_secreto(relativa: Path) -> bool:
    return any(p.lower().startswith(".env") or p.lower() in ("secretos", ".git") for p in relativa.parts)


def _ficheros_de(base: Path) -> list[tuple[Path, str]]:
    """Los ficheros normales de la carpeta: sin enlaces que salgan de ella ni nada que parezca un secreto."""
    if not base.is_dir():
        return []
    raiz = base.resolve()
    hay = []
    for f in sorted(base.rglob("*")):
        rel = f.relative_to(base)
        if f.is_symlink() or not f.is_file() or _es_secreto(rel) or raiz not in f.resolve().parents:
            continue
        hay.append((f, rel.as_posix()))
    return hay


def _contiene(f: Path, clave: bytes) -> bool:
    with open(f, "rb") as h:
        previo = b""
        while trozo := h.read(1 << 20):
            if clave in previo + trozo:
                return True
            previo = trozo[-len(clave):]
    return False


def _mb(n: int) -> str:
    return f"{n / 1024 / 1024:.1f}".replace(".", ",") + " MB"


def empaquetar(tablas: Path, destino: Path, carpetas: dict[str, Path], max_bytes: int, canario: str) -> dict:
    """El ZIP: las tablas exportadas y el LEEME en la raíz y, hasta `max_bytes` en total, los ficheros de cada carpeta
    en ficheros/<carpeta>/. Lo que no cabe se nombra en el LEEME y ningún fichero sale con el canario dentro.
    Síncrona (lee y comprime): se llama en un hilo."""
    clave = canario.encode() if canario else b""
    dentro: list[tuple[Path, str, int]] = []
    fuera: list[tuple[str, int]] = []
    usados = 0
    for nombre, base in carpetas.items():
        for f, rel in _ficheros_de(base):
            tam = f.stat().st_size
            if usados + tam > max_bytes:
                fuera.append((f"{nombre}/{rel}", tam))
                continue
            if clave and _contiene(f, clave):
                continue
            dentro.append((f, f"ficheros/{nombre}/{rel}", tam))
            usados += tam
    lineas = ["", "Tus ficheros (carpeta ficheros/):"]
    for nombre, base in carpetas.items():
        hay = any(arco.startswith(f"ficheros/{nombre}/") for _, arco, _ in dentro)
        lineas.append(f"- ficheros/{nombre}: {CARPETAS_TUYAS.get(nombre, nombre)}." + ("" if hay else " No hay ninguno."))
    lineas.append(f"Entran hasta {_mb(max_bytes)} de ficheros en total (MAGISTER_EXPORTAR_MAX_MB).")
    if fuera:
        lineas.append(f"Se han quedado fuera por tamaño {len(fuera)} ficheros ({_mb(sum(t for _, t in fuera))}); "
                      "siguen en tu equipo, en las carpetas salidas y servidor/crudo:")
        lineas += [f"- {ruta} ({_mb(tam)})" for ruta, tam in fuera[:LISTA_FUERA_MAX]]
        if len(fuera) > LISTA_FUERA_MAX:
            lineas.append(f"- y {len(fuera) - LISTA_FUERA_MAX} más.")
    else:
        lineas.append("No se ha quedado nada fuera por tamaño.")
    with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(tablas.glob("*.json")):
            datos = f.read_bytes()
            z.writestr(f.name, datos.replace(clave, b"[retirado]") if clave else datos)
        z.writestr("LEEME.txt", (tablas / "LEEME.txt").read_text(encoding="utf-8") + "\n".join(lineas) + "\n")
        for f, arco, _ in dentro:
            z.write(f, arco)
    return {"ficheros": len(dentro), "bytes_ficheros": usados, "fuera": len(fuera)}


async def paquete(momento: datetime, carpeta: Path, max_bytes: int) -> tuple[Path, dict]:
    """Descargar mis datos: exporta las tablas a `carpeta` (temporal, la borra quien llama) y deja allí
    magister-AAAA-MM-DD.zip con ellas y tus ficheros."""
    tablas = carpeta / "tablas"
    cuentas = await exportar(tablas)
    destino = carpeta / f"magister-{momento.date().isoformat()}.zip"
    carpetas = {"salidas": Path(ajustes.salidas), "crudo": Path(ajustes.crudo)}
    info = await asyncio.to_thread(empaquetar, tablas, destino, carpetas, max_bytes, ajustes.canario)
    return destino, {**info, "tablas": cuentas}


# --- Copias de seguridad (Ajustes): las de scripts/copia_db.sh, una ahora y restaurar ---
# Todo va por `docker exec <contenedor> pg_dump|pg_restore|psql`: el contenedor de la base ya los trae, y así no hace
# falta bash ni tener Postgres instalado en Windows. Los procesos son asíncronos: la app sigue respondiendo.

COPIA = re.compile(r"^magister-(\d{4}-\d{2}-\d{2})(?:-\d{6})?\.dump$")
ANTES_DE_RESTAURAR = "antes-de-restaurar"


class ErrorCopia(Exception):
    """Una copia o una restauración que no ha salido; el mensaje es para el usuario."""


def listar_copias(raiz: Path) -> list[dict]:
    """Las copias de raiz/<carpeta>/*.dump (diarias, semanales, mensuales, antes-de-restaurar...), la última primero."""
    if not raiz.is_dir():
        return []
    copias = []
    for f in raiz.glob("*/*.dump"):
        if not f.is_file():
            continue
        st = f.stat()
        dia = COPIA.match(f.name)
        copias.append({"id": f"{f.parent.name}/{f.name}", "carpeta": f.parent.name, "nombre": f.name,
                       "dia": dia.group(1) if dia else None, "bytes": st.st_size,
                       "fecha": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()})
    return sorted(copias, key=lambda c: c["fecha"], reverse=True)


def copia_por_id(raiz: Path, id_copia: str) -> Path:
    """La ruta de una copia de la lista; nada fuera de raiz ni que no sea un .dump."""
    partes = id_copia.split("/")
    if len(partes) != 2 or any(p in ("", ".", "..") for p in partes) or not partes[1].endswith(".dump"):
        raise FileNotFoundError(id_copia)
    f = raiz / partes[0] / partes[1]
    if not f.is_file() or raiz.resolve() not in f.resolve().parents:
        raise FileNotFoundError(id_copia)
    return f


async def _proceso(*orden: str, entrada=None, salida=None) -> str:
    """Lanza la orden y devuelve su error si acaba mal (cadena vacía si va bien)."""
    try:
        proc = await asyncio.create_subprocess_exec(*orden, stdin=entrada or asyncio.subprocess.DEVNULL,
                                                    stdout=salida or asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    except OSError as e:
        return f"no se pudo lanzar {orden[0]} ({e})"
    _, err = await proc.communicate()
    return "" if proc.returncode == 0 else (err.decode("utf-8", "replace").strip()[-500:] or f"código {proc.returncode}")


def orden_pg(contenedor: str, *orden: str, entrada: bool = False) -> list[str]:
    """pg_dump, pg_restore o psql dentro del contenedor de la base (`docker exec`) o, con el contenedor vacío (todo en
    Docker: la API ya trae los clientes de Postgres), aquí mismo, yendo a la base por PGHOST y PGPASSWORD."""
    if not contenedor:
        return list(orden)
    return ["docker", "exec", *(["-i"] if entrada else []), contenedor, *orden]


ROTACION = {"diarias": 7, "semanales": 4, "mensuales": 12}


def rotar(raiz: Path, dia: date) -> list[Path]:
    """Lo de scripts/copia_db.sh: la copia de `dia` pasa también a semanales (lunes) y mensuales (día 1), y en cada
    carpeta se quedan las 7, 4 y 12 últimas. Devuelve lo que ha borrado."""
    hoy = raiz / "diarias" / f"magister-{dia.isoformat()}.dump"
    if hoy.is_file():
        for carpeta, toca in (("semanales", dia.isoweekday() == 1), ("mensuales", dia.day == 1)):
            if toca:
                (raiz / carpeta).mkdir(parents=True, exist_ok=True)
                shutil.copy2(hoy, raiz / carpeta / hoy.name)
    borrados = []
    for carpeta, quedan in ROTACION.items():
        copias = sorted((raiz / carpeta).glob("magister-*.dump"), key=lambda f: f.name, reverse=True)
        for f in copias[quedan:]:
            f.unlink(missing_ok=True)
            (f.parent / f.name.replace("magister-", "checkpoints-").replace(".dump", ".sqlite")).unlink(missing_ok=True)
            borrados.append(f)
    return borrados


async def volcar(base: str, usuario: str, destino: Path, contenedor: str) -> int:
    """pg_dump -Fc de la base a `destino` (lo mismo que scripts/copia_db.sh). Se escribe aparte y se mueve al final:
    una copia que falla no pisa la que había. Devuelve los bytes."""
    await asyncio.to_thread(destino.parent.mkdir, parents=True, exist_ok=True)
    parcial = destino.with_name(destino.name + ".parcial")
    fichero = await asyncio.to_thread(open, parcial, "wb")
    try:
        error = await _proceso(*orden_pg(contenedor, "pg_dump", "-U", usuario, "-Fc", base), salida=fichero)
    finally:
        await asyncio.to_thread(fichero.close)
    tam = (await asyncio.to_thread(parcial.stat)).st_size
    if error or not tam:
        await asyncio.to_thread(parcial.unlink, missing_ok=True)
        raise ErrorCopia(f"pg_dump falló: {error or 'la copia salió vacía'}")
    await asyncio.to_thread(os.replace, parcial, destino)
    return tam


def _copiar_checkpoints(origen: Path, destino: Path) -> None:
    # Como el script: la conversación de diagnóstico (LangGraph) vive en este SQLite, fuera de Postgres.
    if not origen.is_file():
        return
    with sqlite3.connect(origen) as a, sqlite3.connect(destino) as b:
        a.backup(b)


async def hacer_copia(momento: datetime, raiz: Path, base: str, usuario: str, contenedor: str, checkpoints: Path) -> dict:
    """La copia del día, en el mismo sitio y con el mismo nombre que la del script (si ya había una de hoy, la renueva)."""
    dia = momento.date().isoformat()
    destino = raiz / "diarias" / f"magister-{dia}.dump"
    await volcar(base, usuario, destino, contenedor)
    try:
        await asyncio.to_thread(_copiar_checkpoints, checkpoints, raiz / "diarias" / f"checkpoints-{dia}.sqlite")
    except (OSError, sqlite3.Error):
        pass  # la copia de la base ya está; sin la del diagnóstico solo se pierden sus pausas
    return next(c for c in await asyncio.to_thread(listar_copias, raiz) if c["id"] == f"diarias/{destino.name}")


PREVIO_RESTAURAR = "SET lock_timeout = '15s';\nDROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\n"


async def restaurar(copia: Path, momento: datetime, raiz: Path, base: str, usuario: str, contenedor: str) -> dict:
    """Sustituye TODOS los datos de `base` por los de la copia. Antes guarda el estado actual en
    raiz/antes-de-restaurar/ (si esa copia falla, no se toca nada). La copia pasa a SQL con pg_restore y entra con psql
    en una sola transacción, detrás de vaciar el esquema: si algo falla, se deshace entero y la base queda como estaba."""
    previa = raiz / ANTES_DE_RESTAURAR / f"magister-{momento.strftime('%Y-%m-%d-%H%M%S')}.dump"
    try:
        await volcar(base, usuario, previa, contenedor)
    except ErrorCopia as e:
        raise ErrorCopia(f"No he podido copiar tus datos de ahora, así que no he restaurado nada. {e}") from e
    carpeta = Path(await asyncio.to_thread(tempfile.mkdtemp, prefix="magister-restaurar-"))
    try:
        sql = carpeta / "restaurar.sql"
        await asyncio.to_thread(sql.write_text, PREVIO_RESTAURAR, encoding="utf-8")
        origen = await asyncio.to_thread(open, copia, "rb")
        destino = await asyncio.to_thread(open, sql, "ab")
        try:
            error = await _proceso(*orden_pg(contenedor, "pg_restore", "--no-owner", "--no-privileges", "-f", "-", entrada=True),
                                   entrada=origen, salida=destino)
        finally:
            await asyncio.to_thread(origen.close)
            await asyncio.to_thread(destino.close)
        if error:
            raise ErrorCopia(f"La copia no se puede leer y no he cambiado nada: {error}")
        entrada = await asyncio.to_thread(open, sql, "rb")
        try:
            error = await _proceso(*orden_pg(contenedor, "psql", "-X", "-q", "-U", usuario, "-d", base,
                                             "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-", entrada=True),
                                   entrada=entrada)
        finally:
            await asyncio.to_thread(entrada.close)
        if error:
            raise ErrorCopia(f"La restauración falló y se ha deshecho: tus datos siguen como estaban. {error}")
    finally:
        await asyncio.to_thread(shutil.rmtree, carpeta, True)
    return {"copia_previa": f"{ANTES_DE_RESTAURAR}/{previa.name}"}
