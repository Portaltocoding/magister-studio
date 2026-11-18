"""Plantillas de prompt: cada una es un fichero `cerebro/prompts/<nombre>.md`.

La versión es el hash del fichero: cambias una coma y cambia la versión, así que
ninguna medida mezcla dos prompts sin saberlo. Los huecos van como `{nombre}` y
`rellenar` falla si falta alguno.

Una línea `@incluir <nombre>` mete ahí el texto de `prompts/comun/<nombre>.md` (el núcleo de cómo
explica Magister, por ejemplo). La versión se calcula sobre el texto ya expandido: si cambia lo
común, cambia la versión de cada plantilla que lo incluye.
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


COMUN = CARPETA / "comun"
INCLUIR = re.compile(r"^@incluir ([a-z_]+)[ \t\r]*$", re.M)


def _expandir(texto: str, profundidad: int = 0) -> str:
    """Los trozos comunes pueden incluir otros (respuesta incluye explicar); un ciclo se corta con un error."""
    if profundidad > 5:
        raise ErrorPlantilla("los trozos comunes se incluyen en círculo")

    def trozo(m: re.Match[str]) -> str:
        ruta = COMUN / f"{m.group(1)}.md"
        if not ruta.is_file():
            raise ErrorPlantilla(f"no existe el trozo común {m.group(1)}")
        return _expandir(ruta.read_text(encoding="utf-8").strip(), profundidad + 1)

    return INCLUIR.sub(trozo, texto)


@cache
def _del_fichero(nombre: str) -> Plantilla:
    if not re.fullmatch(r"[a-z_]+", nombre):
        raise ErrorPlantilla(f"nombre de plantilla no válido: {nombre}")
    ruta = CARPETA / f"{nombre}.md"
    # Sin finales de línea de Windows: con CRLF el @incluir no se reconocería y la versión cambiaría según el checkout.
    texto = _expandir(ruta.read_bytes().decode("utf-8").replace("\r\n", "\n"))
    return Plantilla(nombre, hashlib.sha256(texto.encode("utf-8")).hexdigest()[:12], texto.strip())


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
