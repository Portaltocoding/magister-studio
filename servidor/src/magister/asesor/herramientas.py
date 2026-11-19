"""Lo que el asesor puede mirar antes de proponer: dos lecturas de tus datos, y nada más.

Solo leen (ninguna escribe), solo de la base de Magister (ni web ni ficheros) y devuelven texto corto. El roadmap y
el diario del proyecto no son herramientas: son cortos y siempre hacen falta, así que van en el prompt desde el
principio (`diario`) y no cuestan una vuelta.
"""

import re
import unicodedata
from collections.abc import Awaitable, Callable

from sqlalchemy import select, text

from magister.datos.notas import Nota
from magister.datos.proyectos import Decision
from magister.datos.sesion import nueva_sesion

MAX_RESULTADO = 6000
NOMBRES = {"buscar_notas": "tus notas", "ver_plan_estudio": "tu plan de estudio"}


async def diario(proyecto_id: int | None) -> str:
    """Las decisiones apuntadas en el diario del proyecto, de la más reciente a la más antigua."""
    if proyecto_id is None:
        return "(no hay proyecto)"
    async with nueva_sesion() as s:
        filas = (await s.scalars(select(Decision).where(Decision.proyecto_id == proyecto_id)
                                 .order_by(Decision.id.desc()).limit(30))).all()
    lineas = []
    for d in filas:
        extra = "".join(f" {k}: {v}." for k, v in (("Contexto", d.contexto), ("Consecuencias", d.consecuencias)) if v)
        lineas.append(f"- {d.creada_en.date().isoformat()} · {d.titulo}{f' (en el paso {d.paso_id})' if d.paso_id else ''}: "
                      f"{d.decision}{extra}")
    return "\n".join(lineas)[:3000] or "(el diario está vacío)"


def _palabras(t: str) -> list[str]:
    plano = "".join(c for c in unicodedata.normalize("NFD", t.lower()) if not unicodedata.combining(c))
    return [w for w in re.findall(r"[a-z0-9ñ]+", plano) if len(w) > 2][:6]


async def buscar_notas(proyecto_id: int | None, consulta: str | None = None) -> str:
    """Las notas de «Mis notas» que más palabras de la consulta tienen (hasta 5, recortadas)."""
    palabras = _palabras(consulta or "")
    if not palabras:
        return "(buscar_notas necesita una consulta con las palabras que buscas)"
    # Se puntúa en Python sobre las notas recientes (son tuyas y son pocas): sin tildes y sin extensiones de Postgres.
    async with nueva_sesion() as s:
        notas = (await s.scalars(select(Nota).order_by(Nota.id.desc()).limit(300))).all()
    puntuadas = []
    for n in notas:
        donde = set(_palabras_todas(f"{n.texto} {n.comentario or ''}"))
        aciertos = sum(1 for w in palabras if w in donde)
        if aciertos:
            puntuadas.append((aciertos, n.id, n))
    puntuadas.sort(key=lambda x: (-x[0], -x[1]))
    lineas = [f"- Nota {n.id}{f' ({n.origen})' if n.origen else ''}: {n.texto[:1200]}"
              + (f"\n  Tu comentario: {n.comentario[:300]}" if n.comentario else "") for _, _, n in puntuadas[:5]]
    return "\n".join(lineas) or f"(ninguna nota habla de: {', '.join(palabras)})"


def _palabras_todas(t: str) -> list[str]:
    plano = "".join(c for c in unicodedata.normalize("NFD", t.lower()) if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9ñ]+", plano)


async def ver_plan_estudio(proyecto_id: int | None, consulta: str | None = None) -> str:
    """Las lecciones de tus planes de estudio aceptados, con sus objetivos y si están hechas."""
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select t.nombre, l.clave, l.titulo, l.objetivos, coalesce(bool_and(se.estado = 'hecha'), false) "
            "from lecciones l join planes p on p.id = l.plan_id and p.estado = 'aceptado' join temas t on t.id = p.tema_id "
            "left join sesiones se on se.plan_id = l.plan_id and se.leccion_clave = l.clave "
            "group by t.nombre, l.plan_id, l.clave, l.titulo, l.objetivos, l.orden order by l.plan_id, l.orden limit 80"))).all()
    lineas, tema = [], None
    for nombre, clave, titulo, objetivos, hecha in filas:
        if nombre != tema:
            lineas.append(f"Plan «{nombre}»:")
            tema = nombre
        lineas.append(f"- {clave} {titulo}{' (hecha)' if hecha else ''}: {'; '.join((objetivos or [])[:3])}")
    return "\n".join(lineas) or "(no tiene ningún plan de estudio aceptado)"


HERRAMIENTAS: dict[str, Callable[[int | None, str | None], Awaitable[str]]] = {
    "buscar_notas": buscar_notas, "ver_plan_estudio": ver_plan_estudio,
}


async def leer(herramienta: str, proyecto_id: int | None, consulta: str | None) -> str:
    """El resultado de una lectura, recortado. Un fallo de la base es un resultado más, no un error del turno."""
    try:
        return (await HERRAMIENTAS[herramienta](proyecto_id, consulta))[:MAX_RESULTADO]
    except Exception as e:  # noqa: BLE001  (sin esa lectura, el asesor propone con lo que tiene)
        return f"(no se pudo leer: {type(e).__name__})"


def descripcion(lectura: dict) -> str:
    """«tus notas sobre «moto»»: lo que se le enseña al alumno de cada lectura."""
    nombre = NOMBRES.get(lectura["herramienta"], lectura["herramienta"])
    if lectura["herramienta"] == "buscar_notas" and lectura.get("consulta"):
        return f"{nombre} sobre «{lectura['consulta']}»"
    return nombre
