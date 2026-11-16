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


NIVEL = {
    "nada": "El alumno empieza de cero: no des nada por sabido. Cada término técnico se presenta con una frase llana y un "
            "ejemplo cotidiano antes de usarlo, incluidos los básicos (qué es un servidor, una petición, una tabla). Si un "
            "concepto necesita otro previo que no está en lecciones anteriores, explícalo en dos o tres frases donde haga falta.",
    "basico": "El alumno sabe lo básico: define cada término técnico la primera vez que sale y recuerda en una frase los "
              "previos que no estén en lecciones anteriores.",
    "avanzado": "El alumno tiene nivel avanzado: no expliques lo básico; ve a los matices, casos límite y decisiones.",
}


def texto(preferencias: dict | None) -> str:
    p = preferencias or {}
    lineas = [PROFUNDIDAD.get(p.get("profundidad", "estandar"), PROFUNDIDAD["estandar"])]
    if p.get("nivel") in NIVEL:
        lineas.append(NIVEL[p["nivel"]])
    if p.get("enfoque"):
        lineas.append(f"Enfoque que pide el alumno: {p['enfoque']}")
    return "\n".join(f"- {x}" for x in lineas)


def texto_preguntas(preferencias: dict | None) -> str:
    p = preferencias or {}
    minimo, maximo = CANTIDAD.get(p.get("cantidad", "normal"), CANTIDAD["normal"])
    lineas = [f"Entre {minimo} y {maximo} preguntas.", PREGUNTAS.get(p.get("preguntas", "mezcla"), PREGUNTAS["mezcla"])]
    if p.get("nivel") == "nada":
        lineas.append("Empieza de cero: preguntas sobre las ideas básicas, sin términos que los apuntes no hayan explicado.")
    if p.get("enfoque"):
        lineas.append(f"Enfoque que pide el alumno: {p['enfoque']}")
    return "\n".join(f"- {x}" for x in lineas)


def rango(preferencias: dict | None) -> tuple[int, int]:
    return CANTIDAD.get((preferencias or {}).get("cantidad", "normal"), CANTIDAD["normal"])
