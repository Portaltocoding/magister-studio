"""Un hallazgo del lint o del juez, siempre con la cita exacta del texto."""

from typing import Literal

from pydantic import BaseModel, Field

Gravedad = Literal["veto", "aviso", "sospecha"]


class Hallazgo(BaseModel):
    bloque: str = ""
    cita: str = Field(min_length=1, description="Fragmento exacto del texto")
    regla: str
    por_que: str = ""
    que_falta: str = ""
    gravedad: Gravedad
    origen: str = "lint"  # lint o juez:<dimension>
    posicion: int | None = None
