"""Qué lecciones se investigan solas: las que empiezan pronto, aún no tienen fuentes y de verdad las necesitan
(encargo 8, decisión (e); ADR-0021, nota del 19-11-2026).

Código puro: el momento (`hoy`) entra como argumento.
"""

from datetime import date, timedelta

from magister.plan.apoyo import necesidad_efectiva
from magister.plan.esquemas import NECESIDADES

# Cómo empieza el `motivo_fin` de una búsqueda que no llegó a buscar (sin red, la búsqueda web bloqueada, el freno):
# no es un resultado, así que la tarea queda «cortada» y se puede repetir.
FALLOS = ("error:", "no se pudieron", "se pasó de")


def es_fallo(motivo: str | None) -> bool:
    return bool(motivo) and motivo.startswith(FALLOS)


DIAS =("el lunes", "el martes", "el miércoles", "el jueves", "el viernes", "el sábado", "el domingo")


def cuando_empiezas(fecha: date, hoy: date) -> str:
    """«hoy», «mañana» o «el jueves» (en la semana que viene, el día y la fecha)."""
    dias = (fecha - hoy).days
    if dias <= 0:
        return "hoy"
    if dias == 1:
        return "mañana"
    return DIAS[fecha.weekday()] if dias < 7 else f"{DIAS[fecha.weekday()]} {fecha.day}"


def sin_juzgar(lec: dict) -> bool:
    """La lección aún no tiene `necesita_fuentes` (un plan de antes de decidirlo por lección, o un valor raro)."""
    return lec.get("necesita_fuentes") not in NECESIDADES


def falta_informacion(lec: dict) -> bool:
    """Falta información de verdad: lo que ya hay para la lección deja objetivos sin ninguna fuente, y se sabe cuáles
    (`sin_fuente`, la misma cuenta que «cubre 3 de 4 objetivos» del Roadmap). None es «no se sabe»: no es que falte."""
    return bool(lec.get("sin_fuente"))


def motivo_automatico(lec: dict, material_propio: bool = False) -> str:
    """Por qué el research automático investiga, o no, una lección (ADR-0021, nota del 19-11-2026). Una de:
    - `no`: sin_material es falso (tu material la cubre) o la etiqueta efectiva es «no»;
    - `sin_juzgar`: aún sin etiqueta: primero la pone el modelo barato (`cuando_research`), no se busca por si acaso;
    - `imprescindible`: se busca sola;
    - `falta`: «conviene», pero se sabe que faltan fuentes para algunos objetivos: se buscan solas, solo esos;
    - `sugerencia`: «conviene» sin más: no se busca sola, la lanzas tú."""
    if not lec.get("sin_material"):
        return "no"
    if sin_juzgar(lec):
        return "sin_juzgar"
    efectiva = necesidad_efectiva(lec.get("necesita_fuentes"), None, material_propio)[0]
    if efectiva == "imprescindible":
        return "imprescindible"
    if efectiva == "conviene":
        return "falta" if falta_informacion(lec) else "sugerencia"
    return "no"


# Lo que se dice en el Roadmap de cada motivo, con el research automático encendido.
TEXTO_AUTOMATICO = {
    "sin_juzgar": "Se decide solo, con un modelo barato, cuando se acerque su sesión.",
    "imprescindible": "Hacen falta: se buscan solas cuando se acerque su sesión.",
    "falta": "Faltan fuentes para algunos objetivos: se buscan solas cuando se acerque su sesión.",
    "sugerencia": "Te vendría bien: búscalas cuando quieras.",
}


def texto_automatico(lec: dict, material_propio: bool = False, automatico: bool = True) -> str:
    """La frase del Roadmap: por qué esta lección se investiga sola o no. Sin el automático, nada se busca solo."""
    motivo = motivo_automatico(lec, material_propio)
    if not lec.get("sin_material"):
        # Una sola frase que no choca con el chip de la etiqueta: diga «conviene» o «imprescindible», con material
        # bastante no se busca sola, y a mano se puede. (Cuántos fragmentos cuentan como material: los distintos, ver
        # `fuentes.duplicados.colapsar`.)
        return "Tu material ya la cubre: no se busca sola. Si quieres más, «Buscar fuentes»."
    if motivo == "no":
        return "No hace falta: se explica bien sin fuentes."
    if not automatico:
        return "Búscalas cuando quieras: el research automático está apagado."
    return TEXTO_AUTOMATICO[motivo]


