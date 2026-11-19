"""La tubería de entrada: crudo → extraer → validar → hash → versión → fragmentos.

Cada documento va en su transacción; el trabajo pesado (PyMuPDF, MinHash, embeddings)
corre con `asyncio.to_thread` para no bloquear el bucle de la API.
"""

import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
from sqlalchemy import func, select, update

from magister.config import ajustes
from magister.datos import repositorio_fuentes as rf
from magister.datos.fuentes import Documento, Fragmento, Fuente, Version
from magister.datos.sesion import nueva_sesion
from magister.fuentes import duplicados as dup
from magister.fuentes.embeber import embeber
from magister.fuentes.extraer import (FORMATOS, PREFIJO_EQUIVOCADO, FormatoEquivocado, FormatoNoAdmitido, extraer_bytes,
                                      tipo_de)
from magister.fuentes.trocear import trocear
from magister.fuentes.validar import validar

registro = logging.getLogger("magister.ingesta")

Salida = Literal["nueva", "sin_cambios", "cuarentena", "error", "recibida"]
MAX_DESCARGA = 20 * 1024 * 1024


@dataclass
class Resultado:
    salida: Salida
    uri: str
    version_id: int | None = None
    motivo: str | None = None


def carpeta_crudo() -> Path:
    p = Path(ajustes.crudo)
    p.mkdir(parents=True, exist_ok=True)
    return p


def guardar_crudo(crudo: bytes) -> str:
    h = hashlib.sha256(crudo).hexdigest()
    ruta = carpeta_crudo() / h
    if not ruta.exists():
        ruta.write_bytes(crudo)
    return h


def leer_crudo(h: str) -> bytes:
    return (carpeta_crudo() / h).read_bytes()


async def _vigilar(peticion: httpx.Request) -> None:
    """Cada salto (también tras una redirección) se comprueba antes de salir: nada de direcciones internas."""
    from magister.seguridad.politica import comprobar_url

    await asyncio.to_thread(comprobar_url, str(peticion.url))


def tipo_externo(content_type: str, url: str) -> str:
    """Qué se ingiere de una URL que vino de la web; lo que no es página, texto ni PDF no entra."""
    ct = content_type.split(";")[0].strip().lower()
    if "pdf" in ct or (not ct and url.lower().split("?")[0].endswith(".pdf")):
        return "pdf"
    if not ct or "html" in ct or ct.endswith("/xml"):
        return "html"
    if ct == "text/markdown":
        return "md"
    if ct.startswith("text/"):
        return "txt"
    raise ValueError(f"no es una página ni un PDF ({ct})")


async def descargar(url: str, externa: bool = False) -> tuple[bytes, str]:
    """`externa`: la URL la propuso la web (el research). Se vigila cada salto y solo entra HTML, texto o PDF."""
    ganchos = {"request": [_vigilar]} if externa else {}
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": "Magister/0.3"},
                                 event_hooks=ganchos) as c:
        async with c.stream("GET", url) as r:
            r.raise_for_status()
            content_type = r.headers.get("content-type", "")
            tipo = tipo_externo(content_type, str(r.url)) if externa else (
                "pdf" if "pdf" in content_type or url.lower().endswith(".pdf") else "html")
            trozos: list[bytes] = []
            total = 0
            async for t in r.aiter_bytes():
                total += len(t)
                if total > MAX_DESCARGA:
                    raise ValueError("la página pasa de 20 MB")
                trozos.append(t)
            if externa and not total:
                raise ValueError("la página está vacía")
            return b"".join(trozos), tipo


def _preparar(crudo: bytes, nombre: str, tipo: str | None):
    e = extraer_bytes(crudo, nombre, tipo)
    texto = dup.normalizar(e.texto)
    e.texto = texto
    problemas = validar(e)
    firma = dup.firma(texto) if not problemas else None
    return e, dup.hash_texto(texto), problemas, firma


