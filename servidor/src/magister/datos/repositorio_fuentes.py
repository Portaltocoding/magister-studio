"""Consultas de fuentes, documentos, versiones y fragmentos. Solo SQL: la lógica vive en `fuentes`."""

from collections.abc import Sequence

from sqlalchemy import and_, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from magister.datos.fuentes import Configuracion, Documento, Fragmento, Fuente, Version
from magister.datos.sesion import nueva_sesion


async def crear_fuente(s: AsyncSession, nombre: str, tipo: str, confianza: int) -> Fuente:
    f = Fuente(nombre=nombre, tipo=tipo, confianza=confianza)
    s.add(f)
    await s.commit()
    await s.refresh(f)
    return f


async def listar_fuentes(s: AsyncSession) -> list[Fuente]:
    return list((await s.scalars(select(Fuente).order_by(Fuente.nombre))).all())


async def fuente_por_nombre(s: AsyncSession, nombre: str) -> Fuente | None:
    return await s.scalar(select(Fuente).where(Fuente.nombre == nombre))


async def fuente_por_id(s: AsyncSession, fid: int) -> Fuente | None:
    return await s.get(Fuente, fid)


async def fuente_o_nueva(nombre: str, tipo: str, confianza: int) -> Fuente:
    async with nueva_sesion() as s:
        f = await fuente_por_nombre(s, nombre)
        return f or await crear_fuente(s, nombre, tipo, confianza)


async def documento_o_nuevo(s: AsyncSession, fuente_id: int, uri: str, titulo: str, tema_id: int | None) -> Documento:
    doc = await s.scalar(select(Documento).where(Documento.fuente_id == fuente_id, Documento.uri == uri))
    if doc is None:
        doc = Documento(fuente_id=fuente_id, uri=uri, titulo=titulo[:500] or uri, tema_id=tema_id)
        s.add(doc)
        await s.flush()
    else:
        if titulo and doc.titulo != titulo:
            doc.titulo = titulo[:500]
        if tema_id is not None:
            doc.tema_id = tema_id
    return doc


async def version_con_hash(s: AsyncSession, documento_id: int, h: str) -> Version | None:
    return await s.scalar(select(Version).where(Version.documento_id == documento_id, Version.hash == h))


async def versiones_de_documento(s: AsyncSession, documento_id: int) -> list[Version]:
    return list((await s.scalars(select(Version).where(Version.documento_id == documento_id).order_by(Version.id))).all())


async def candidatos_duplicado(s: AsyncSession, fuente_id: int) -> list[tuple[int, list[int], int, str]]:
    """(version_id, minhash, confianza, texto) de versiones vivas de otras fuentes."""
    filas = await s.execute(
        select(Version.id, Version.minhash, Fuente.confianza, Version.texto)
        .join(Documento, Documento.id == Version.documento_id)
        .join(Fuente, Fuente.id == Documento.fuente_id)
        .where(Fuente.id != fuente_id, Version.estado.in_(("pendiente", "lista")), Version.minhash.is_not(None))
    )
    return [(a, b, c, d) for a, b, c, d in filas.all()]


async def documentos_de_fuente(s: AsyncSession, fuente_id: int) -> list[tuple[Documento, Version | None, int]]:
    """Cada documento con su última versión y cuántos fragmentos tiene esa versión."""
    docs = list((await s.scalars(select(Documento).where(Documento.fuente_id == fuente_id).order_by(Documento.titulo))).all())
    salida = []
    # Volver a subir el mismo fichero deja una versión «retirada · sin cambios»: no es la que se muestra.
    repetida = and_(Version.estado == "retirada", Version.motivo == "sin cambios")
    for d in docs:
        v = await s.scalar(
            select(Version)
            .where(Version.documento_id == d.id, ~func.coalesce(repetida, False))
            .order_by(Version.id.desc())
            .limit(1)
        )
        n = 0
        if v is not None:
            n = await s.scalar(select(func.count()).select_from(Fragmento).where(Fragmento.version_id == v.id)) or 0
        salida.append((d, v, n))
    return salida


async def ultimas_versiones(s: AsyncSession) -> list[dict]:
    """Cada documento de todas las fuentes con su última versión (sin las «retirada · sin cambios») y sus fragmentos."""
    filas = await s.execute(text(
        "select distinct on (d.id) d.id, d.titulo, d.uri, f.id, f.nombre, v.id, v.estado, v.motivo, v.metadatos, "
        "v.texto is not null, (select count(*) from fragmentos g where g.version_id = v.id), v.ingerida_en "
        "from documentos d join fuentes f on f.id = d.fuente_id join versiones v on v.documento_id = d.id "
        "where not (v.estado = 'retirada' and coalesce(v.motivo, '') = 'sin cambios') "
        "order by d.id, v.id desc"
    ))
    claves = ("documento_id", "titulo", "uri", "fuente_id", "fuente", "version_id", "estado", "motivo", "metadatos",
              "con_texto", "fragmentos", "ingerida_en")
    return [dict(zip(claves, f, strict=True)) for f in filas.all()]


