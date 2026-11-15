"""Lo que entra y sale de los generadores de material (Parte IV)."""

from typing import Literal

from pydantic import BaseModel, Field


class ConceptoMaterial(BaseModel):
    id: str
    nombre: str
    sinonimos: list[str] = []
    nucleo: bool = True
    depende_de: list[str] = []


class FragmentoFuente(BaseModel):
    id: int
    texto: str
    titulo: str
    tipo: str


class EntradaMaterial(BaseModel):
    plan_id: int
    leccion_clave: str
    tema: str
    titulo: str
    objetivos: list[str]
    conceptos: list[ConceptoMaterial]
    previos: list[str] = Field(default_factory=list, description="ids de conceptos de lecciones anteriores")
    fragmentos: list[FragmentoFuente] = []
    perfil: dict = {}


class Definicion(BaseModel):
    termino: str
    ingles: str | None = Field(None, description="Término en inglés si se usa en la práctica, si no null")
    definicion: str = Field(description="Una frase")


class BloqueContrato(BaseModel):
    clave: str = Field(description="b1, b2...")
    titulo: str
    conceptos: list[str] = Field(description="ids de los conceptos que este bloque define o explica")
    proposito: str = Field(description="Qué pregunta responde este bloque y por qué va aquí")


class Contrato(BaseModel):
    razonamiento: str = Field(description="Primero: por qué este orden de bloques")
    definiciones: list[Definicion]
    bloques: list[BloqueContrato] = Field(min_length=2, max_length=6)


TipoPregunta = Literal["conceptual", "calculo", "fallo", "escenario", "hablada"]


class PreguntaGen(BaseModel):
    conceptos: list[str] = Field(min_length=1, description="ids de conceptos de la lección")
    tipo: TipoPregunta
    enunciado: str
    fantasma: str = Field(description="Respuesta modelo de unas 60 palabras, con la sección de los apuntes entre paréntesis")
    donde: str = Field(description="Clave del bloque de los apuntes donde se explica (b1, b2...)")


class ListaPreguntas(BaseModel):
    preguntas: list[PreguntaGen] = Field(min_length=3, max_length=12)
