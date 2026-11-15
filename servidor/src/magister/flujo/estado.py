"""El estado del grafo del tutor. Sin historial de mensajes: eso vive en Postgres."""

import operator
from typing import Annotated, TypedDict


class Turno(TypedDict):
    rol: str
    contenido: str


class Estado(TypedDict, total=False):
    conversacion_id: int
    fase: str  # diagnostico | estudio
    hoy: str  # AAAA-MM-DD, lo pone quien invoca
    mensaje: str  # último mensaje del alumno
    turnos: list[Turno]  # historial completo de la conversación (lo pasa la API)
    perfil: dict
    plan: dict | None
    sesiones: list[dict]
    errores: Annotated[list[str], operator.add]
    intentos: int
    salida: str  # a qué nodo va tras planificar
    necesarias: float  # horas del último intento cuando no cabe
    tema_id: int | None
    plan_id: int | None
    version_prompt: str | None
