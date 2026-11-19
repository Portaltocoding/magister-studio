"""Qué lecciones de un plan siguen en el que lo sustituye: código puro, sin modelo ni base de datos.

Un plan nuevo del mismo tema sustituye al aceptado. Lo anclado a una lección (sus fuentes, su apoyo, lo que ya has
estudiado) pasa al plan nuevo solo si la lección sigue: mismo título normalizado (sin mayúsculas, tildes ni signos), y
solo si es el único con ese título en cada lado. Las claves no cuentan: si entra una lección delante, L3 pasa a ser L4
y sigue siendo la misma. Lo que no se empareja así no se arrastra: mejor perder una fuente que pegarla a otra lección.
Es el mismo primer criterio que usa el roadmap de los proyectos al replantearlo (proyectos/roadmap.py, _emparejar_lista).
"""

import re
import unicodedata


def titulo_normal(t: str) -> str:
    plano = "".join(c for c in unicodedata.normalize("NFD", t.lower()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9ñ]+", " ", plano).strip()


def emparejar_lecciones(viejas: list[tuple[str, str]], nuevas: list[tuple[str, str]]) -> dict[str, str]:
    """[(clave, título)] de cada plan -> {clave vieja: clave nueva}, uno a uno."""
    def por_titulo(lista: list[tuple[str, str]]) -> dict[str, list[str]]:
        grupos: dict[str, list[str]] = {}
        for clave, titulo in lista:
            grupos.setdefault(titulo_normal(titulo), []).append(clave)
        return grupos

    nuevos = por_titulo(nuevas)
    return {claves[0]: nuevos[t][0] for t, claves in por_titulo(viejas).items()
            if t and len(claves) == 1 and len(nuevos.get(t, [])) == 1}
