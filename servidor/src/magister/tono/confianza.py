"""Cuánto se fía Magister de lo que genera para ti, y cuánto tiene que juzgar.

Cada dimensión del juez de tono (razonamiento, economía, trato) lleva una cuenta de aciertos y fallos: lo que dice el
juez y, con más peso, lo que dices tú al valorar. Lo antiguo se va olvidando. De ahí sale la confianza (la cota baja
de una Beta, prudente con pocos datos) y la política: al principio se juzga todo; si todo va bien, cada vez menos; una
queja tuya en una dimensión la hace volver a juzgarse.

Lo que repites al valorar («muy largo», «le falta un ejemplo») se vuelve una regla que entra en la generación: el texto
sale ya a tu medida y el juez tiene menos que corregir. Todo puro: sin base, sin modelo, sin reloj.
"""

import hashlib
import math

DIMENSIONES = ("razonamiento", "economia", "trato")
PESO_JUEZ = 1.0
PESO_USUARIO = 3.0
OLVIDO = 0.97  # cada evidencia nueva de una dimensión deja la anterior en el 97 %
MUESTRA_MINIMA = 0.1  # nunca se deja de juzgar del todo: una de cada diez
UMBRAL_REGLA = 2.0  # un motivo se vuelve regla cuando su cuenta (con olvido) llega a 2

# Los motivos que se pueden marcar al decir «no me sirve»: a qué dimensión apuntan y qué regla aprenden.
MOTIVOS: dict[str, tuple[str, str, str | None]] = {
    "largo": ("Muy largo", "economia", "Le resultan largas: ve al grano y recorta lo accesorio."),
    "corto": ("Se queda corto", "razonamiento", "Le saben a poco: desarrolla más, con un ejemplo completo."),
    "basico": ("Muy básico", "razonamiento", "Le parecen básicas: no expliques lo que ya sabe y sube el nivel."),
    "tecnico": ("Mucha jerga", "trato", "Le cuesta la jerga: di cada término con palabras llanas antes de usarlo."),
    "sin_ejemplo": ("Le falta un ejemplo", "razonamiento", "Echa en falta ejemplos: apoya cada idea en uno concreto."),
    "confuso": ("Me he perdido", "razonamiento", "Se pierde: un paso cada vez, y di para qué sirve antes de darlo."),
    "error": ("Hay un error", "razonamiento", None),
    "tono": ("El tono", "trato", "Cuida el tono: directo, sin condescendencia ni relleno."),
}


def nuevo() -> dict:
    return {"dims": {d: {"a": 0.0, "b": 0.0} for d in DIMENSIONES}, "motivos": {}, "descartadas": [], "juzgadas": 0, "saltadas": 0}


def _completo(estado: dict | None) -> dict:
    base = nuevo()
    e = {**base, **(estado or {})}
    e["dims"] = {d: {**base["dims"][d], **(e["dims"].get(d) or {})} for d in DIMENSIONES}
    return e


def registrar(estado: dict | None, dimension: str, bien: bool, peso: float) -> dict:
    e = _completo(estado)
    c = e["dims"][dimension]
    a, b = c["a"] * OLVIDO, c["b"] * OLVIDO
    e["dims"][dimension] = {"a": a + (peso if bien else 0.0), "b": b + (0.0 if bien else peso)}
    return e


def registrar_juez(estado: dict | None, aprobadas: dict[str, bool]) -> dict:
    e = _completo(estado)
    for d, bien in aprobadas.items():
        if d in DIMENSIONES:
            e = registrar(e, d, bien, PESO_JUEZ)
    e["juzgadas"] = e.get("juzgadas", 0) + 1
    return e


def registrar_usuario(estado: dict | None, bien: bool, motivos: list[str] | None = None) -> dict:
    """«Me sirve» suma a todas; «no me sirve» resta a las dimensiones de sus motivos (o a todas, si no dice por qué)."""
    e = _completo(estado)
    motivos = [m for m in (motivos or []) if m in MOTIVOS]
    if bien:
        for d in DIMENSIONES:
            e = registrar(e, d, True, PESO_USUARIO / 3)
        return e
    for d in {MOTIVOS[m][1] for m in motivos} or set(DIMENSIONES):
        e = registrar(e, d, False, PESO_USUARIO)
    cuentas = {k: v * OLVIDO for k, v in e["motivos"].items()}
    for m in motivos:
        cuentas[m] = cuentas.get(m, 0.0) + 1.0
    e["motivos"] = cuentas
    return e


def confianza(estado: dict | None, dimension: str) -> float:
    """Cota baja (media menos una desviación) de una Beta(1 + aciertos, 1 + fallos): sin datos, 0,21."""
    c = _completo(estado)["dims"][dimension]
    a, b = 1 + c["a"], 1 + c["b"]
    media = a / (a + b)
    desviacion = math.sqrt(a * b / ((a + b) ** 2 * (a + b + 1)))
    return max(0.0, media - desviacion)


def muestra(estado: dict | None) -> float:
    """Qué fracción de lo generado se juzga: la dimensión de la que menos se fía manda."""
    peor = min(confianza(estado, d) for d in DIMENSIONES)
    return max(MUESTRA_MINIMA, min(1.0, 1.0 - peor))


def toca_juzgar(estado: dict | None, clave: str) -> bool:
    """Decisión determinista por clave (una traza, un bloque): repetir el mismo trabajo decide lo mismo."""
    azar = int(hashlib.sha256(clave.encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF
    return azar < muestra(estado)


def reglas(estado: dict | None) -> list[str]:
    """Las reglas aprendidas de lo que repites al valorar, salvo las que quitaste."""
    e = _completo(estado)
    salida = []
    for m, cuenta in sorted(e["motivos"].items(), key=lambda x: -x[1]):
        regla = MOTIVOS.get(m, (None, None, None))[2]
        if regla and cuenta >= UMBRAL_REGLA and m not in e["descartadas"]:
            salida.append(regla)
    return salida
