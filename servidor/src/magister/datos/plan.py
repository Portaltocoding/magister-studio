"""Tablas y consultas del plan (ADR-0006): planes versionados, lecciones, conceptos,
dependencias y sesiones."""

from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    Time,
    func,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from magister.datos.modelos import Base, Conversacion, Fecha, Tema
from magister.datos.sesion import nueva_sesion


class PlanFila(Base):
    __tablename__ = "planes"
    __table_args__ = (
        CheckConstraint("estado in ('propuesto', 'aceptado', 'sustituido')", name="ck_planes_estado"),
        Index(
            "uq_planes_tema_aceptado",
            "tema_id",
            unique=True,
            postgresql_where=text("estado = 'aceptado'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tema_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("temas.id", ondelete="CASCADE"))
    conversacion_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("conversaciones.id", ondelete="SET NULL")
    )
    version: Mapped[int] = mapped_column(Integer)
    estado: Mapped[str] = mapped_column(String(12))
    perfil: Mapped[dict] = mapped_column(JSONB)
    razonamiento: Mapped[str] = mapped_column(Text)
    version_prompt: Mapped[str | None] = mapped_column(String(80))
    modelo: Mapped[str | None] = mapped_column(String(60))
    creado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class LeccionFila(Base):
    __tablename__ = "lecciones"

    plan_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("planes.id", ondelete="CASCADE"), primary_key=True)
    clave: Mapped[str] = mapped_column(String(20), primary_key=True)
    titulo: Mapped[str] = mapped_column(String(300))
    objetivos: Mapped[list[str]] = mapped_column(ARRAY(Text))
    horas: Mapped[float] = mapped_column(Float)
    orden: Mapped[int] = mapped_column(Integer)


class ConceptoFila(Base):
    __tablename__ = "conceptos"
    __table_args__ = (
        ForeignKeyConstraint(
            ["plan_id", "leccion_clave"],
            ["lecciones.plan_id", "lecciones.clave"],
            ondelete="CASCADE",
            name="fk_conceptos_leccion",
        ),
    )

    plan_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("planes.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(300))
    leccion_clave: Mapped[str] = mapped_column(String(20))
    # Ampliada en la Parte IV: sinónimos, núcleo y dependencias entre conceptos.
    sinonimos: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    nucleo: Mapped[bool] = mapped_column(server_default=text("true"))
    depende_de: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    enriquecido_en: Mapped[datetime | None] = mapped_column(Fecha)
    # Parte V: de dónde sale el concepto, si lo aprobaste y su brazo del experimento.
    origen: Mapped[str] = mapped_column(String(10), server_default="plan")
    aprobado: Mapped[bool] = mapped_column(server_default=text("true"))
    brazo: Mapped[str | None] = mapped_column(String(10))


class DependenciaFila(Base):
    __tablename__ = "dependencias"
    __table_args__ = (
        CheckConstraint("leccion_clave <> depende_de", name="ck_dependencias_no_propia"),
        ForeignKeyConstraint(
            ["plan_id", "leccion_clave"], ["lecciones.plan_id", "lecciones.clave"], ondelete="CASCADE",
            name="fk_dependencias_leccion",
        ),
        ForeignKeyConstraint(
            ["plan_id", "depende_de"], ["lecciones.plan_id", "lecciones.clave"], ondelete="CASCADE",
            name="fk_dependencias_previa",
        ),
    )

    plan_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    leccion_clave: Mapped[str] = mapped_column(String(20), primary_key=True)
    depende_de: Mapped[str] = mapped_column(String(20), primary_key=True)


class SesionFila(Base):
    __tablename__ = "sesiones"
    __table_args__ = (
        CheckConstraint("estado in ('pendiente', 'hecha', 'saltada')", name="ck_sesiones_estado"),
        ForeignKeyConstraint(
            ["plan_id", "leccion_clave"], ["lecciones.plan_id", "lecciones.clave"], ondelete="CASCADE",
            name="fk_sesiones_leccion",
        ),
        Index("ix_sesiones_plan_fecha", "plan_id", "fecha"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(BigInteger)
    leccion_clave: Mapped[str] = mapped_column(String(20))
    fecha: Mapped[date] = mapped_column(Date)
    inicio: Mapped[time | None] = mapped_column(Time)
    horas: Mapped[float] = mapped_column(Float)
    estado: Mapped[str] = mapped_column(String(10), server_default="pendiente")


async def tema_por_nombre_o_nuevo(s: AsyncSession, nombre: str) -> Tema:
    tema = await s.scalar(select(Tema).where(func.lower(Tema.nombre) == nombre.strip().lower()))
    if tema is None:
        tema = Tema(nombre=nombre.strip()[:200])
        s.add(tema)
        await s.flush()
    return tema


async def guardar_plan(
    nombre_tema: str,
    conversacion_id: int | None,
    perfil: dict,
    plan: dict,
    sesiones: list[dict],
    version_prompt: str | None,
    modelo: str | None,
) -> tuple[int, int]:
    """En una transacción: sustituye el aceptado anterior e inserta el nuevo. Devuelve (tema, plan)."""
    async with nueva_sesion() as s, s.begin():
        tema = await tema_por_nombre_o_nuevo(s, nombre_tema)
        previa = await s.scalar(select(func.max(PlanFila.version)).where(PlanFila.tema_id == tema.id))
        await s.execute(
            update(PlanFila)
            .where(PlanFila.tema_id == tema.id, PlanFila.estado == "aceptado")
            .values(estado="sustituido")
        )
        fila = PlanFila(
            tema_id=tema.id,
            conversacion_id=conversacion_id,
            version=(previa or 0) + 1,
            estado="aceptado",
            perfil=perfil,
            razonamiento=plan["razonamiento"],
            version_prompt=version_prompt,
            modelo=modelo,
        )
        s.add(fila)
        await s.flush()
        for i, lec in enumerate(plan["lecciones"]):
            s.add(
                LeccionFila(
                    plan_id=fila.id,
                    clave=lec["clave"],
                    titulo=lec["titulo"],
                    objetivos=lec["objetivos"],
                    horas=lec["horas"],
                    orden=i,
                )
            )
        await s.flush()
        for lec in plan["lecciones"]:
            for c in lec["conceptos"]:
                s.add(ConceptoFila(plan_id=fila.id, id=c["id"], nombre=c["nombre"], leccion_clave=lec["clave"]))
            for d in lec["depende_de"]:
                s.add(DependenciaFila(plan_id=fila.id, leccion_clave=lec["clave"], depende_de=d))
        for ses in sesiones:
            s.add(
                SesionFila(
                    plan_id=fila.id,
                    leccion_clave=ses["clave"],
                    fecha=date.fromisoformat(ses["fecha"]),
                    inicio=time.fromisoformat(ses["inicio"]) if ses.get("inicio") else None,
                    horas=ses["horas"],
                )
            )
        if conversacion_id is not None:
            await s.execute(update(Conversacion).where(Conversacion.id == conversacion_id).values(tema_id=tema.id))
        return tema.id, fila.id


async def plan_aceptado(s: AsyncSession, tema_id: int) -> PlanFila | None:
    return await s.scalar(select(PlanFila).where(PlanFila.tema_id == tema_id, PlanFila.estado == "aceptado"))


async def plan_por_id(s: AsyncSession, plan_id: int) -> PlanFila | None:
    return await s.get(PlanFila, plan_id)


async def planes_aceptados(s: AsyncSession) -> list[tuple[PlanFila, str]]:
    filas = await s.execute(
        select(PlanFila, Tema.nombre).join(Tema, Tema.id == PlanFila.tema_id).where(PlanFila.estado == "aceptado")
        .order_by(Tema.nombre)
    )
    return [(p, n) for p, n in filas.all()]


async def lecciones(s: AsyncSession, plan_id: int) -> list[LeccionFila]:
    return list((await s.scalars(select(LeccionFila).where(LeccionFila.plan_id == plan_id).order_by(LeccionFila.orden))).all())


async def conceptos(s: AsyncSession, plan_id: int) -> list[ConceptoFila]:
    return list((await s.scalars(select(ConceptoFila).where(ConceptoFila.plan_id == plan_id))).all())


async def dependencias(s: AsyncSession, plan_id: int) -> list[DependenciaFila]:
    return list((await s.scalars(select(DependenciaFila).where(DependenciaFila.plan_id == plan_id))).all())


async def sesiones(s: AsyncSession, plan_id: int) -> list[SesionFila]:
    consulta = select(SesionFila).where(SesionFila.plan_id == plan_id).order_by(SesionFila.fecha, SesionFila.inicio, SesionFila.id)
    return list((await s.scalars(consulta)).all())


async def sustituir_pendientes(s: AsyncSession, plan_id: int, nuevas: list[dict]) -> None:
    """Borra las sesiones pendientes y escribe las recalculadas; no toca las hechas ni las saltadas."""
    from sqlalchemy import delete

    await s.execute(delete(SesionFila).where(SesionFila.plan_id == plan_id, SesionFila.estado == "pendiente"))
    for ses in nuevas:
        s.add(
            SesionFila(
                plan_id=plan_id,
                leccion_clave=ses["clave"],
                fecha=date.fromisoformat(ses["fecha"]),
                inicio=time.fromisoformat(ses["inicio"]) if ses.get("inicio") else None,
                horas=ses["horas"],
            )
        )
    await s.commit()


async def marcar_sesion(s: AsyncSession, sesion_id: int, estado: str) -> SesionFila | None:
    fila = await s.get(SesionFila, sesion_id)
    if fila is None:
        return None
    fila.estado = estado
    await s.commit()
    return fila