async def version_viva_de_uri(s: AsyncSession, uri: str) -> int | None:
    """La versión viva (recibida, pendiente o lista) más nueva de un documento con esta URI, en cualquier fuente."""
    return await s.scalar(
        select(Version.id).join(Documento, Documento.id == Version.documento_id)
        .where(Documento.uri == uri, Version.estado.in_(("recibida", "pendiente", "lista")))
        .order_by(Version.id.desc()).limit(1)
    )


async def retirar_version(s: AsyncSession, version_id: int, motivo: str) -> None:
    await s.execute(update(Version).where(Version.id == version_id).values(estado="retirada", motivo=motivo))
    await s.execute(update(Fragmento).where(Fragmento.version_id == version_id).values(embedding=None))


async def configuracion(s: AsyncSession, nombre: str | None = None) -> Configuracion | None:
    consulta = select(Configuracion)
    consulta = consulta.where(Configuracion.nombre == nombre) if nombre else consulta.where(Configuracion.activa.is_(True))
    return await s.scalar(consulta)


async def versiones_por_estado(s: AsyncSession, estado: str, limite: int = 20) -> list[int]:
    return list((await s.scalars(select(Version.id).where(Version.estado == estado).order_by(Version.id).limit(limite))).all())


async def insertar_fragmentos(s: AsyncSession, filas: Sequence[dict]) -> None:
    for f in filas:
        s.add(Fragmento(**f))


async def borrar_fragmentos(s: AsyncSession, version_id: int, config_id: int) -> None:
    """Los fragmentos de una versión con una configuración: indexar otra vez los sustituye, no los duplica."""
    from sqlalchemy import delete

    await s.execute(delete(Fragmento).where(Fragmento.version_id == version_id, Fragmento.config_id == config_id))


async def anotar_escalon(busqueda_id: int, escalon: str) -> None:
    """En qué escalón se resolvió una búsqueda (lexica, densa, reranker o nada): lo decide quien mira los umbrales."""
    from magister.datos.fuentes import Busqueda

    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Busqueda).where(Busqueda.id == busqueda_id).values(escalon=escalon))


async def contar(s: AsyncSession) -> dict:
    r = await s.execute(
        text(
            "select (select count(*) from fuentes), (select count(*) from documentos), "
            "(select count(*) from versiones where estado = 'lista'), (select count(*) from fragmentos), "
            "(select count(*) from fragmentos where embedding is not null)"
        )
    )
    a, b, c, d, e = r.one()
    return {"fuentes": a, "documentos": b, "versiones_listas": c, "fragmentos": d, "con_vector": e}


# Apoyo por lección (Parte III, «Lecciones con fuentes»)


async def guardar_apoyo(plan_id: int, clave: str, fragmentos: list[tuple[int, int, float]], sin_material: bool) -> None:
    from sqlalchemy import delete

    from magister.datos.fuentes import LeccionApoyo, LeccionFragmento

    async with nueva_sesion() as s, s.begin():
        await s.execute(
            delete(LeccionFragmento).where(LeccionFragmento.plan_id == plan_id, LeccionFragmento.leccion_clave == clave)
        )
        await s.execute(delete(LeccionApoyo).where(LeccionApoyo.plan_id == plan_id, LeccionApoyo.leccion_clave == clave))
        for fid, rango, p in fragmentos:
            s.add(LeccionFragmento(plan_id=plan_id, leccion_clave=clave, fragmento_id=fid, rango=rango, puntuacion=p))
        s.add(LeccionApoyo(plan_id=plan_id, leccion_clave=clave, n_fragmentos=len(fragmentos), sin_material=sin_material))


async def apoyo_de_plan(s: AsyncSession, plan_id: int) -> dict[str, tuple[int, bool]]:
    from magister.datos.fuentes import LeccionApoyo

    filas = (await s.scalars(select(LeccionApoyo).where(LeccionApoyo.plan_id == plan_id))).all()
    return {f.leccion_clave: (f.n_fragmentos, f.sin_material) for f in filas}


async def fragmentos_de_leccion(s: AsyncSession, plan_id: int, clave: str) -> list[int]:
    from magister.datos.fuentes import LeccionFragmento

    consulta = (
        select(LeccionFragmento.fragmento_id)
        .where(LeccionFragmento.plan_id == plan_id, LeccionFragmento.leccion_clave == clave)
        .order_by(LeccionFragmento.rango)
    )
    return list((await s.scalars(consulta)).all())


async def tema_de_version(s: AsyncSession, version_id: int) -> int | None:
    v = await s.get(Version, version_id)
    if v is None:
        return None
    d = await s.get(Documento, v.documento_id)
    return d.tema_id if d else None
