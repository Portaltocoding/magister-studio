"""Perfiles de explicación por tipo de materia: un mini motor para ayudar a entender cada materia a su manera.

Pocos perfiles (no uno por asignatura), cada uno un fichero en `prompts/comun/materias/`. El perfil de un tema se
elige una vez: primero por reglas (palabras del nombre del tema y de sus lecciones o conceptos, sin gastar nada) y, solo
si no queda claro, con una llamada pequeña a `estructurar` en la tarea «extraer». Aquí no se toca la base: quien guarda
el perfil es `datos.materias`.
"""

import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, Field

from magister.cerebro import prompts
from magister.cerebro.estructura import ErrorEstructura, estructurar

PERFILES = ("general", "derecho", "filosofia", "exactas", "experimentales", "historia", "programacion")
Perfil = Literal["general", "derecho", "filosofia", "exactas", "experimentales", "historia", "programacion"]

# Para el cuestionario y la API: qué es cada perfil, en una línea.
DESCRIPCIONES = {
    "general": "Cualquier otra materia: lo común (ejemplo conductor, certeza graduada, error típico).",
    "derecho": "Derecho: citas de norma y artículo, ley frente a jurisprudencia y doctrina, caso práctico en cinco pasos.",
    "filosofia": "Filosofía: argumentos en premisas y conclusión, cada postura a su autor, exégesis frente a evaluación, objeciones y réplicas.",
    "exactas": "Matemáticas, estadística, topografía: fórmulas, convenios, cuentas comprobadas y figuras.",
    "experimentales": "Física, química, biología, medicina: mecanismos causales, magnitudes y unidades.",
    "historia": "Historia y materias de hechos e interpretación: cronología, causas múltiples, fuentes frente a historiografía.",
    "programacion": "Programación e ingeniería: código mínimo, cómo funciona por dentro, errores reales.",
}

# Palabras (sin tildes, en minúsculas). Las que empiezan por «=» son la palabra entera; las demás, un comienzo de palabra.
PALABRAS: dict[str, tuple[str, ...]] = {
    "derecho": (
        "derech", "juridic", "jurisprudenc", "civil", "penal", "mercantil", "constituciona", "procesal", "tributari",
        "laboral", "administrativ", "notari", "registral", "contrato", "obligaciones", "sucesion", "usucapion",
        "prescripcion", "oposicion", "ley ", "leyes", "codigo civil", "abogac", "fiscal",
    ),
    "filosofia": (
        "filosof", "metafisic", "epistemolog", "ontolog", "etica", "estetica", "hermeneutic", "fenomenolog", "existencialis",
        "kant", "descartes", "platon", "aristotel", "hume", "nietzsche", "hegel", "spinoza", "leibniz", "sartre",
        "heidegger", "wittgenstein", "racionalismo", "empirismo", "idealismo", "escolastic", "estoic", "presocratic",
    ),
    "exactas": (
        "matematic", "calculo", "algebra", "geometr", "trigonometr", "estadistic", "probabilidad", "ecuacion",
        "derivada", "integral", "topograf", "geodesi", "cartograf", "numeric", "optimizacion", "matric", "vectorial",
        "fourier", "topologia", "combinatori", "inferencia", "regresion", "planimetr", "altimetr", "teodolito",
    ),
    "experimentales": (
        "fisic", "quimic", "biolog", "fisiolog", "anatom", "medicin", "genetic", "bioquimic", "ecolog", "geolog",
        "astronom", "neurociencia", "farmacolog", "microbiolog", "termodinamic", "mecanica", "electromagnet", "optica",
        "inmunolog", "botanica", "zoolog", "climatolog", "meteorolog", "celula", "biotecnolog", "patolog", "enfermeri",
    ),
    "historia": (
        "histori", "edad media", "edad moderna", "edad antigua", "contemporanea", "revolucion", "prehistoria", "imperio",
        "monarquia", "republica", "dictadura", "medieval", "renacimiento", "ilustracion", "guerra civil", "geografia",
        "arqueolog", "politica", "sociolog", "antropolog", "historiograf",
    ),
    "programacion": (
        "program", "python", "javascript", "typescript", "algoritm", "software", "backend", "frontend", "docker",
        "kubernetes", "postgres", "mongodb", "base de datos", "bases de datos", "estructuras de datos", "sistemas operativos",
        "machine learning", "aprendizaje automatico", "ciberseguridad", "compilador", "desarrollo web", "informatic",
        "=sql", "=api", "=git", "=web", "=css", "=html", "=java", "=rust", "=react", "=linux", "=http", "=c++", "=redes",
        "=devops", "=nosql", "=ia", "=backend", "=cloud", "=nube",
    ),
}

