"""Lo que entra y sale por HTTP en la v0.1 (contrato en contrato/README.md)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Salida(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TemaEntrada(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)


class TemaSalida(Salida):
    id: int
    nombre: str


class ConversacionEntrada(BaseModel):
    titulo: str = Field(min_length=1, max_length=200)
    tema_id: int | None = None


class ConversacionSalida(Salida):
    id: int
    titulo: str
    tema_id: int | None
    creada_en: datetime
    actualizada_en: datetime


class MensajeEntrada(BaseModel):
    contenido: str = Field(min_length=1, max_length=20_000)
    # «Esto no cuenta para el tutor» (docs/tutor.md, sección 2).
    cuenta: bool = True


class MensajeSalida(Salida):
    id: int
    rol: Literal["usuario", "tutor"]
    contenido: str
    estado: Literal["completo", "interrumpido", "error"]
    creado_en: datetime
