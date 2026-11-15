"""Perfil y Plan: el contrato entre el modelo y el resto del producto.

Código puro: `magister.plan` no importa de `datos`, `cerebro` ni `config`.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Nivel = Literal["nada", "basico", "intermedio", "avanzado"]


class Perfil(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tema: str | None = Field(None, description="Qué quiere aprender, en pocas palabras. null si aún no lo ha dicho.")
    objetivo: str | None = Field(
        None, description="Para qué lo quiere (una entrevista, un proyecto, curiosidad). null si no lo ha dicho."
    )
    nivel: Nivel | None = Field(
        None,
        description="Lo que ya sabe del tema: nada, basico, intermedio o avanzado. null si no lo ha dicho.",
    )
    horas_por_dia: list[float] | None = Field(
        None,
        min_length=7,
        max_length=7,
        description=(
            "Horas de estudio de lunes a domingo, siete números. «Entre semana» son lunes a viernes "
            "con sábado y domingo a 0; «todos los días» son los siete. null si no lo ha dicho."
        ),
    )
    inicio_por_dia: list[str | None] | None = Field(
        None,
        min_length=7,
        max_length=7,
        description="Hora de inicio «HH:MM» de lunes a domingo, null en los días sin estudio o si no la dijo.",
    )
    plazo: date | None = Field(
        None, description="Fecha límite AAAA-MM-DD calculada desde la fecha de hoy. null si no hay o no la dijo."
    )
    sin_plazo: bool = Field(False, description="true solo si dijo expresamente que no tiene fecha límite.")
    preferencias: str | None = Field(None, description="Cómo le gusta aprender, si lo dijo.")
    notas: str | None = Field(None, description="Cualquier otro dato útil para el plan.")


class Concepto(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9-]+$", description="Identificador en minúsculas con guiones, único en el plan.")
    nombre: str = Field(description="Nombre legible del concepto.")


class Leccion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clave: str = Field(description="L1, L2, L3... en orden.")
    titulo: str
    objetivos: list[str] = Field(
        min_length=1, description="Lo que sabrás hacer al acabar, empezando por un verbo observable."
    )
    conceptos: list[Concepto] = Field(min_length=1, max_length=5, description="De uno a cinco conceptos.")
    horas: float = Field(gt=0, description="Horas de estudio de la lección.")
    depende_de: list[str] = Field(default_factory=list, description="Claves de las lecciones que hay que saber antes.")


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    razonamiento: str = Field(description="Primero: por qué este orden y este reparto de horas.")
    lecciones: list[Leccion] = Field(min_length=1)

    @property
    def total_horas(self) -> float:
        return round(sum(lec.horas for lec in self.lecciones), 2)