async def _retirar_anteriores(s, version: Version) -> None:
    """Una versión nueva sustituye a las vivas del mismo documento (se retiran, no se borran)."""
    for vieja in await rf.versiones_de_documento(s, version.documento_id):
        if vieja.id != version.id and vieja.estado in ("pendiente", "lista"):
            await rf.retirar_version(s, vieja.id, f"sustituida por la versión {version.id}")


async def _marcar_duplicado(s, version: Version, fuente: Fuente) -> None:
    if not version.minhash:
        return
    mis_bandas = set(dup.bandas(version.minhash))
    for vid, firma, confianza, texto in await rf.candidatos_duplicado(s, fuente.id):
        if vid == version.id or not mis_bandas & set(dup.bandas(firma)):
            continue
        j = await asyncio.to_thread(dup.jaccard, version.texto or "", texto or "")
        if j < dup.UMBRAL:
            continue
        if confianza >= fuente.confianza:
            version.duplicado_de = vid
        else:
            await s.execute(update(Version).where(Version.id == vid).values(duplicado_de=version.id))
        return


async def ingerir_bytes(
    fuente_id: int, uri: str, crudo: bytes, nombre: str, tema_id: int | None = None, tipo: str | None = None
) -> Resultado:
    try:
        crudo_hash = await asyncio.to_thread(guardar_crudo, crudo)
        e, h, problemas, firma = await asyncio.to_thread(_preparar, crudo, nombre, tipo)
    except FormatoNoAdmitido as ex:
        return Resultado("error", uri, motivo=str(ex))
    except Exception as ex:  # noqa: BLE001 un fichero roto no para la carpeta
        registro.exception("no se pudo extraer %s", uri)
        return Resultado("error", uri, motivo=f"{type(ex).__name__}: {ex}")
    async with nueva_sesion() as s, s.begin():
        fuente = await rf.fuente_por_id(s, fuente_id)
        if fuente is None:
            return Resultado("error", uri, motivo="la fuente no existe")
        doc = await rf.documento_o_nuevo(s, fuente_id, uri, e.titulo, tema_id)
        if await rf.version_con_hash(s, doc.id, h):
            return Resultado("sin_cambios", uri)
        estado = "cuarentena" if problemas else "pendiente"
        v = Version(
            documento_id=doc.id,
            hash=h,
            crudo_hash=crudo_hash,
            crudo_tipo=tipo or tipo_de(nombre),
            texto=e.texto,
            metadatos=e.metadatos,
            extractor=e.extractor,
            estado=estado,
            motivo="; ".join(p.motivo for p in problemas) or None,
            minhash=firma,
        )
        s.add(v)
        await s.flush()
        if estado == "pendiente":
            await _retirar_anteriores(s, v)
            await _marcar_duplicado(s, v, fuente)
        return Resultado("nueva" if estado == "pendiente" else "cuarentena", uri, v.id, v.motivo)


async def ingerir(fuente_id: int, uri: str, tema_id: int | None = None) -> Resultado:
    """Un fichero local o una URL."""
    if uri.startswith(("http://", "https://")):
        try:
            crudo, tipo = await descargar(uri)
        except Exception as ex:  # noqa: BLE001
            return Resultado("error", uri, motivo=f"no se pudo descargar: {ex}")
        return await ingerir_bytes(fuente_id, uri, crudo, uri, tema_id, tipo)
    ruta = Path(uri).expanduser().resolve()
    crudo = await asyncio.to_thread(ruta.read_bytes)
    return await ingerir_bytes(fuente_id, str(ruta), crudo, ruta.name, tema_id)


def ficheros(carpeta: Path) -> list[Path]:
    base = carpeta.resolve()
    salida = []
    for p in sorted(base.rglob("*")):
        if p.is_symlink() or not p.is_file() or p.suffix.lower() not in FORMATOS:
            continue
        if any(parte.startswith(".") for parte in p.relative_to(base).parts):
            continue  # .obsidian, .git...
        salida.append(p)
    return salida


