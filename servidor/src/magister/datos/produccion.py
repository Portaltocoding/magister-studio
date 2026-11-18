"""Tablas de la Parte VI: observabilidad, alertas, banco de candidatos, caché y versiones de prompts."""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Float, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from magister.datos.modelos import Base, Fecha


class LlamadaFila(Base):
    __tablename__ = "llamadas"
    __table_args__ = (Index("ix_llamadas_creada", "creada"), Index("ix_llamadas_traza", "traza_id"))

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    traza_id: Mapped[str | None] = mapped_column(String(64))
    funcion: Mapped[str] = mapped_column(String(40))
    motor: Mapped[str] = mapped_column(String(20))
    modelo_pedido: Mapped[str] = mapped_column(String(60))
    modelo_respondido: Mapped[str | None] = mapped_column(String(80))
    tokens_entrada: Mapped[int] = mapped_column(Integer, server_default="0")
    tokens_salida: Mapped[int] = mapped_column(Integer, server_default="0")
    tokens_cache_lectura: Mapped[int] = mapped_column(Integer, server_default="0")
    tokens_cache_escritura: Mapped[int] = mapped_column(Integer, server_default="0")
    coste_equivalente: Mapped[float] = mapped_column(Float, server_default="0")
    ttft_ms: Mapped[int | None] = mapped_column(Integer)
    total_ms: Mapped[int] = mapped_column(Integer)
    reintentos: Mapped[int] = mapped_column(Integer, server_default="0")
    respaldo: Mapped[bool] = mapped_column(Boolean, server_default="false")
    error: Mapped[str | None] = mapped_column(Text)
    prompt_nombre: Mapped[str | None] = mapped_column(String(40))
    prompt_version: Mapped[str | None] = mapped_column(String(16))
    creada: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class Puntuacion(Base):
    __tablename__ = "puntuaciones"
    __table_args__ = (UniqueConstraint("traza_id", "nombre", name="uq_puntuaciones_traza_nombre"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    traza_id: Mapped[str] = mapped_column(String(64))
    nombre: Mapped[str] = mapped_column(String(40))
    valor: Mapped[float] = mapped_column(Float)
    comentario: Mapped[str | None] = mapped_column(Text)
    # La versión de la rúbrica con la que juzgó el juez (las demás puntuaciones no la llevan).
    version: Mapped[str | None] = mapped_column(String(16))
    creada: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class Alerta(Base):
    __tablename__ = "alertas"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(40))
    detalle: Mapped[str] = mapped_column(Text)
    creada: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
    leida: Mapped[bool] = mapped_column(Boolean, server_default="false")
    resuelta: Mapped[bool] = mapped_column(Boolean, server_default="false")


class CandidatoBanco(Base):
    __tablename__ = "candidatos_banco"
    __table_args__ = (
        CheckConstraint("origen in ('feedback', 'juez', 'otra_explicacion', 'aleatorio')", name="ck_candidatos_origen"),
        CheckConstraint("estado in ('pendiente', 'aceptado', 'descartado')", name="ck_candidatos_estado"),
        UniqueConstraint("traza_id", name="uq_candidatos_traza"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    traza_id: Mapped[str] = mapped_column(String(64))
    origen: Mapped[str] = mapped_column(String(20))
    estado: Mapped[str] = mapped_column(String(12), server_default="pendiente")
    banco: Mapped[str | None] = mapped_column(String(40))
    nota: Mapped[str | None] = mapped_column(Text)
    entrada: Mapped[str] = mapped_column(Text)
    salida: Mapped[str | None] = mapped_column(Text)
    respuesta_buena: Mapped[str | None] = mapped_column(Text)
    creado: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
    # Tu feedback en el triaje: un comentario libre, los motivos marcados y, en los suspensos del juez, si acertó.
    comentario: Mapped[str | None] = mapped_column(Text)
    motivos: Mapped[list] = mapped_column(JSONB, server_default="[]")
    juez_acerto: Mapped[bool | None] = mapped_column(Boolean)


class CacheRespuesta(Base):
    __tablename__ = "cache_respuestas"

    clave: Mapped[str] = mapped_column(String(64), primary_key=True)
    respuesta: Mapped[str] = mapped_column(Text)
    modelo: Mapped[str] = mapped_column(String(60))
    aciertos: Mapped[int] = mapped_column(Integer, server_default="0")
    creada: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class PromptVersion(Base):
    __tablename__ = "prompts_versiones"

    nombre: Mapped[str] = mapped_column(String(40), primary_key=True)
    version: Mapped[str] = mapped_column(String(16), primary_key=True)
    contenido: Mapped[str] = mapped_column(Text)
    creada: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())


class PromptActivo(Base):
    __tablename__ = "prompts_activos"

    nombre: Mapped[str] = mapped_column(String(40), primary_key=True)
    version: Mapped[str] = mapped_column(String(16))


class Ajuste(Base):
    """Datos de la instalación (por ejemplo, el canario generado al instalar)."""

    __tablename__ = "instalacion"

    clave: Mapped[str] = mapped_column(String(40), primary_key=True)
    valor: Mapped[dict] = mapped_column(JSONB)
