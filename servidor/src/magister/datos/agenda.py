"""Tu agenda: lo que apuntas tú en el calendario (deberes, exámenes, clases, notas)."""

from datetime import date, datetime, time

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, Index, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column

from magister.datos.modelos import Base, Fecha

TIPOS = ("deber", "examen", "clase", "nota")


class Evento(Base):
    __tablename__ = "eventos"
    __table_args__ = (
        CheckConstraint("tipo in ('deber', 'examen', 'clase', 'nota')", name="ck_eventos_tipo"),
        Index("ix_eventos_fecha", "fecha"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[time | None] = mapped_column(Time)
    titulo: Mapped[str] = mapped_column(String(200))
    tipo: Mapped[str] = mapped_column(String(10), server_default="deber")
    quien: Mapped[str | None] = mapped_column(String(120))  # quién te lo asigna (un profesor, tú...)
    notas: Mapped[str | None] = mapped_column(Text)
    hecho: Mapped[bool] = mapped_column(Boolean, server_default="false")
    tema_id: Mapped[int | None] = mapped_column(BigInteger)
    creado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