async def ingerir_ruta(fuente_id: int, ruta: str, tema_id: int | None = None) -> list[Resultado]:
    if ruta.startswith(("http://", "https://")):
        return [await ingerir(fuente_id, ruta, tema_id)]
    p = Path(ruta).expanduser()
    if p.is_dir():
        return [await ingerir(fuente_id, str(f), tema_id) for f in ficheros(p)]
    return [await ingerir(fuente_id, str(p), tema_id)]


async def reingerir(fuente_id: int, carpeta: str, tema_id: int | None = None) -> dict[str, int]:
    resultados = await ingerir_ruta(fuente_id, carpeta, tema_id)
    vivos = {r.uri for r in resultados}
    base = str(Path(carpeta).expanduser().resolve())
    retiradas = 0
    async with nueva_sesion() as s, s.begin():
        docs = (await s.scalars(select(Documento).where(Documento.fuente_id == fuente_id))).all()
        for d in docs:
            if d.uri.startswith(base) and d.uri not in vivos and not Path(d.uri).exists():
                for v in await rf.versiones_de_documento(s, d.id):
                    if v.estado in ("pendiente", "lista"):
                        await rf.retirar_version(s, v.id, "el fichero ya no existe")
                        retiradas += 1
    resumen: dict[str, int] = {}
    for r in resultados:
        resumen[r.salida] = resumen.get(r.salida, 0) + 1
    resumen["retiradas"] = retiradas
    return resumen


# Subida por la API: se guarda el crudo y se procesa en segundo plano.


async def recibir(fuente_id: int, crudo: bytes, nombre: str, uri: str, tema_id: int | None, tipo: str | None,
                  metadatos: dict | None = None) -> int:
    """`metadatos` guarda de dónde vino (por ejemplo, `origen: research`); la extracción lo conserva."""
    crudo_hash = await asyncio.to_thread(guardar_crudo, crudo)
    async with nueva_sesion() as s, s.begin():
        doc = await rf.documento_o_nuevo(s, fuente_id, uri, Path(nombre).stem if "://" not in nombre else nombre, tema_id)
        v = Version(
            documento_id=doc.id,
            crudo_hash=crudo_hash,
            crudo_tipo=tipo or tipo_de(nombre),
            estado="recibida",
            metadatos={**(metadatos or {}), "nombre": nombre},
        )
        s.add(v)
        await s.flush()
        return v.id


async def procesar_recibida(version_id: int) -> None:
    async with nueva_sesion() as s:
        v = await s.get(Version, version_id)
        if v is None or v.estado != "recibida":
            return
        doc = await s.get(Documento, v.documento_id)
        crudo_hash, tipo, nombre = v.crudo_hash, v.crudo_tipo, v.metadatos.get("nombre", "documento")
    try:
        crudo = await asyncio.to_thread(leer_crudo, crudo_hash)
        e, h, problemas, firma = await asyncio.to_thread(_preparar, crudo, nombre, tipo)
    except Exception as ex:  # noqa: BLE001
        # Un fichero que no es lo que dice su extensión lleva su motivo propio, en castellano y sin «Reintentar».
        motivo = str(ex) if isinstance(ex, FormatoEquivocado) else f"no se pudo extraer: {ex}"
        async with nueva_sesion() as s, s.begin():
            await s.execute(
                update(Version).where(Version.id == version_id, Version.estado == "recibida")
                .values(estado="cuarentena", motivo=motivo)
            )
        return
    async with nueva_sesion() as s, s.begin():
        # La procesan el bucle de fondo y el trabajo de incorporar: la fila se bloquea y solo la primera la toca.
        v = await s.get(Version, version_id, with_for_update=True, populate_existing=True)
        if v is None or v.estado != "recibida":
            return
        fuente = await s.get(Fuente, doc.fuente_id)
        if await rf.version_con_hash(s, v.documento_id, h):
            v.estado, v.motivo = "retirada", "sin cambios"
            return
        if e.titulo and doc is not None:
            await s.execute(update(Documento).where(Documento.id == doc.id).values(titulo=e.titulo[:500]))
        v.hash, v.texto, v.extractor, v.minhash = h, e.texto, e.extractor, firma
        v.metadatos = {**v.metadatos, **e.metadatos}
        v.estado = "cuarentena" if problemas else "pendiente"
        v.motivo = "; ".join(p.motivo for p in problemas) or None
        await s.flush()
        if v.estado == "pendiente":
            await _retirar_anteriores(s, v)
            await _marcar_duplicado(s, v, fuente)


