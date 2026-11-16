"""Los exámenes del plan: hitos que salen del calendario, no sesiones guardadas.

Un parcial cada pocas lecciones (o al cerrar la semana de estudio, lo que llegue antes) y un final
de todo el plan al día siguiente de la última sesión. Como se calculan, se mueven solos si el plan se recalcula.
"""

from datetime import date, timedelta

CADA = 3  # lecciones por parcial como mucho
PREGUNTAS_POR_LECCION = 4
MINUTOS_POR_PREGUNTA = 2


def _semana(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return iso[0], iso[1]


def _hito(id_: str, titulo: str, fecha: date, lecciones: list[str], final: bool = False) -> dict:
    preguntas = 20 if final else min(15, PREGUNTAS_POR_LECCION * len(lecciones))
    return {"id": id_, "titulo": titulo, "fecha": fecha.isoformat(), "lecciones": lecciones, "final": final,
            "preguntas": preguntas, "minutos": preguntas * MINUTOS_POR_PREGUNTA}


def _rango(claves: list[str]) -> str:
    return claves[0] if len(claves) == 1 else f"{claves[0]} a {claves[-1]}"


def hitos(orden: list[str], ultima_sesion: dict[str, date], cada: int = CADA) -> list[dict]:
    """`orden`: las lecciones del plan en orden; `ultima_sesion`: el día en que acaba cada una."""
    con_fecha = [c for c in orden if c in ultima_sesion]
    if not con_fecha:
        return []
    bloques: list[list[str]] = []
    actual: list[str] = []
    for i, c in enumerate(con_fecha):
        actual.append(c)
        siguiente = con_fecha[i + 1] if i + 1 < len(con_fecha) else None
        cambia_semana = siguiente is not None and _semana(ultima_sesion[siguiente]) != _semana(ultima_sesion[c])
        if len(actual) == cada or cambia_semana or siguiente is None:
            bloques.append(actual)
            actual = []
    # Un último bloque de una sola lección no merece parcial: entra en el final.
    if len(bloques) > 1 and len(bloques[-1]) < 2:
        bloques.pop()
    salida = []
    if len(bloques) > 1 or (bloques and len(bloques[0]) < len(con_fecha)):
        for b in bloques:
            salida.append(_hito(f"parcial-{b[0]}-{b[-1]}", f"Parcial {_rango(b)}", ultima_sesion[b[-1]], b))
    fin = max(ultima_sesion[c] for c in con_fecha)
    salida.append(_hito("final", f"Examen final {_rango(con_fecha)}", fin + timedelta(days=1), con_fecha, final=True))
    return salida


APROBADO = 5.0


def con_estado(lista: list[dict], hechos: list[tuple[set[str], float | None]]) -> list[dict]:
    """Un hito está hecho cuando apruebas un examen que cubre todas sus lecciones; guarda la mejor nota.

    Un examen suspendido (o entregado en blanco) no lo cierra: sigue pendiente, con la nota a la vista.
    """
    salida = []
    for h in lista:
        notas = [n for lecciones, n in hechos if set(h["lecciones"]) <= lecciones and n is not None]
        mejor = max(notas) if notas else None
        salida.append({**h, "hecho": mejor is not None and mejor >= APROBADO, "nota": mejor})
    return salida
