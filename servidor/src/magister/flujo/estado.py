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
    voz: bool  # el alumno habla y escucha (modo Hablar): respuestas para el oído
    llamada: bool  # llamada de voz por turnos
    modo: str | None  # modo de aprendizaje solo para este mensaje
    plan_id_leccion: int | None  # lección de la que se habla
    leccion_clave: str | None
    contexto: str | None  # dónde está la llamada
    corregir: bool  # en la llamada, el alumno responde a una pregunta del tutor: la corrige el modelo grande
    asesor: bool  # la mascota flotante: contesta corto sobre la pantalla que tiene abierta (va en `contexto`)
    nota_guardada: bool  # la app acaba de guardar en Mis notas la respuesta anterior
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
    # Rama de estudio con fuentes (Parte III)
    consulta: str | None
    aclaracion: str | None
    recuperados: list[dict]
    busqueda_id: int | None
    citas: list[dict]