# De pendiente a lista: trocear, embeber e insertar fragmentos en la misma transacción.


async def indexar_version(version_id: int, nombre_config: str | None = None) -> int:
    """Idempotente: la indexan el bucle de fondo de la API y la orden `magister indexar`, a veces a la vez. Sin
    `nombre_config` solo indexa lo que sigue «pendiente»; con él (reindexar con otra configuración), sustituye los
    fragmentos de esa configuración. Nunca deja dos copias de (versión, configuración)."""
    t0 = time.perf_counter()
    async with nueva_sesion() as s:
        v = await s.get(Version, version_id)
        if v is None or v.texto is None or (nombre_config is None and v.estado != "pendiente"):
            return 0
        doc = await s.get(Documento, v.documento_id)
        fuente = await s.get(Fuente, doc.fuente_id)
        conf = await rf.configuracion(s, nombre_config)
        if conf is None:
            raise RuntimeError("no hay configuración del índice activa")
        texto, titulo, tipo, params, config_id = v.texto, doc.titulo, fuente.tipo, conf.params, conf.id
    trozos = await asyncio.to_thread(trocear, texto, titulo, tipo, params)
    # Un trozo que repite las palabras de otro del mismo documento no se indexa: un fichero de relleno no ocupa
    # todos los huecos de una búsqueda (el `orden` sigue siendo el del documento, con huecos).
    trozos = [trozos[i] for i in dup.sin_repetir([t.texto for t in trozos])]
    vectores = await asyncio.to_thread(embeber, [t.texto_indexado for t in trozos], "pasaje", params) if trozos else []
    async with nueva_sesion() as s, s.begin():
        # La fila se bloquea y se vuelve a mirar: si otro la indexó mientras troceábamos, no se repite.
        v = await s.get(Version, version_id, with_for_update=True, populate_existing=True)
        if v is None or (nombre_config is None and v.estado != "pendiente"):
            return 0
        await rf.borrar_fragmentos(s, version_id, config_id)
        await rf.insertar_fragmentos(
            s,
            [
                {
                    "version_id": version_id,
                    "config_id": config_id,
                    "orden": t.orden,
                    "inicio": t.inicio,
                    "fin": t.fin,
                    "texto": t.texto,
                    "texto_indexado": t.texto_indexado,
                    "embedding": vec,
                }
                for t, vec in zip(trozos, vectores, strict=True)
            ],
        )
        if nombre_config is None:
            await s.execute(update(Version).where(Version.id == version_id).values(estado="lista"))
    registro.info("versión %s: %d fragmentos en %.1f s", version_id, len(trozos), time.perf_counter() - t0)
    return len(trozos)


# Lo que se queda a medias: qué pasó, dicho en claro, y si «Reintentar» puede arreglarlo.


