"""Prompts versionados: cada uno es un fichero `nombre.vN.md` en `cerebro/prompts/`.

Se carga la versión más alta salvo que se pida otra. La versión viaja con lo que
se genera, para poder comparar versiones con la regresión de evals.
"""

import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

CARPETA = Path(__file__).parent / "prompts"


@dataclass(frozen=True)
class Prompt:
    nombre: str
    version: int
    texto: str

    @property
    def etiqueta(self) -> str:
        return f"{self.nombre}.v{self.version}"


def versiones(nombre: str) -> list[int]:
    patron = re.compile(rf"^{re.escape(nombre)}\.v(\d+)\.md$")
    return sorted(int(m.group(1)) for p in CARPETA.iterdir() if (m := patron.match(p.name)))


@cache
def cargar(nombre: str, version: int | None = None) -> Prompt:
    disponibles = versiones(nombre)
    if not disponibles:
        raise FileNotFoundError(f"no hay prompt {nombre}")
    v = version if version is not None else disponibles[-1]
    texto = (CARPETA / f"{nombre}.v{v}.md").read_text(encoding="utf-8").strip()
    return Prompt(nombre, v, texto)
