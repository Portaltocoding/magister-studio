"""Fuentes, documentos, versiones, fragmentos y búsqueda (Parte III)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from magister.cerebro.contratos import Consulta, Filtros
from magister.datos import repositorio_fuentes as rf
from magister.datos.fuentes import Documento, Fragmento, Fuente, Version
from magister.datos.sesion import sesion_por_peticion
from magister.flujo.comun import idioma_del_alumno
from magister.fuentes import ingesta
from magister.fuentes.buscar import BuscadorHibrido
from magister.fuentes.extraer import FormatoNoAdmitido, tipo_de

rutas = APIRouter(prefix="/api")
MAX_SUBIDA = 50 * 1024 * 1024


class FuenteEntrada(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)
    tipo: Literal["vault", "pdf", "libro", "web", "audio"]
    confianza: int = Field(ge=1, le=3)


class UrlEntrada(BaseModel):
    url: str = Field(pattern=r"^https?://")
    tema_id: int | None = None


def _fuente(f: Fuente) -> dict:
    return {"id": f.id, "nombre": f.nombre, "tipo": f.tipo, "confianza": f.confianza}


def _version(v: Version) -> dict:
    return {
        "id": v.id,
        "estado": v.estado,
        "motivo": v.motivo,
        "extractor": v.extractor,
        "duplicado_de": v.duplicado_de,
        "ingerida_en": v.ingerida_en.isoformat() if v.ingerida_en else None,
        **_origen(v.metadatos),
    }


def _origen(metadatos: dict | None) -> dict:
    """De dónde vino: «research» (y si entró solo y para qué lección) o nada si lo subiste tú. Y si entró solo un
    pedazo, `incompleta` con el motivo (lo escribe fuentes.extraer en `metadatos.incompleta`), venga de donde venga."""
    m = metadatos or {}
    incompleta = m.get("incompleta") or None
    if m.get("origen") != "research":
        return {"origen": None, "incompleta": incompleta}
    return {"origen": "research", "automatica": bool(m.get("automatica")), "leccion_clave": m.get("leccion_clave"),
            "incompleta": incompleta}


@rutas.get("/fuentes")
async def listar_fuentes(s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    return [_fuente(f) for f in await rf.listar_fuentes(s)]


@rutas.post("/fuentes", status_code=201)
async def crear_fuente(cuerpo: FuenteEntrada, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    try:
        return _fuente(await rf.crear_fuente(s, cuerpo.nombre.strip(), cuerpo.tipo, cuerpo.confianza))
    except IntegrityError:
        await s.rollback()
        raise HTTPException(409, "ya existe una fuente con ese nombre") from None


@rutas.get("/fuentes/{fid}/documentos")
async def documentos(fid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    if await rf.fuente_por_id(s, fid) is None:
        raise HTTPException(404, "fuente no encontrada")
    idioma = await idioma_del_alumno()
    salida = []
    for d, v, n in await rf.documentos_de_fuente(s, fid):
        # Qué pasó, en claro, y si «Reintentar» puede servir (un fichero vacío o que no es lo que dice, no).
        claro, destino = ingesta.explicar_problema(v.estado, v.motivo, v.texto is not None, n, d.uri or "", idioma) if v else ("", None)
        salida.append({
            "id": d.id, "titulo": d.titulo, "uri": d.uri, "tema_id": d.tema_id, "version": _version(v) if v else None,
            "fragmentos": n, "incompleta": ((v.metadatos or {}).get("incompleta") if v else None) or getattr(d, "incompleta", None),
            "que_paso": claro or None, "reintentable": destino is not None,
        })
    return salida


@rutas.get("/documentos/{did}/versiones")
async def versiones(did: int, s: AsyncSession = Depends(sesion_por_peticion)) -> list[dict]:
    if await s.get(Documento, did) is None:
        raise HTTPException(404, "documento no encontrado")
    return [_version(v) for v in await rf.versiones_de_documento(s, did)]


@rutas.post("/fuentes/{fid}/documentos", status_code=202)
async def subir(
    fid: int,
    request: Request,
    s: AsyncSession = Depends(sesion_por_peticion),
) -> dict:
    """Un fichero (multipart: `fichero`, `tema_id`) o `{"url", "tema_id"}`. Se procesa en segundo plano."""
    if await rf.fuente_por_id(s, fid) is None:
        raise HTTPException(404, "fuente no encontrada")
    await s.close()
    tipo_contenido = request.headers.get("content-type", "")
    if tipo_contenido.startswith("multipart/form-data"):
        formulario = await request.form()
        fichero = formulario.get("fichero")
        if not hasattr(fichero, "read"):
            raise HTTPException(422, "falta el fichero")
        tema = formulario.get("tema_id")
        crudo = await fichero.read()  # type: ignore[union-attr]
        if len(crudo) > MAX_SUBIDA:
            raise HTTPException(413, "el fichero pasa de 50 MB")
        nombre = fichero.filename or "documento"  # type: ignore[union-attr]
        try:
            tipo = tipo_de(nombre)
        except FormatoNoAdmitido as e:
            raise HTTPException(422, str(e)) from None
        vid = await ingesta.recibir(fid, crudo, nombre, f"subida/{nombre}", int(tema) if tema else None, tipo)
        return {"version_id": vid}
    cuerpo = UrlEntrada.model_validate(await request.json())
    try:
        crudo, tipo = await ingesta.descargar(cuerpo.url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"no se pudo descargar: {e}") from None
    vid = await ingesta.recibir(fid, crudo, cuerpo.url, cuerpo.url, cuerpo.tema_id, tipo)
    return {"version_id": vid}


@rutas.get("/versiones/{vid}")
async def ver_version(vid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    v = await s.get(Version, vid)
    if v is None:
        raise HTTPException(404, "versión no encontrada")
    n = len((await s.scalars(select(Fragmento.id).where(Fragmento.version_id == vid))).all())
    return {**_version(v), "fragmentos": n}


@rutas.get("/fragmentos/{fid}")
async def ver_fragmento(fid: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    f = await s.get(Fragmento, fid)
    if f is None:
        raise HTTPException(404, "fragmento no encontrado")
    v = await s.get(Version, f.version_id)
    d = await s.get(Documento, v.documento_id)
    fu = await s.get(Fuente, d.fuente_id)
    texto = v.texto or ""
    margen = 400
    return {
        "id": f.id,
        "texto": f.texto,
        "inicio": f.inicio,
        "fin": f.fin,
        "antes": texto[max(0, f.inicio - margen) : f.inicio],
        "despues": texto[f.fin : f.fin + margen],
        "documento": {"id": d.id, "titulo": d.titulo, "uri": d.uri},
        "fuente": _fuente(fu),
        "version": _version(v),
    }


@rutas.get("/buscar")
async def buscar(
    q: str,
    via: Literal["densa", "lexica", "hibrida"] = "hibrida",
    k: int = 5,
    indice: str | None = None,
    reranker: bool = False,
    tema_id: int | None = None,
) -> list[dict]:
    r = await BuscadorHibrido().buscar(q, min(k, 50), Filtros(tema_id=tema_id), Consulta(indice, via, 30, reranker))
    return [x.__dict__ for x in r.recuperados]


@rutas.get("/fuentes/estado")
async def estado_indice(s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    return await rf.contar(s)


@rutas.get("/fuentes/resumen")
async def resumen_documentos(s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """Cuántos documentos hay listos, indexándose y con problema; los problemas, en claro; y lo que vino del research."""
    idioma = await idioma_del_alumno()
    listos = indexando = 0
    problemas: list[dict] = []
    del_research: list[dict] = []
    incompletas: list[dict] = []
    for d in await rf.ultimas_versiones(s):
        claro, reintentar = ingesta.explicar_problema(d["estado"], d["motivo"], d["con_texto"], d["fragmentos"], d["uri"] or "", idioma)
        fila = {k: d[k] for k in ("documento_id", "titulo", "uri", "fuente_id", "fuente", "version_id", "estado", "motivo",
                                  "fragmentos")}
        fila |= {**_origen(d["metadatos"]), "que_paso": claro or None, "reintentable": reintentar is not None}
        # Para agrupar por tema en la Biblioteca y avisar de lo que entró a medias (solo el resumen de un artículo).
        fila |= {"tema_id": d.get("tema_id"), "tema": d.get("tema"),
                 "incompleta": fila.get("incompleta") or d.get("incompleta")}
        if fila["incompleta"] and d["estado"] != "retirada":
            incompletas.append(fila)
        if claro:
            problemas.append(fila)
        elif d["estado"] == "lista":
            listos += 1
        elif d["estado"] in ("recibida", "pendiente"):
            indexando += 1
        if fila["origen"] == "research" and d["estado"] != "retirada":
            del_research.append(fila)
    return {"listos": listos, "indexando": indexando, "con_problema": len(problemas), "problemas": problemas,
            "del_research": sorted(del_research, key=lambda x: -x["version_id"])[:200], "incompletas": incompletas}


@rutas.post("/versiones/{vid}/reintentar", status_code=202)
async def reintentar(vid: int) -> dict:
    """Vuelve a poner a indexar una versión que se quedó a medias (cuarentena por un fallo, o lista sin fragmentos)."""
    try:
        estado = await ingesta.reintentar_version(vid)
    except LookupError:
        raise HTTPException(404, "versión no encontrada") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    return {"version_id": vid, "estado": estado}


