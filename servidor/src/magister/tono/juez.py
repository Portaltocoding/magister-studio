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
GOLDEN = Path(__file__).resolve().parents[1] / "cerebro" / "prompts" / "comun" / "golden_tono.md"


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
    version_golden: str = ""

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


@cache
def golden() -> tuple[str, str]:
    """Los ejemplos ya juzgados que viajan, siempre idénticos, en el prompt de sistema."""
    texto = GOLDEN.read_text(encoding="utf-8").replace("\r\n", "\n").strip()
    return texto, hashlib.sha256(texto.encode("utf-8")).hexdigest()[:12]


def sistema_juez(plantilla: str = "juez_tono") -> tuple[str, str]:
    """El prompt de sistema del juez y la etiqueta de su plantilla: solo lo fijo (rúbrica y ejemplos).

    Nada del bloque que se juzga entra aquí: así el prefijo es idéntico entre llamadas y se lee de caché."""
    p = cargar(plantilla)
    return p.rellenar(rubrica=rubrica()[0], golden=golden()[0]), p.etiqueta


def mensaje_juez(bloque: str, sospechas: list[Hallazgo] | None = None) -> str:
    """Lo variable de cada llamada: las sospechas del lint y el bloque."""
    lista = "\n".join(f"- «{h.cita}» ({h.regla})" for h in (sospechas or [])) or "(ninguna)"
    return f"Sospechas del lint:\n{lista}\n\n<bloque>\n{bloque}\n</bloque>\n\nDevuelve el veredicto."


def _normal(t: str) -> str:
    return " ".join(t.split())


async def juzgar(bloque: str, sospechas: list[Hallazgo] | None = None, plantilla: str = "juez_tono") -> Juzgado | FalloJuez:
    sistema, etiqueta = sistema_juez(plantilla)
    try:
        v = await estructurar(sistema, mensaje_juez(bloque, sospechas), Veredicto, reintentos=1, cachear=True)
    except ErrorEstructura as e:
        return FalloJuez(f"sin veredicto válido: {e}")
    plano = _normal(bloque)
    for d in DIMENSIONES:
        if _normal(getattr(v, d).fragmento) not in plano:
            return FalloJuez(f"la cita de {d} no aparece literal en el bloque")
    return Juzgado(v, etiqueta, rubrica()[1], ajustes.modelo, golden()[1])
