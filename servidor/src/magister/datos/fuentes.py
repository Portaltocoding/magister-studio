"""Tablas de la Parte III: procedencia (fuentes, documentos, versiones, fragmentos),
configuraciones del índice, trazas de búsqueda, citas, research y apoyo por lección."""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from magister.datos.modelos import Base, Fecha

DIMENSION = 384  # multilingual-e5-small

ESTADOS_VERSION = ("recibida", "pendiente", "lista", "cuarentena", "retirada")


class Fuente(Base):
    __tablename__ = "fuentes"
    __table_args__ = (
        CheckConstraint("tipo in ('vault', 'pdf', 'libro', 'web', 'audio')", name="ck_fuentes_tipo"),
        CheckConstraint("confianza between 1 and 3", name="ck_fuentes_confianza"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(200), unique=True)
    tipo: Mapped[str] = mapped_column(String(10))
    confianza: Mapped[int] = mapped_column(Integer)
    creada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class Documento(Base):
    __tablename__ = "documentos"
    __table_args__ = (UniqueConstraint("fuente_id", "uri", name="uq_documentos_fuente_uri"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fuente_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("fuentes.id", ondelete="CASCADE"))
    uri: Mapped[str] = mapped_column(Text)
    titulo: Mapped[str] = mapped_column(Text)
    tema_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("temas.id", ondelete="SET NULL"))
    creado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class Version(Base):
    __tablename__ = "versiones"
    __table_args__ = (
        CheckConstraint(
            "estado in ('recibida', 'pendiente', 'lista', 'cuarentena', 'retirada')", name="ck_versiones_estado"
        ),
        UniqueConstraint("documento_id", "hash", name="uq_versiones_documento_hash"),
        Index("ix_versiones_duplicado_de", "duplicado_de"),
        Index("ix_versiones_estado", "estado"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    documento_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("documentos.id", ondelete="CASCADE"))
    hash: Mapped[str | None] = mapped_column(String(64))
    crudo_hash: Mapped[str] = mapped_column(String(64))
    crudo_tipo: Mapped[str] = mapped_column(String(10), server_default="")
    texto: Mapped[str | None] = mapped_column(Text)
    metadatos: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    extractor: Mapped[str | None] = mapped_column(String(120))
    estado: Mapped[str] = mapped_column(String(12))
    motivo: Mapped[str | None] = mapped_column(Text)
    minhash: Mapped[list[int] | None] = mapped_column(ARRAY(BigInteger))
    duplicado_de: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("versiones.id", ondelete="SET NULL"))
    ingerida_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class Configuracion(Base):
    __tablename__ = "configuraciones"
    __table_args__ = (
        Index("uq_configuraciones_activa", "activa", unique=True, postgresql_where="activa"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(40), unique=True)
    params: Mapped[dict] = mapped_column(JSONB)
    activa: Mapped[bool] = mapped_column(Boolean, server_default="false")
    creada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class Fragmento(Base):
    __tablename__ = "fragmentos"
    __table_args__ = (
        Index("ix_fragmentos_version", "version_id"),
        Index("ix_fragmentos_lexico", "lexico", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("versiones.id", ondelete="CASCADE"))
    config_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("configuraciones.id", ondelete="CASCADE"))
    orden: Mapped[int] = mapped_column(Integer)
    inicio: Mapped[int] = mapped_column(Integer)
    fin: Mapped[int] = mapped_column(Integer)
    texto: Mapped[str] = mapped_column(Text)
    texto_indexado: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(DIMENSION))
    lexico: Mapped[str] = mapped_column(
        TSVECTOR, Computed("to_tsvector('spanish', texto_indexado)", persisted=True)
    )


class Busqueda(Base):
    __tablename__ = "busquedas"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    consulta: Mapped[str] = mapped_column(Text)
    consulta_reescrita: Mapped[str | None] = mapped_column(Text)
    config_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("configuraciones.id", ondelete="SET NULL"))
    via: Mapped[str] = mapped_column(String(10))
    densa: Mapped[list | None] = mapped_column(JSONB)
    lexica: Mapped[list | None] = mapped_column(JSONB)
    fusion: Mapped[list | None] = mapped_column(JSONB)
    reranker: Mapped[list | None] = mapped_column(JSONB)
    ms: Mapped[int] = mapped_column(Integer)
    ms_reranker: Mapped[int | None] = mapped_column(Integer)
    # Dónde se resolvió «hay fuentes»: lexica, densa, reranker o nada (nulo en las búsquedas de antes).
    escalon: Mapped[str | None] = mapped_column(String(10))
    creada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class MensajeCita(Base):
    __tablename__ = "mensajes_citas"

    mensaje_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("mensajes.id", ondelete="CASCADE"), primary_key=True)
    fragmento_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("fragmentos.id", ondelete="CASCADE"), primary_key=True
    )
    cita_literal: Mapped[str] = mapped_column(Text)
    dudosa: Mapped[bool] = mapped_column(Boolean)
    busqueda_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("busquedas.id", ondelete="SET NULL"))