PESO_NOMBRE = 3
PESO_PISTA = 1
UMBRAL = 3  # el perfil ganador necesita al menos esto...
VENTAJA = 2  # ...y doblar al segundo


def _limpiar(texto: str) -> str:
    sin = unicodedata.normalize("NFKD", texto.lower())
    return " " + re.sub(r"\s+", " ", "".join(c for c in sin if not unicodedata.combining(c))) + " "


def _aciertos(texto: str, palabras: tuple[str, ...]) -> int:
    n = 0
    for p in palabras:
        if p.startswith("="):
            hay = re.search(rf"(?<![a-z0-9]){re.escape(p[1:])}(?![a-z0-9])", texto)
        else:
            hay = re.search(rf"(?<![a-z0-9]){re.escape(p)}", texto)
        n += bool(hay)
    return n


def puntuar(nombre: str, pistas: list[str] | None = None) -> dict[str, int]:
    """Puntos de cada perfil: cada palabra distinta que sale en el nombre del tema cuenta más que en una lección."""
    de_nombre, de_pistas = _limpiar(nombre), _limpiar(" . ".join(pistas or []))
    return {perfil: PESO_NOMBRE * _aciertos(de_nombre, pal) + PESO_PISTA * min(_aciertos(de_pistas, pal), 6)
            for perfil, pal in PALABRAS.items()}


def por_reglas(nombre: str, pistas: list[str] | None = None) -> str | None:
    """El perfil si las reglas lo ven claro; None si hay empate, poco indicio o ninguno."""
    puntos = sorted(puntuar(nombre, pistas).items(), key=lambda kv: kv[1], reverse=True)
    (mejor, a), (_, b) = puntos[0], puntos[1]
    if a >= UMBRAL and a >= VENTAJA * b:
        return mejor
    return None


class Eleccion(BaseModel):
    motivo: str = Field(description="Una frase: por qué ese perfil")
    perfil: Perfil


async def por_modelo(nombre: str, pistas: list[str] | None = None) -> str | None:
    """Una llamada pequeña (tarea «extraer»). None si el modelo no da una salida válida."""
    sistema = prompts.cargar("materia_elegir").rellenar(
        perfiles="\n".join(f"- `{k}`: {v}" for k, v in DESCRIPCIONES.items()), nombre=nombre,
        pistas="\n".join(f"- {p}" for p in (pistas or [])[:30]) or "(ninguna)")
    try:
        return (await estructurar(sistema, "Elige el perfil.", Eleccion)).perfil
    except ErrorEstructura:
        return None


async def elegir(nombre: str, pistas: list[str] | None = None) -> str | None:
    """Reglas primero; el modelo solo si no queda claro. None: no se pudo decidir (quien llama usa `general` sin guardarlo)."""
    return por_reglas(nombre, pistas) or await por_modelo(nombre, pistas)


def texto(perfil: str | None) -> str:
    """Lo que se añade a la petición: el perfil con su encabezado. Sin perfil o con uno desconocido, nada."""
    if not perfil or perfil not in PERFILES:
        return ""
    return ("Cómo se explica esta materia (el alumno estudia este tema; estas reglas completan lo común y, donde se "
            "contradigan, mandan; lo que se vaya a oír en voz alta se dice con palabras, sin fórmulas ni código escritos):\n"
            + prompts.materia(perfil).texto)


def version(perfil: str | None) -> str | None:
    return prompts.materia(perfil).etiqueta if perfil in PERFILES else None
