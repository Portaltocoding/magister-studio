"""Tus notas: lo que marcas como interesante en Estudio libre (una respuesta entera o un trozo)."""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from magister.datos.modelos import Base, Fecha


class Nota(Base):
    __tablename__ = "notas"
    __table_args__ = (Index("ix_notas_creada", "creada_en"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    texto: Mapped[str] = mapped_column(Text)
    comentario: Mapped[str | None] = mapped_column(Text)  # lo que añades tú
    # De dónde salió. Si borras la conversación, la nota se queda (con el título que tenía).
    mensaje_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("mensajes.id", ondelete="SET NULL"))
    conversacion_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("conversaciones.id", ondelete="SET NULL")
    )
    origen: Mapped[str | None] = mapped_column(String(200))
    completa: Mapped[bool] = mapped_column(Boolean, server_default="false")  # la respuesta entera o un trozo
    creada_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