def explicar_problema(estado: str, motivo: str | None, con_texto: bool, fragmentos: int,
                      uri: str | None = None) -> tuple[str, str | None]:
    """(qué pasó, a qué estado vuelve con Reintentar; None si reintentar no lo arregla). ("", None) si no hay problema.
    `uri` dice si era una página web (http) o un fichero: «se carga con JavaScript» solo vale para una página (sin
    `uri`, como el trabajo de incorporar, que solo trae páginas, se supone web)."""
    m = motivo or ""
    web = uri is None or uri.startswith(("http://", "https://"))
    if estado == "lista" and fragmentos == 0:
        return "Está guardado pero sin ningún trozo indexado: el tutor no lo encuentra.", "pendiente" if con_texto else None
    if estado != "cuarentena":
        return "", None
    if m.startswith("el fichero está vacío"):
        return "El fichero está vacío: no hay nada que leer. Sube uno con texto.", None
    if m.startswith(PREFIJO_EQUIVOCADO):
        return f"El fichero {m.removeprefix(PREFIJO_EQUIVOCADO)}. Guárdalo con su formato de verdad y súbelo otra vez.", None
    if m.startswith("no se pudo indexar") and con_texto:
        return "Se descargó y se leyó, pero falló al trocearlo e indexarlo.", "pendiente"
    if m.startswith("no se pudo extraer") or not con_texto:
        # Con los mismos bytes, el extractor suele fallar igual; se deja reintentar por si el fallo era nuestro.
        return "No se pudo sacar el texto (el fichero puede estar dañado).", "recibida"
    if "caracteres de texto" in m:
        if not web:
            return "Casi no tiene texto: no hay bastante para buscar en él.", None
        return "Casi no tiene texto: la página se carga con JavaScript o pide registrarse.", None
    if "escaneado" in m:
        return "Parece un PDF escaneado, sin texto. Sube una copia con texto.", None
    if m.startswith("validez"):
        return "El texto sale con muchos caracteres raros (la codificación o el PDF están mal).", None
    return "Se apartó al leerlo.", None


async def reintentar_version(version_id: int) -> str:
    """Vuelve a poner una versión a medias en la tubería; el bucle de fondo la recoge. Devuelve el estado nuevo."""
    async with nueva_sesion() as s, s.begin():
        v = await s.get(Version, version_id, with_for_update=True)
        if v is None:
            raise LookupError("versión no encontrada")
        n = await s.scalar(select(func.count()).select_from(Fragmento).where(Fragmento.version_id == version_id)) or 0
        doc = await s.get(Documento, v.documento_id)
        claro, destino = explicar_problema(v.estado, v.motivo, v.texto is not None, n, doc.uri if doc else None)
        if destino is None:
            raise ValueError(f"{claro} Reintentar no lo arregla." if claro else "Este documento no tiene nada que reintentar.")
        mas_nueva = await s.scalar(select(Version.id).where(
            Version.documento_id == v.documento_id, Version.id > v.id, Version.estado.in_(("recibida", "pendiente", "lista"))))
        if mas_nueva is not None:
            raise ValueError("Este documento ya tiene una versión más nueva.")
        v.estado, v.motivo = destino, None
        return destino


async def procesar_pendientes(al_quedar_lista=None) -> int:
    """Una pasada: recibidas → pendiente/cuarentena, pendientes → lista. Devuelve cuántas tocó."""
    hechas = 0
    async with nueva_sesion() as s:
        recibidas = await rf.versiones_por_estado(s, "recibida")
    for vid in recibidas:
        await procesar_recibida(vid)
        hechas += 1
    async with nueva_sesion() as s:
        pendientes = await rf.versiones_por_estado(s, "pendiente")
    listas: list[int] = []
    for vid in pendientes:
        try:
            await indexar_version(vid)
        except Exception as ex:  # noqa: BLE001
            registro.exception("no se pudo indexar la versión %s", vid)
            async with nueva_sesion() as s, s.begin():
                await s.execute(update(Version).where(Version.id == vid).values(estado="cuarentena", motivo=f"no se pudo indexar: {ex}"))
            continue
        hechas += 1
        listas.append(vid)
    if listas and al_quedar_lista is not None:
        await al_quedar_lista(listas)
    return hechas


async def bucle_de_fondo(al_quedar_lista=None, pausa: float = 2.0) -> None:
    while True:
        try:
            if not await procesar_pendientes(al_quedar_lista):
                await asyncio.sleep(pausa)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            registro.exception("fallo en la tarea de fondo de la ingesta")
            await asyncio.sleep(pausa * 5)
