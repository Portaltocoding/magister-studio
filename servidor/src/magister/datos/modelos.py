"""Las tablas de Magister con SQLAlchemy 2.

v0.1: temas, conversaciones y mensajes. Cada parte posterior añade las suyas en
su propio módulo (`datos/plan.py`, `datos/fuentes.py`...) sobre la misma `Base`.
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NOMBRES = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NOMBRES)


Fecha = TIMESTAMP(timezone=True)


class Tema(Base):
    __tablename__ = "temas"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(200), unique=True)
    creado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class Conversacion(Base):
    __tablename__ = "conversaciones"
    __table_args__ = (
        Index("ix_conversaciones_actualizada", "actualizada_en"),
        CheckConstraint("tipo in ('libre', 'plan', 'tutor', 'asesor')", name="ck_conversaciones_tipo"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tema_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("temas.id", ondelete="SET NULL"))
    titulo: Mapped[str] = mapped_column(String(200))
    # libre: Estudio libre; plan: diagnóstico que acaba en un plan; tutor: sesión guiada (v0.5);
    # asesor: la mascota flotante, una conversación por sección de la app (no sale en tu historial)
    tipo: Mapped[str] = mapped_column(String(10), server_default="libre")
    creada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
    actualizada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class Mensaje(Base):
    __tablename__ = "mensajes"
    __table_args__ = (
        CheckConstraint("rol in ('usuario', 'tutor')", name="ck_mensajes_rol"),
        CheckConstraint("estado in ('completo', 'interrumpido', 'error')", name="ck_mensajes_estado"),
        Index("ix_mensajes_conversacion", "conversacion_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    conversacion_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("conversaciones.id", ondelete="CASCADE")
    )
    rol: Mapped[str] = mapped_column(String(10))
    contenido: Mapped[str] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(String(15), server_default="completo")
    modelo: Mapped[str | None] = mapped_column(String(60))
    motor: Mapped[str | None] = mapped_column(String(20))
    cuenta: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    ms_primer_token: Mapped[int | None] = mapped_column(Integer)
    ms_total: Mapped[int | None] = mapped_column(Integer)
    traza_id: Mapped[str | None] = mapped_column(String(64))
    creado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
