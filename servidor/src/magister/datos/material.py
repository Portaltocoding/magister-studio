"""Tablas de la Parte IV: materiales, bloques, preguntas, banco de tono, etiquetas y trabajos."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from magister.datos.modelos import Base, Fecha


class Trabajo(Base):
    __tablename__ = "trabajos"
    __table_args__ = (
        CheckConstraint(
            "estado in ('pendiente', 'en_curso', 'hecho', 'fallido', 'cancelado')", name="ck_trabajos_estado"
        ),
        Index("ix_trabajos_estado", "estado"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tipo: Mapped[str] = mapped_column(String(20))
    plan_id: Mapped[int | None] = mapped_column(BigInteger)
    leccion_clave: Mapped[str | None] = mapped_column(String(20))
    parametros: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    clave: Mapped[str] = mapped_column(String(64), unique=True)
    estado: Mapped[str] = mapped_column(String(10), server_default="pendiente")
    intentos: Mapped[int] = mapped_column(Integer, server_default="0")
    lease_hasta: Mapped[datetime | None] = mapped_column(Fecha)
    trabajador: Mapped[str | None] = mapped_column(String(80))
    nodo: Mapped[str | None] = mapped_column(String(40))
    paso: Mapped[int] = mapped_column(Integer, server_default="0")
    total: Mapped[int] = mapped_column(Integer, server_default="0")
    avisos: Mapped[list] = mapped_column(JSONB, server_default="[]")
    error: Mapped[str | None] = mapped_column(Text)
    traza_id: Mapped[str | None] = mapped_column(String(64))
    creado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
    empezado_en: Mapped[datetime | None] = mapped_column(Fecha)
    acabado_en: Mapped[datetime | None] = mapped_column(Fecha)


class Trabajador(Base):
    __tablename__ = "trabajadores"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    ultimo_latido: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class Material(Base):
    __tablename__ = "materiales"
    __table_args__ = (
        CheckConstraint("tipo in ('apuntes', 'diapositivas', 'guion')", name="ck_materiales_tipo"),
        CheckConstraint("estado in ('generando', 'listo', 'revisar', 'bloqueado')", name="ck_materiales_estado"),
        ForeignKeyConstraint(
            ["plan_id", "leccion_clave"], ["lecciones.plan_id", "lecciones.clave"], ondelete="CASCADE",
            name="fk_materiales_leccion",
        ),
        UniqueConstraint("trabajo_id", "tipo", name="uq_materiales_trabajo_tipo"),
        Index("ix_materiales_leccion", "plan_id", "leccion_clave"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(BigInteger)
    leccion_clave: Mapped[str] = mapped_column(String(20))
    tipo: Mapped[str] = mapped_column(String(15))
    estado: Mapped[str] = mapped_column(String(10), server_default="generando")
    motivo: Mapped[str | None] = mapped_column(Text)
    contrato: Mapped[dict | None] = mapped_column(JSONB)
    texto: Mapped[str | None] = mapped_column(Text)
    rutas: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    versiones: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    informes: Mapped[list] = mapped_column(JSONB, server_default="[]")
    trabajo_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("trabajos.id", ondelete="SET NULL"))
    creado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
    actualizado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class BloqueMaterial(Base):
    __tablename__ = "bloques_material"

    material_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("materiales.id", ondelete="CASCADE"), primary_key=True
    )
    clave: Mapped[str] = mapped_column(String(10), primary_key=True)
    titulo: Mapped[str] = mapped_column(Text, server_default="")
    texto: Mapped[str] = mapped_column(Text)
    refinados: Mapped[int] = mapped_column(Integer, server_default="0")
    marcado: Mapped[bool] = mapped_column(Boolean, server_default="false")
    version_prompt: Mapped[str | None] = mapped_column(String(80))


class Pregunta(Base):
    __tablename__ = "preguntas"
    __table_args__ = (
        CheckConstraint("tipo in ('conceptual', 'calculo', 'fallo', 'escenario', 'hablada')", name="ck_preguntas_tipo"),
        CheckConstraint("estado in ('borrador', 'activa', 'retirada')", name="ck_preguntas_estado"),
        ForeignKeyConstraint(
            ["plan_id", "leccion_clave"], ["lecciones.plan_id", "lecciones.clave"], ondelete="CASCADE",
            name="fk_preguntas_leccion",
        ),
        Index("ix_preguntas_leccion", "plan_id", "leccion_clave"),
    )

    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    plan_id: Mapped[int] = mapped_column(BigInteger)
    leccion_clave: Mapped[str] = mapped_column(String(20))
    material_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("materiales.id", ondelete="SET NULL"))
    tipo: Mapped[str] = mapped_column(String(12))
    enunciado: Mapped[str] = mapped_column(Text)
    fantasma: Mapped[str] = mapped_column(Text)
    donde: Mapped[str | None] = mapped_column(String(10))
    sonda: Mapped[bool] = mapped_column(Boolean, server_default="false")
    estado: Mapped[str] = mapped_column(String(10), server_default="borrador")
    creada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class PreguntaConcepto(Base):
    __tablename__ = "preguntas_concepto"
    __table_args__ = (
        ForeignKeyConstraint(
            ["plan_id", "concepto_id"], ["conceptos.plan_id", "conceptos.id"], ondelete="CASCADE",
            name="fk_preguntas_concepto_concepto",
        ),
    )

    pregunta_id: Mapped[str] = mapped_column(
        String(60), ForeignKey("preguntas.id", ondelete="CASCADE"), primary_key=True
    )
    plan_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    concepto_id: Mapped[str] = mapped_column(String(80), primary_key=True)


class BancoTono(Base):
    __tablename__ = "banco_tono"
    __table_args__ = (
        CheckConstraint("particion in ('alinear', 'validar', 'reserva')", name="ck_banco_tono_particion"),
        ForeignKeyConstraint(
            ["material_id", "clave"], ["bloques_material.material_id", "bloques_material.clave"], ondelete="CASCADE",
            name="fk_banco_tono_bloque",
        ),
    )

    material_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    clave: Mapped[str] = mapped_column(String(10), primary_key=True)
    particion: Mapped[str] = mapped_column(String(10))
    semilla: Mapped[int] = mapped_column(Integer)
    orden: Mapped[int] = mapped_column(Integer, server_default="0")


class Etiqueta(Base):
    __tablename__ = "etiquetas"
    __table_args__ = (
        CheckConstraint("ronda in (1, 2)", name="ck_etiquetas_ronda"),
        ForeignKeyConstraint(
            ["material_id", "clave"], ["bloques_material.material_id", "bloques_material.clave"], ondelete="CASCADE",
            name="fk_etiquetas_bloque",
        ),
        UniqueConstraint("material_id", "clave", "dimension", "anotador", "ronda", name="uq_etiquetas_unica"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(BigInteger)
    clave: Mapped[str] = mapped_column(String(10))
    dimension: Mapped[str] = mapped_column(String(20))
    veredicto: Mapped[bool] = mapped_column(Boolean)
    critica: Mapped[str | None] = mapped_column(Text)
    version_rubrica: Mapped[str] = mapped_column(String(16))
    anotador: Mapped[str] = mapped_column(String(40), server_default="carlos")
    ronda: Mapped[int] = mapped_column(Integer, server_default="1")
    fecha: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
