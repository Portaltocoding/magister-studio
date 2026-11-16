"""Tablas de la Parte V: el registro de intentos (inmutable salvo `nota_usuario`)."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, Float, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from magister.datos.modelos import Base, Fecha

NOTAS = ("fallo", "parcial", "bien", "perfecta")


class Intento(Base):
    __tablename__ = "intentos"
    __table_args__ = (
        ForeignKeyConstraint(
            ["plan_id", "concepto_id"], ["conceptos.plan_id", "conceptos.id"], ondelete="CASCADE", name="fk_intentos_concepto"
        ),
        CheckConstraint("tipo in ('espaciado', 'reintento', 'sonda')", name="ck_intentos_tipo"),
        CheckConstraint("nota_corrector in ('fallo', 'parcial', 'bien', 'perfecta')", name="ck_intentos_nota_corrector"),
        CheckConstraint(
            "nota_usuario is null or nota_usuario in ('fallo', 'parcial', 'bien', 'perfecta')", name="ck_intentos_nota_usuario"
        ),
        CheckConstraint("confianza in (0.25, 0.5, 0.75, 0.95)", name="ck_intentos_confianza"),
        Index("ix_intentos_concepto_momento", "concepto_id", "momento"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[int] = mapped_column(BigInteger)
    concepto_id: Mapped[str] = mapped_column(String(80))
    pregunta_id: Mapped[str | None] = mapped_column(String(60))
    momento: Mapped[datetime] = mapped_column(Fecha)
    tipo: Mapped[str] = mapped_column(String(10), server_default="espaciado")
    respuesta: Mapped[str] = mapped_column(Text)
    explicacion: Mapped[str | None] = mapped_column(Text)
    confianza: Mapped[float] = mapped_column(Float)
    latencia_ms: Mapped[int | None] = mapped_column(Integer)
    nota_corrector: Mapped[str] = mapped_column(String(10))
    nota_usuario: Mapped[str | None] = mapped_column(String(10))
    correccion: Mapped[dict | None] = mapped_column(JSONB)
    p_predicha: Mapped[float | None] = mapped_column(Float)
    version_programador: Mapped[str | None] = mapped_column(String(120))
    version_corrector: Mapped[str | None] = mapped_column(String(80))
    clave_idempotencia: Mapped[str] = mapped_column(String(80), unique=True)


class Servida(Base):
    """La pregunta servida con su apuesta (`p_predicha`), escrita al servir y antes de corregir."""

    __tablename__ = "servidas"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(BigInteger)
    concepto_id: Mapped[str] = mapped_column(String(80))
    pregunta_id: Mapped[str] = mapped_column(String(60))
    momento: Mapped[datetime] = mapped_column(Fecha)
    p_predicha: Mapped[float | None] = mapped_column(Float)
    version_programador: Mapped[str] = mapped_column(String(120))


class Examen(Base):
    """Un examen o una evaluación: las preguntas que salieron, lo que respondiste y la nota."""

    __tablename__ = "examenes"
    __table_args__ = (
        CheckConstraint("modo in ('examen', 'evaluacion')", name="ck_examenes_modo"),
        Index("ix_examenes_plan_creado", "plan_id", "creado"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("planes.id", ondelete="CASCADE"))
    modo: Mapped[str] = mapped_column(String(12))
    lecciones: Mapped[list[str]] = mapped_column(JSONB)
    preguntas: Mapped[list[dict]] = mapped_column(JSONB)
    minutos: Mapped[int | None] = mapped_column(Integer)
    creado: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
    terminado: Mapped[datetime | None] = mapped_column(Fecha)
    segundos: Mapped[int | None] = mapped_column(Integer)
    nota: Mapped[float | None] = mapped_column(Float)
