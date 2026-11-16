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
    # libre: Estudio libre; plan: conversación de diagnóstico que acaba en un plan
    tipo: Literal["libre", "plan"] = "libre"


class ConversacionSalida(Salida):
    id: int
    titulo: str
    tema_id: int | None
    tipo: str
    creada_en: datetime
    actualizada_en: datetime


class MensajeEntrada(BaseModel):
    contenido: str = Field(min_length=1, max_length=20_000)
    # «Esto no cuenta para el tutor» (docs/tutor.md, sección 2).
    cuenta: bool = True
    # Modo Hablar: la respuesta se va a escuchar.
    voz: bool = False
    # Llamada: conversación de voz por turnos (respuestas cortas, sin bloques que se pulsan).
    llamada: bool = False
    # Modo de aprendizaje solo para este mensaje (manda sobre el elegido en la mascota); «normal» lo quita.
    modo: str | None = Field(None, max_length=60)
    # Lección de la que se habla: sus apuntes van al tutor como contexto.
    plan_id: int | None = None
    leccion_clave: str | None = Field(None, max_length=20)
    # Dónde está la llamada (por ejemplo, la parte de la clase en la que le interrumpes). No se guarda en el hilo.
    contexto: str | None = Field(None, max_length=3000)


class MensajeSalida(Salida):
    id: int
    rol: Literal["usuario", "tutor"]
    contenido: str
    estado: Literal["completo", "interrumpido", "error"]
    creado_en: datetime
    citas: list[dict] = []
    traza_id: str | None = None
    voto: bool | None = None


class DecisionEntrada(BaseModel):
    accion: Literal["aceptar", "cambiar"]
    texto: str | None = Field(None, max_length=5000)
