"""El corrector de respuestas abiertas: `estructurar` con la rúbrica, más dos comprobaciones
deterministas (sin ideas ausentes ni errores no hay fallo; las citas deben ser literales)."""

from typing import Literal

from pydantic import BaseModel, Field

from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar

Nota = Literal["fallo", "parcial", "bien", "perfecta"]


class Error(BaseModel):
    afirmacion: str
    por_que: str
    cita: str = ""
    cita_descartada: bool = False


class Correccion(BaseModel):
    nota: Nota
    ideas_presentes: list[str] = Field(default_factory=list)
    ideas_ausentes: list[str] = Field(default_factory=list)
    errores: list[Error] = Field(default_factory=list)
    tipo_error: Literal["olvido", "confusion", "concepto", "incompleta", "fuera_de_tema"] | None = None


def _plano(t: str) -> str:
    return " ".join(t.split()).lower()


def comprobar(c: Correccion, fragmentos: list[str]) -> Correccion:
    todo = _plano(" ".join(fragmentos))
    for e in c.errores:
        if e.cita and _plano(e.cita) not in todo:
            e.cita, e.cita_descartada = "", True
    if c.nota == "fallo" and not c.ideas_ausentes and not c.errores and c.tipo_error != "fuera_de_tema":
        c.nota = "parcial"  # un fallo tiene que decir qué falta o qué está mal
    return c


async def corregir(pregunta: str, referencia: str, fragmentos: list[str], respuesta: str) -> tuple[Correccion, str]:
    """Devuelve la corrección y la versión del corrector."""
    p = cargar("corrector")
    sistema = p.rellenar(pregunta=pregunta, referencia=referencia, respuesta=respuesta,
                         fragmentos="\n\n".join(f"<fragmento>{f}</fragmento>" for f in fragmentos) or "(sin fragmentos)")
    c = await estructurar(sistema, "Devuelve la corrección.", Correccion)
    return comprobar(c, fragmentos), p.etiqueta
