"""Plantillas de prompt: cada una es un fichero `cerebro/prompts/<nombre>.md`.

La versión es el hash del fichero: cambias una coma y cambia la versión, así que
ninguna medida mezcla dos prompts sin saberlo. Los huecos van como `{nombre}` y
`rellenar` falla si falta alguno.
"""

import hashlib
import re
import string
from dataclasses import dataclass
from functools import cache
from pathlib import Path

CARPETA = Path(__file__).parent / "prompts"


class ErrorPlantilla(Exception):
    pass


@dataclass(frozen=True)
class Plantilla:
    nombre: str
    version: str
    texto: str

    @property
    def etiqueta(self) -> str:
        return f"{self.nombre}@{self.version}"

    @property
    def huecos(self) -> set[str]:
        return {campo for _, campo, _, _ in string.Formatter().parse(self.texto) if campo}

    def rellenar(self, **valores: object) -> str:
        faltan = self.huecos - valores.keys()
        if faltan:
            raise ErrorPlantilla(f"a la plantilla {self.nombre} le faltan: {', '.join(sorted(faltan))}")
        # Solo se sustituyen los huecos conocidos; las llaves de ejemplos JSON se escriben dobles.
        return self.texto.format(**{k: v for k, v in valores.items() if k in self.huecos})


@cache
def _del_fichero(nombre: str) -> Plantilla:
    if not re.fullmatch(r"[a-z_]+", nombre):
        raise ErrorPlantilla(f"nombre de plantilla no válido: {nombre}")
    ruta = CARPETA / f"{nombre}.md"
    crudo = ruta.read_bytes()
    return Plantilla(nombre, hashlib.sha256(crudo).hexdigest()[:12], crudo.decode("utf-8").strip())


# Versiones activas (Parte VI, «Vuelta atrás de un prompt»): `sincronizar()` las carga de la
# base al arrancar la API. Sin ellas, manda el fichero.
ACTIVAS: dict[str, Plantilla] = {}


def cargar(nombre: str) -> Plantilla:
    from magister.cerebro.modelo import prompt_actual

    p = ACTIVAS.get(nombre) or _del_fichero(nombre)
    prompt_actual.set((p.nombre, p.version))
    return p


def ficheros() -> list[Plantilla]:
    return [_del_fichero(f.stem) for f in sorted(CARPETA.glob("*.md"))]
