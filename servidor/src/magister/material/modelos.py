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
    preferencias: dict = {}
    materia: str | None = Field(None, description="Perfil de explicación del tema (derecho, exactas...); None si no se ha elegido")


class Definicion(BaseModel):
    termino: str
    ingles: str | None = Field(None, description="Término en inglés si se usa en la práctica, si no null")
    definicion: str = Field(description="Una frase")


class Formula(BaseModel):
    nombre: str = Field(description="Cómo se llama: «Ley de Ohm», «Derivada de un producto»")
    latex: str = Field(description=r"La fórmula en LaTeX, sin $: V = I \cdot R")
    significado: str = Field(description="Una frase: qué es cada símbolo y cuándo se usa")


class BloqueContrato(BaseModel):
    clave: str = Field(description="b1, b2...")
    titulo: str
    conceptos: list[str] = Field(description="ids de los conceptos que este bloque define o explica")
    proposito: str = Field(description="Qué pregunta responde este bloque y por qué va aquí")


class Contrato(BaseModel):
    razonamiento: str = Field(description="Primero: por qué este orden de bloques")
    definiciones: list[Definicion]
    formulas: list[Formula] = Field(default_factory=list, description="Solo si la lección tiene fórmulas; si no, lista vacía")
    bloques: list[BloqueContrato] = Field(min_length=2, max_length=6)


TipoPregunta = Literal["conceptual", "calculo", "fallo", "escenario", "hablada", "test"]


class OpcionTest(BaseModel):
    texto: str
    buena: bool = False


class PreguntaGen(BaseModel):
    conceptos: list[str] = Field(min_length=1, description="ids de conceptos de la lección")
    tipo: TipoPregunta
    enunciado: str
    fantasma: str = Field(description="Respuesta modelo de unas 60 palabras, con la sección de los apuntes entre paréntesis")
    donde: str = Field(description="Clave del bloque de los apuntes donde se explica (b1, b2...)")
    opciones: list[OpcionTest] = Field(default_factory=list, description="Solo tipo test: 3 o 4, una sola buena")


class ListaPreguntas(BaseModel):
    preguntas: list[PreguntaGen] = Field(min_length=3, max_length=14)


class ListaTests(BaseModel):
    preguntas: list[PreguntaGen] = Field(min_length=2, max_length=8)