def _toca(lec: dict, tareas: dict[str, tuple], hoy: date, limite: date, vieja_dias: int) -> bool:
    """Sin material, con su primera sesión pendiente antes del límite (o ya pasada) y sin una búsqueda reciente."""
    fecha = lec.get("primera_sesion")
    if not lec.get("sin_material") or fecha is None or fecha > limite:
        return False
    tarea = tareas.get(lec["clave"])
    if tarea is not None:
        estado, creada, *resto = tarea
        motivo = resto[0] if resto else None
        vieja = estado == "acabada" and (hoy - creada).days > vieja_dias
        fallo_de_hoy = estado == "cortada" and es_fallo(motivo) and creada >= hoy
        if (estado != "cortada" or fallo_de_hoy) and not vieja:
            return False
    return True


def lecciones_a_investigar(
    lecciones: list[dict],
    tareas: dict[str, tuple],
    hoy: date,
    horizonte_dias: int = 7,
    max_por_vuelta: int = 2,
    vieja_dias: int = 14,
    material_propio: bool = False,
) -> list[str]:
    """Las claves que toca investigar ahora, por orden de sesión y como mucho `max_por_vuelta`.

    Cada lección es {clave, primera_sesion: date | None, sin_material: bool, necesita_fuentes?: str,
    sin_fuente?: list[int] | None}; `tareas` da, por clave, (estado, día en que se creó[, motivo_fin]) de su última
    búsqueda. Entra una lección solo si hace falta (`motivo_automatico`): «imprescindible», o «conviene» con objetivos
    que se sabe que no tienen fuente (`falta_informacion`). «Conviene» sin más es una sugerencia que lanzas tú, y una
    lección sin etiqueta no entra: primero la etiqueta el modelo barato (`lecciones_a_juzgar`).
    Además: está sin material, su primera sesión pendiente cae antes de hoy + horizonte (también si ya pasó: la llevas
    atrasada) y su última búsqueda no existe, se cortó, o acabó hace más de `vieja_dias` días
    (MAGISTER_RESEARCH_VIEJA_DIAS). Una cortada por un fallo (sin red, el freno, el plazo) se repite, pero no el mismo
    día en que falló: así no se gasta una consulta cada vuelta."""
    limite = hoy + timedelta(days=horizonte_dias)
    candidatas = []
    for orden, lec in enumerate(lecciones):
        if motivo_automatico(lec, material_propio) not in ("imprescindible", "falta"):
            continue
        if not _toca(lec, tareas, hoy, limite, vieja_dias):
            continue
        candidatas.append((lec["primera_sesion"], orden, lec["clave"]))
    return [clave for *_, clave in sorted(candidatas)[:max_por_vuelta]]


def lecciones_a_juzgar(
    lecciones: list[dict],
    tareas: dict[str, tuple],
    hoy: date,
    horizonte_dias: int = 7,
    maximo: int = 10,
    vieja_dias: int = 14,
) -> list[str]:
    """Las lecciones sin etiqueta que el automático investigaría si la tuvieran: antes de buscar, el modelo barato
    decide si hace falta (`research/necesidad.py`). Por orden de sesión y como mucho `maximo` (una llamada)."""
    limite = hoy + timedelta(days=horizonte_dias)
    candidatas = [(lec["primera_sesion"], orden, lec["clave"]) for orden, lec in enumerate(lecciones)
                  if sin_juzgar(lec) and _toca(lec, tareas, hoy, limite, vieja_dias)]
    return [clave for *_, clave in sorted(candidatas)[:maximo]]


def objetivos_a_buscar(lec: dict, material_propio: bool = False) -> list[int] | None:
    """Qué objetivos busca el automático: todos (None) en una «imprescindible»; en una «conviene» con falta de
    información, solo los que no tienen fuente."""
    if motivo_automatico(lec, material_propio) == "falta":
        return sorted(set(lec["sin_fuente"]))
    return None
