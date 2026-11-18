"""Consultas de temas, conversaciones y mensajes. La API no escribe SQL."""

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from magister.datos.modelos import Conversacion, Mensaje, Tema
from magister.datos.sesion import nueva_sesion

LIMITE_CONVERSACIONES = 50


async def comprobar(s: AsyncSession) -> None:
    await s.execute(text("select 1"))


async def crear_tema(s: AsyncSession, nombre: str) -> Tema:
    tema = Tema(nombre=nombre)
    s.add(tema)
    await s.commit()
    await s.refresh(tema)
    return tema


async def listar_temas(s: AsyncSession) -> list[Tema]:
    return list((await s.scalars(select(Tema).order_by(Tema.nombre))).all())


async def tema_por_nombre(s: AsyncSession, nombre: str) -> Tema | None:
    return await s.scalar(select(Tema).where(Tema.nombre == nombre))


async def obtener_tema(s: AsyncSession, tema_id: int) -> Tema | None:
    return await s.get(Tema, tema_id)


async def crear_conversacion(
    s: AsyncSession, titulo: str, tema_id: int | None, tipo: str = "libre"
) -> Conversacion:
    c = Conversacion(titulo=titulo, tema_id=tema_id, tipo=tipo)
    s.add(c)
    await s.commit()
    await s.refresh(c)
    return c


async def listar_conversaciones(s: AsyncSession) -> list[Conversacion]:
    # Las del asesor (la mascota flotante) viven en su ventanita, no en el historial.
    consulta = (select(Conversacion).where(Conversacion.tipo != "asesor")
                .order_by(Conversacion.actualizada_en.desc(), Conversacion.id.desc()))
    return list((await s.scalars(consulta.limit(LIMITE_CONVERSACIONES))).all())


async def obtener_conversacion(s: AsyncSession, cid: int) -> Conversacion | None:
    return await s.get(Conversacion, cid)


async def borrar_conversacion(s: AsyncSession, cid: int) -> bool:
    c = await s.get(Conversacion, cid)
    if c is None:
        return False
    await s.delete(c)
    await s.commit()
    return True


async def listar_mensajes(s: AsyncSession, cid: int) -> list[Mensaje]:
    consulta = select(Mensaje).where(Mensaje.conversacion_id == cid).order_by(Mensaje.id)
    return list((await s.scalars(consulta)).all())


async def guardar_pregunta(s: AsyncSession, cid: int, contenido: str, cuenta: bool = True) -> Mensaje:
    """Inserta el mensaje del alumno y confirma antes de llamar al modelo."""
    m = Mensaje(conversacion_id=cid, rol="usuario", contenido=contenido, estado="completo", cuenta=cuenta)
    s.add(m)
    await s.execute(update(Conversacion).where(Conversacion.id == cid).values(actualizada_en=func.now()))
    await s.commit()
    await s.refresh(m)
    return m


async def borrar_mensaje(s: AsyncSession, mid: int) -> None:
    from sqlalchemy import delete

    await s.execute(delete(Mensaje).where(Mensaje.id == mid))
    await s.commit()


async def historial_completo(s: AsyncSession, cid: int) -> list[Mensaje]:
    consulta = (
        select(Mensaje)
        .where(Mensaje.conversacion_id == cid, Mensaje.estado == "completo")
        .order_by(Mensaje.id)
    )
    filas = list((await s.scalars(consulta)).all())
    await s.commit()  # no dejar la transacción abierta mientras dura el flujo
    return filas


async def guardar_respuesta(
    cid: int,
    contenido: str,
    estado: str,
    modelo: str,
    motor: str,
    ms_primer_token: int | None,
    ms_total: int,
    cuenta: bool = True,
    traza_id: str | None = None,
) -> int:
    """Guarda la respuesta del tutor con una sesión nueva (no la de la petición)."""
    async with nueva_sesion() as s:
        m = Mensaje(
            conversacion_id=cid,
            rol="tutor",
            contenido=contenido,
            estado=estado,
            modelo=modelo,
            motor=motor,
            ms_primer_token=ms_primer_token,
            ms_total=ms_total,
            cuenta=cuenta,
            traza_id=traza_id,
        )
        s.add(m)
        await s.execute(update(Conversacion).where(Conversacion.id == cid).values(actualizada_en=func.now()))
        await s.commit()
        await s.refresh(m)
        return m.id


async def guardar_citas(mensaje_id: int, citas: list[dict], busqueda_id: int | None) -> None:
    from magister.datos.fuentes import MensajeCita

    async with nueva_sesion() as s, s.begin():
        vistos: set[int] = set()
        for c in citas:
            if c["fragmento_id"] in vistos:
                continue
            vistos.add(c["fragmento_id"])
            existe = await s.scalar(text("select 1 from fragmentos where id = :i"), {"i": c["fragmento_id"]})
            if not existe:
                continue  # una cita inventada no se guarda; ya va marcada como dudosa en el fin
            s.add(MensajeCita(mensaje_id=mensaje_id, fragmento_id=c["fragmento_id"], cita_literal=c["cita_literal"],
                              dudosa=c["dudosa"], busqueda_id=busqueda_id))


async def votos_de_trazas(s: AsyncSession, trazas: list[str]) -> dict[str, bool]:
    if not trazas:
        return {}
    filas = (await s.execute(text("select traza_id, valor from puntuaciones where nombre = 'feedback_usuario' "
                                  "and traza_id = any(:t)"), {"t": trazas})).all()
    return {t: v >= 0.5 for t, v in filas}


async def citas_de_mensajes(s: AsyncSession, ids: list[int]) -> dict[int, list[dict]]:
    from magister.datos.fuentes import MensajeCita

    filas = (await s.scalars(select(MensajeCita).where(MensajeCita.mensaje_id.in_(ids)))).all() if ids else []
    salida: dict[int, list[dict]] = {}
    for c in filas:
        salida.setdefault(c.mensaje_id, []).append(
            {"fragmento_id": c.fragmento_id, "cita_literal": c.cita_literal, "dudosa": c.dudosa}
        )
    return salida
