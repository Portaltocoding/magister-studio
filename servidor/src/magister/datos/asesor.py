"""Los cambios que propone el asesor: qué propuso, sobre qué estado del proyecto, qué decidiste y cómo deshacerlo.

Cada fila es también el registro de lo que pasó: propuesta → aplicada (→ deshecha) | descartada | caducada.
"""

from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from magister.datos.modelos import Base, Fecha


class CambioAsesor(Base):
    __tablename__ = "asesor_cambios"
    __table_args__ = (Index("ix_asesor_cambios_conversacion", "conversacion_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    conversacion_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("conversaciones.id", ondelete="CASCADE"))
    # La respuesta del asesor que lo propuso (su tarjeta va debajo de ella).
    mensaje_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("mensajes.id", ondelete="SET NULL"))
    proyecto_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("proyectos.id", ondelete="CASCADE"))
    encargo: Mapped[str] = mapped_column(Text)  # lo que el asesor pidió, en sus palabras
    resumen: Mapped[str] = mapped_column(Text)
    acciones: Mapped[list] = mapped_column(JSONB)  # las acciones validadas (cambios.Accion)
    lineas: Mapped[list] = mapped_column(JSONB)  # lo que se enseña: [{texto, motivo}], escrito por el código
    # Lo que miró antes de proponer: [{herramienta, consulta}] (se enseña en la tarjeta).
    lecturas: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    # Lo que pedía el encargo y no cabe en la propuesta, con qué hacer (se enseña en la tarjeta).
    pendiente: Mapped[str | None] = mapped_column(Text)
    # propuesta | aplicada | descartada | deshecha | caducada
    estado: Mapped[str] = mapped_column(String(20), server_default="propuesta")
    # La huella del proyecto cuando se propuso: si cambia antes de aplicarlo, la propuesta caduca.
    huella: Mapped[str | None] = mapped_column(String(64))
    # Al aplicarlo: el proyecto de antes, lo creado aparte (decisiones, notas) y la huella de después.
    deshacer: Mapped[dict | None] = mapped_column(JSONB)
    motivo_estado: Mapped[str | None] = mapped_column(Text)
    prompt: Mapped[str | None] = mapped_column(String(80))  # nombre@versión de la plantilla que lo produjo
    creado_en: Mapped[datetime] = mapped_column(Fecha, server_default=func.now())
    decidido_en: Mapped[datetime | None] = mapped_column(Fecha)