class TareaResearch(Base):
    __tablename__ = "tareas_research"
    __table_args__ = (
        CheckConstraint("sistema in ('fijo', 'agente')", name="ck_tareas_research_sistema"),
        CheckConstraint("estado in ('en_curso', 'acabada', 'cortada')", name="ck_tareas_research_estado"),
        ForeignKeyConstraint(
            ["plan_id", "leccion_clave"], ["lecciones.plan_id", "lecciones.clave"], ondelete="CASCADE",
            name="fk_tareas_research_leccion",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(BigInteger)
    leccion_clave: Mapped[str] = mapped_column(String(20))
    sistema: Mapped[str] = mapped_column(String(10))
    estado: Mapped[str] = mapped_column(String(10), server_default="en_curso")
    estado_agente: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    trayectoria: Mapped[list] = mapped_column(JSONB, server_default="[]")
    pasos: Mapped[int] = mapped_column(Integer, server_default="0")
    llamadas_modelo: Mapped[int] = mapped_column(Integer, server_default="0")
    motivo_fin: Mapped[str | None] = mapped_column(Text)
    creada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
    acabada_en: Mapped[datetime | None] = mapped_column(Fecha)


class Propuesta(Base):
    __tablename__ = "propuestas"
    __table_args__ = (
        CheckConstraint("estado in ('pendiente', 'aprobada', 'rechazada')", name="ck_propuestas_estado"),
        UniqueConstraint("url", "plan_id", "leccion_clave", name="uq_propuestas_url_leccion"),
        ForeignKeyConstraint(
            ["plan_id", "leccion_clave"], ["lecciones.plan_id", "lecciones.clave"], ondelete="CASCADE",
            name="fk_propuestas_leccion",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tarea_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("tareas_research.id", ondelete="SET NULL"))
    url: Mapped[str] = mapped_column(Text)
    titulo: Mapped[str | None] = mapped_column(Text)
    plan_id: Mapped[int] = mapped_column(BigInteger)
    leccion_clave: Mapped[str] = mapped_column(String(20))
    motivo: Mapped[str] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(String(10), server_default="pendiente")
    version_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("versiones.id", ondelete="SET NULL"))
    creada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class LeccionFragmento(Base):
    __tablename__ = "lecciones_fragmentos"
    __table_args__ = (
        ForeignKeyConstraint(
            ["plan_id", "leccion_clave"], ["lecciones.plan_id", "lecciones.clave"], ondelete="CASCADE",
            name="fk_lecciones_fragmentos_leccion",
        ),
    )

    plan_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    leccion_clave: Mapped[str] = mapped_column(String(20), primary_key=True)
    fragmento_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("fragmentos.id", ondelete="CASCADE"), primary_key=True
    )
    rango: Mapped[int] = mapped_column(Integer)
    puntuacion: Mapped[float] = mapped_column(Float)


class LeccionApoyo(Base):
    __tablename__ = "lecciones_apoyo"
    __table_args__ = (
        ForeignKeyConstraint(
            ["plan_id", "leccion_clave"], ["lecciones.plan_id", "lecciones.clave"], ondelete="CASCADE",
            name="fk_lecciones_apoyo_leccion",
        ),
    )

    plan_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    leccion_clave: Mapped[str] = mapped_column(String(20), primary_key=True)
    n_fragmentos: Mapped[int] = mapped_column(Integer)
    sin_material: Mapped[bool] = mapped_column(Boolean)
    calculado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
