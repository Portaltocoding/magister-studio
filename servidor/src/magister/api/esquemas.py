"""Lo que entra y sale por HTTP en la v0.1 (contrato en contrato/README.md)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Salida(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TemaEntrada(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)


class TemaSalida(Salida):
    id: int
    nombre: str
    materia: str | None = None  # perfil de explicación (derecho, exactas...); None hasta que hace falta


class MateriaEntrada(BaseModel):
    materia: str | None = Field(None, max_length=20, description="Un perfil de GET /api/materias, o null para que se vuelva a elegir solo")


class ConversacionEntrada(BaseModel):
    titulo: str = Field(min_length=1, max_length=200)
    tema_id: int | None = None
    # libre: Estudio libre; plan: conversación de diagnóstico que acaba en un plan; asesor: la mascota flotante
    tipo: Literal["libre", "plan", "asesor"] = "libre"


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
    # En la llamada, el alumno responde a una pregunta del tutor: la corrige el modelo grande (tarea «corregir»).
    corregir: bool = False
    # El asesor: la mascota flotante que contesta sobre la pantalla que tienes abierta (en `contexto` va lo que ves).
    asesor: bool = False
    # El proyecto que tiene en pantalla: sobre él prepara el asesor los cambios que ofrece (los aplicas tú).
    proyecto_id: int | None = None
    # El plan activo de la app (el de Roadmap, Calendario y Hoy): sobre él prepara el asesor los cambios del calendario.
    # No es `plan_id`, que es el de la lección de la que se habla.
    plan_activo_id: int | None = None
    # Cabe el banco entero del examen oral (unas 20 preguntas pasan de 3000 caracteres).
    contexto: str | None = Field(None, max_length=12_000)

    @field_validator("contenido")
    @classmethod
    def _no_en_blanco(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("el mensaje está vacío")
        return v


class MensajeSalida(Salida):
    id: int
    rol: Literal["usuario", "tutor"]
    contenido: str
    estado: Literal["completo", "interrumpido", "error"]
    creado_en: datetime
    citas: list[dict] = []
    traza_id: str | None = None
    voto: bool | None = None
    # «Esto no cuenta para el tutor»: se guarda por mensaje para que lo que lea el perfil pueda excluirlo.
    cuenta: bool = True


class DecisionEntrada(BaseModel):
    accion: Literal["aceptar", "cambiar", "descartar"]
    texto: str | None = Field(None, max_length=5000)
