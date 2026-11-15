"""Lo que contestas antes de generar el material, convertido en instrucciones para los prompts."""

PROFUNDIDAD = {
    "intro": "Introducción: lo esencial, con intuición y un ejemplo; sin entrar en casos raros. Bloques cortos.",
    "estandar": "Nivel estándar de ficha general: intuición, lo formal y una cuenta o ejemplo trabajado.",
    "fondo": "A fondo: intuición, lo formal con detalle, casos límite, errores típicos y un ejemplo completo.",
}
PREGUNTAS = {
    "conceptuales": "Sobre todo preguntas conceptuales y de explicar por qué.",
    "practicas": "Sobre todo preguntas prácticas: cálculo, escenarios y encontrar el fallo.",
    "mezcla": "Una mezcla equilibrada de conceptuales, prácticas y de encontrar el fallo.",
}
CANTIDAD = {"pocas": (4, 6), "normal": (6, 10), "muchas": (10, 12)}


def texto(preferencias: dict | None) -> str:
    p = preferencias or {}
    lineas = [PROFUNDIDAD.get(p.get("profundidad", "estandar"), PROFUNDIDAD["estandar"])]
    if p.get("enfoque"):
        lineas.append(f"Enfoque que pide el alumno: {p['enfoque']}")
    return "\n".join(f"- {x}" for x in lineas)


def texto_preguntas(preferencias: dict | None) -> str:
    p = preferencias or {}
    minimo, maximo = CANTIDAD.get(p.get("cantidad", "normal"), CANTIDAD["normal"])
    lineas = [f"Entre {minimo} y {maximo} preguntas.", PREGUNTAS.get(p.get("preguntas", "mezcla"), PREGUNTAS["mezcla"])]
    if p.get("enfoque"):
        lineas.append(f"Enfoque que pide el alumno: {p['enfoque']}")
    return "\n".join(f"- {x}" for x in lineas)


def rango(preferencias: dict | None) -> tuple[int, int]:
    return CANTIDAD.get((preferencias or {}).get("cantidad", "normal"), CANTIDAD["normal"])
