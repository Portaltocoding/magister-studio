"""Proyectos: algo que construyes. Magister saca de la idea un roadmap de construcción (niveles, bloques y pasos que
mezclan lo que haces con lo que necesitas saber), lleva lo que has hecho y un diario de decisiones (como los ADR)."""

from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from magister.datos.modelos import Base, Fecha


class Proyecto(Base):
    __tablename__ = "proyectos"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(200))
    # Lo que contaste al crearlo: la idea, para qué, qué sabes ya y a qué ritmo.
    idea: Mapped[str] = mapped_column(Text)
    objetivo: Mapped[str | None] = mapped_column(Text)
    sabes: Mapped[str | None] = mapped_column(Text)
    ritmo: Mapped[str | None] = mapped_column(String(200))
    # generando | listo | error. Mientras se genera (o se detalla un nivel), `trabajo_id` es el trabajo de la cola.
    estado: Mapped[str] = mapped_column(String(20), server_default="generando")
    trabajo_id: Mapped[int | None] = mapped_column(BigInteger)
    error: Mapped[str | None] = mapped_column(Text)
    roadmap: Mapped[dict | None] = mapped_column(JSONB)
    referencias: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    arquitectura_svg: Mapped[str | None] = mapped_column(Text)
    # Los ids de los pasos que has marcado como hechos (aparte del roadmap: detallar un nivel no los borra).
    hechos: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    # Cuándo marcaste cada paso ({id: fecha ISO}): para retomar («lo dejaste hace 3 días en…»).
    hechos_en: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    # El roadmap de antes del último «rehacer» ({"roadmap", "arquitectura_svg", "trabajo_id"}), para poder volver a
    # él. Una sola copia: la última. `trabajo_id` es el trabajo que lo reemplazó (si se reintenta, no se pisa).
    roadmap_anterior: Mapped[dict | None] = mapped_column(JSONB)
    creado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
    actualizado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now(), onupdate=func.now())


class Decision(Base):
    """Una entrada del diario: qué decidiste, por qué y qué implica (el formato de un ADR, en corto)."""

    __tablename__ = "proyecto_decisiones"
    __table_args__ = (Index("ix_proyecto_decisiones_proyecto", "proyecto_id", "creada_en"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    proyecto_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("proyectos.id", ondelete="CASCADE"))
    titulo: Mapped[str] = mapped_column(String(300))
    contexto: Mapped[str | None] = mapped_column(Text)
    decision: Mapped[str] = mapped_column(Text)
    consecuencias: Mapped[str | None] = mapped_column(Text)
    paso_id: Mapped[str | None] = mapped_column(String(40))  # el paso en el que la tomaste, si fue en uno
    creada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
