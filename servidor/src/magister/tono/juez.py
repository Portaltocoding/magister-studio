"""El juez de tono: un veredicto por dimensión con su razón y una cita literal.

Si el JSON no valida o una cita no aparece literal en el bloque, devuelve `FalloJuez`,
nunca un suspenso.
"""

import hashlib
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from pydantic import BaseModel, Field

from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.tono.hallazgo import Hallazgo

DIMENSIONES = ("razonamiento", "economia", "trato")
RUBRICA = Path(__file__).resolve().parents[4] / "docs" / "rubrica.md"


class Juicio(BaseModel):
    fragmento: str = Field(description="Cita literal y exacta del bloque")
    razon: str = Field(description="Primero la razón")
    aprueba: bool = Field(description="Después el veredicto")


class Veredicto(BaseModel):
    razonamiento: Juicio
    economia: Juicio
    trato: Juicio


@dataclass
class FalloJuez:
    motivo: str


@dataclass
class Juzgado:
    veredicto: Veredicto
    version_prompt: str
    version_rubrica: str
    modelo: str

    def suspensos(self, bloque: str = "") -> list[Hallazgo]:
        salida = []
        for d in DIMENSIONES:
            j: Juicio = getattr(self.veredicto, d)
            if not j.aprueba:
                salida.append(Hallazgo(bloque=bloque, cita=j.fragmento, regla=d, por_que=j.razon, gravedad="aviso", origen=f"juez:{d}"))
        return salida


@cache
def rubrica() -> tuple[str, str]:
    texto = RUBRICA.read_text(encoding="utf-8")
    return texto, hashlib.sha256(texto.encode("utf-8")).hexdigest()[:12]


def _normal(t: str) -> str:
    return " ".join(t.split())


async def juzgar(bloque: str, sospechas: list[Hallazgo] | None = None, plantilla: str = "juez_tono") -> Juzgado | FalloJuez:
    texto_rubrica, version_rubrica = rubrica()
    p = cargar(plantilla)
    sistema = p.rellenar(
        rubrica=texto_rubrica,
        sospechas="\n".join(f"- «{h.cita}» ({h.regla})" for h in (sospechas or [])) or "(ninguna)",
        bloque=bloque,
    )
    try:
        v = await estructurar(sistema, "Devuelve el veredicto.", Veredicto, reintentos=1)
    except ErrorEstructura as e:
        return FalloJuez(f"sin veredicto válido: {e}")
    plano = _normal(bloque)
    for d in DIMENSIONES:
        if _normal(getattr(v, d).fragmento) not in plano:
            return FalloJuez(f"la cita de {d} no aparece literal en el bloque")
    return Juzgado(v, p.etiqueta, version_rubrica, ajustes.modelo)
