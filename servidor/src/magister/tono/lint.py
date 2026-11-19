"""El lint de tono: lo que se comprueba contando, sin modelo.

Las reglas se leen de `docs/tono.md` y del glosario (`docs/glosario.md`). Busca sobre el
texto normalizado (minúsculas, sin tildes) pero devuelve el fragmento del texto original.
No marca nada entre comillas ni dentro de bloques de código.
"""

import re
import unicodedata
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from magister.tono.hallazgo import Hallazgo

DOCS = Path(__file__).resolve().parents[4] / "docs"
MAX_PALABRAS_FRASE = 40
MAX_PALABRAS_PARENTESIS = 6


@dataclass(frozen=True)
class Regla:
    id: str
    descripcion: str
    gravedad: str
    tipos: tuple[str, ...]
    patron: str | None  # None: la implementa el código


def normalizar(texto: str) -> str:
    """Minúsculas y sin tildes, conservando la longitud (posición a posición)."""
    salida = []
    for c in texto:
        base = unicodedata.normalize("NFD", c)[0] if c not in "ñÑ" else c
        salida.append(base.lower() if len(base.lower()) == 1 else c)
    return "".join(salida)


@cache
def reglas(ruta: str | None = None) -> tuple[Regla, ...]:
    texto = Path(ruta or DOCS / "tono.md").read_text(encoding="utf-8")
    salida = []
    for linea in texto.splitlines():
        if not linea.startswith("| ") or linea.startswith(("| id", "|---")):
            continue
        celdas = [c.strip() for c in re.split(r"(?<!\\)\|", linea.strip().strip("|"))]
        if len(celdas) < 6:
            continue
        rid, desc, _, gravedad, tipos, patron = celdas[:6]
        patron = patron.strip("`").replace("\\|", "|")
        salida.append(Regla(rid, desc, gravedad, tuple(t.strip() for t in tipos.split(",")), None if patron == "(código)" else patron))
    return tuple(salida)


@cache
def glosario(ruta: str | None = None) -> dict[str, str]:
    p = Path(ruta or DOCS / "glosario.md")
    if not p.exists():
        return {}
    salida = {}
    for linea in p.read_text(encoding="utf-8").splitlines():
        if "|" in linea and not linea.startswith("#"):
            termino, traduccion = (x.strip() for x in linea.split("|", 1))
            if termino:
                salida[termino.lower()] = traduccion
    return salida


def _zonas_excluidas(texto: str) -> list[tuple[int, int]]:
    zonas = [(m.start(), m.end()) for m in re.finditer(r"```.*?```|`[^`\n]+`", texto, re.S)]
    zonas += [(m.start(), m.end()) for m in re.finditer(r"«[^»]*»|\"[^\"\n]*\"|“[^”]*”", texto)]
    return zonas


def _excluida(pos: int, zonas: list[tuple[int, int]]) -> bool:
    return any(a <= pos < b for a, b in zonas)


def _aplica(regla: Regla, tipo: str) -> bool:
    return "todos" in regla.tipos or tipo in regla.tipos


def _frases(texto: str):
    for m in re.finditer(r"[^.!?\n]+[.!?]?", texto):
        yield m.start(), m.group(0)


def revisar(texto: str, tipo: str = "apuntes", bloque: str = "") -> list[Hallazgo]:
    norm = normalizar(texto)
    zonas = _zonas_excluidas(texto)
    hallazgos: list[Hallazgo] = []

    def anotar(regla: Regla, ini: int, fin: int, por_que: str = "") -> None:
        if _excluida(ini, zonas):
            return
        hallazgos.append(
            Hallazgo(bloque=bloque, cita=texto[ini:fin] or texto[ini : ini + 1], regla=regla.id, por_que=por_que or regla.descripcion,
                     gravedad=regla.gravedad, origen="lint", posicion=ini)  # type: ignore[arg-type]
        )

    for regla in reglas():
        if not _aplica(regla, tipo):
            continue
        if regla.patron:
            for m in re.finditer(regla.patron, norm):
                anotar(regla, m.start(), m.end())
            continue
        if regla.id == "unicode":
            for i, c in enumerate(texto):
                # Solo emojis y pictogramas: °, © o ™ son símbolos legítimos (unidades, marcas).
                if ord(c) > 0xFFFF or 0x2600 <= ord(c) <= 0x27BF:
                    anotar(regla, i, i + 1, f"carácter {c!r} fuera del Unicode básico")
        elif regla.id == "frase_larga":
            for ini, frase in _frases(texto):
                n = len(frase.split())
                if n > MAX_PALABRAS_FRASE and not frase.lstrip().startswith(("|", "-", "*")):
                    anotar(regla, ini, ini + len(frase), f"{n} palabras (máximo {MAX_PALABRAS_FRASE})")
        elif regla.id == "vinetas":
            lineas = [x for x in texto.splitlines() if x.strip()]
            vinetas = [x for x in lineas if re.match(r"\s*([-*+]|\d+\.)\s", x)]
            if len(lineas) >= 4 and len(vinetas) / len(lineas) > 0.5:
                primera = texto.find(vinetas[0])
                anotar(regla, primera, primera + len(vinetas[0]), f"{len(vinetas)} de {len(lineas)} líneas son viñetas")
        elif regla.id == "ingles":
            for termino, traduccion in glosario().items():
                m = re.search(rf"\b{re.escape(termino)}\b", norm)
                if not m:
                    continue
                cerca = norm[m.end() : m.end() + 60]
                antes = norm[max(0, m.start() - 60) : m.start()]
                if normalizar(traduccion) not in cerca and normalizar(traduccion) not in antes:
                    anotar(regla, m.start(), m.end(), f"«{termino}» sin traducción («{traduccion}») la primera vez")
        elif regla.id == "parentesis_largo":
            for m in re.finditer(r"\(([^)]*)\)", texto):
                if len(m.group(1).split()) > MAX_PALABRAS_PARENTESIS:
                    anotar(regla, m.start(), m.end())
        elif regla.id == "sigla_sin_decir":
            vistas: set[str] = set()
            for m in re.finditer(r"\b[A-ZÁÉÍÓÚÑ]{2,6}\b", texto):
                sigla = m.group(0)
                if sigla in vistas:
                    continue
                vistas.add(sigla)
                cerca = texto[m.end() : m.end() + 4]
                if "(" not in cerca and "," not in cerca:
                    anotar(regla, m.start(), m.end(), f"«{sigla}» sin decir qué significa")
    return sorted(hallazgos, key=lambda h: h.posicion or 0)


def vetos(hallazgos: list[Hallazgo]) -> list[Hallazgo]:
    return [h for h in hallazgos if h.gravedad == "veto"]
