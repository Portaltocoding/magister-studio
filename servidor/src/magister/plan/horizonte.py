"""Qué lecciones se investigan solas: las que empiezan pronto y aún no tienen fuentes (encargo 8, decisión (e)).

Código puro: el momento (`hoy`) entra como argumento.
"""

from datetime import date, timedelta

from magister.plan.apoyo import necesidad_efectiva

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

    Cada lección es {clave, primera_sesion: date | None, sin_material: bool, necesita_fuentes?: str}; `tareas` da, por
    clave, (estado, día en que se creó[, motivo_fin]) de su última búsqueda. Entra una lección si está sin material, su
    primera sesión pendiente cae antes de hoy + horizonte (también si ya pasó: la llevas atrasada y sigue por estudiar),
    no está marcada «no» (con `material_propio`, tu material manda y nunca es «no») y su última búsqueda no existe, se
    cortó, o acabó hace más de `vieja_dias` días (MAGISTER_RESEARCH_VIEJA_DIAS). Una cortada por un fallo (sin red, el
    freno, el plazo) se repite, pero no el mismo día en que falló: así no se gasta una consulta cada vuelta."""
    limite = hoy + timedelta(days=horizonte_dias)
    candidatas = []
    for orden, lec in enumerate(lecciones):
        fecha = lec.get("primera_sesion")
        if not lec.get("sin_material") or fecha is None or fecha > limite:
            continue
        if necesidad_efectiva(lec.get("necesita_fuentes"), None, material_propio)[0] == "no":
            continue
        tarea = tareas.get(lec["clave"])
        if tarea is not None:
            estado, creada, *resto = tarea
            motivo = resto[0] if resto else None
            vieja = estado == "acabada" and (hoy - creada).days > vieja_dias
            fallo_de_hoy = estado == "cortada" and es_fallo(motivo) and creada >= hoy
            if (estado != "cortada" or fallo_de_hoy) and not vieja:
                continue
        candidatas.append((fecha, orden, lec["clave"]))
    return [clave for *_, clave in sorted(candidatas)[:max_por_vuelta]]
