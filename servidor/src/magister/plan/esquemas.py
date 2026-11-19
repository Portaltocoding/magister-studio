"""Perfil y Plan: el contrato entre el modelo y el resto del producto.

Código puro: `magister.plan` no importa de `datos`, `cerebro` ni `config`.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

HORAS_MAX_DIA = 12.0  # el mismo tope que la ruta del horario

Nivel = Literal["nada", "basico", "intermedio", "avanzado"]

# Si una lección necesita fuentes de fuera (ADR-0021). «no»: lo explica bien cualquier modelo (dividir, qué es una
# variable); «conviene»: una buena fuente mejora la explicación; «imprescindible»: lo que caduca, lo muy especializado,
# lo que exige cita o el temario concreto de su curso.
Necesidad = Literal["no", "conviene", "imprescindible"]
NECESIDADES: tuple[str, ...] = ("no", "conviene", "imprescindible")


class Perfil(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tema: str | None = Field(None, description="Nombre corto de lo que quiere aprender, de 2 a 8 palabras, sin listas ni paréntesis (por ejemplo «Conceptos de fullstack senior»). null si aún no lo ha dicho.")
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

    @field_validator("horas_por_dia")
    @classmethod
    def _tope_por_dia(cls, valor: list[float] | None) -> list[float] | None:
        # Lo que pase de 12 h en un día se recorta, no se rechaza: así un perfil guardado antes del tope se sigue leyendo.
        return None if valor is None else [min(h, HORAS_MAX_DIA) for h in valor]


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
    # Si hace falta buscar fuentes para esta lección (ADR-0021). Los planes guardados antes de decidirlo se leen como
    # «conviene»: se busca por si acaso, como hasta ahora.
    necesita_fuentes: Necesidad = "conviene"
    fuentes_por_que: str = ""


DESCRIPCION_NECESITA = (
    "Si hace falta buscar fuentes para estudiar esta lección: no (conocimiento básico y estable que cualquier modelo "
    "explica bien), conviene (una buena fuente mejora la explicación) o imprescindible (lo que cambia o caduca, lo muy "
    "especializado, lo que exige cita o el temario concreto de su curso)."
)


class LeccionNueva(Leccion):
    """La lección que escribe el modelo: tiene que decir si necesita fuentes y por qué (las guardadas pueden no tenerlo)."""

    necesita_fuentes: Necesidad = Field(description=DESCRIPCION_NECESITA)
    fuentes_por_que: str = Field(
        min_length=3, description="Una frase corta para el alumno: por qué hace falta buscar fuentes o por qué no."
    )

    @field_validator("fuentes_por_que")
    @classmethod
    def _motivo_no_vacio(cls, valor: str) -> str:
        if len(valor.strip()) < 3:
            raise ValueError("di en una frase por qué esta lección necesita fuentes o no")
        return valor.strip()


Alcance = Literal["procedimiento", "concepto", "tema", "tema_amplio", "tema_master", "asignatura"]


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    razonamiento: str = Field(description="Primero: qué alcance tiene lo que pide, y por qué este orden y este reparto de horas.")
    alcance: Alcance | None = Field(
        None,
        description="Qué es lo que pide: procedimiento (despejar x), concepto (una idea concreta, aunque tenga requisitos, "
        "clases o variantes: la ley de Ohm, la legítima defensa con sus requisitos), tema (varias ideas que forman un bloque "
        "de una asignatura: las integrales), tema_amplio (redes para una entrevista), tema_master (un debate de máster) o "
        "asignatura (un temario entero). Marca cuántas horas puede tener el plan.",
    )
    lecciones: list[Leccion] = Field(min_length=1)

    @property
    def total_horas(self) -> float:
        return round(sum(lec.horas for lec in self.lecciones), 2)


class PlanNuevo(Plan):
    """El plan que escribe el modelo: con el alcance obligatorio y, en cada lección, si necesita fuentes (los ya
    guardados pueden no tenerlos)."""

    alcance: Alcance = Field(description=Plan.model_fields["alcance"].description)
    lecciones: list[LeccionNueva] = Field(min_length=1)
