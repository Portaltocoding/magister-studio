"""Tus datos: exportarlos todos y borrarlos (Parte VI, «El registro de datos y la ficha del sistema»)."""

import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from sqlalchemy import text

from magister.datos.sesion import nueva_sesion

TABLAS = ["temas", "conversaciones", "mensajes", "mensajes_citas", "planes", "lecciones", "conceptos", "dependencias", "sesiones",
          "materiales", "bloques_material", "preguntas", "preguntas_concepto", "intentos", "servidas", "etiquetas",
          "llamadas", "puntuaciones", "candidatos_banco"]
# Lo que borra `borrar-todo` (las fuentes, solo con --fuentes). El orden respeta las claves foráneas.
BORRAR = ["candidatos_banco", "puntuaciones", "llamadas", "servidas", "intentos", "etiquetas", "banco_tono", "preguntas_concepto",
          "preguntas", "bloques_material", "materiales", "trabajos", "propuestas", "tareas_research", "lecciones_apoyo",
          "lecciones_fragmentos", "sesiones", "dependencias", "conceptos", "lecciones", "planes", "mensajes_citas", "mensajes",
          "conversaciones", "temas", "cache_respuestas", "alertas"]
FUENTES = ["busquedas", "fragmentos", "versiones", "documentos", "fuentes"]

LEEME = """Exportación de Magister Studio

Un fichero JSON por tabla, con todas sus filas. Lo principal:
- conversaciones.json y mensajes.json: tus conversaciones con el tutor (rol, contenido, estado y tiempos).
- planes.json: tus planes, con tu perfil de estudio (perfil) en cada versión; lecciones, conceptos y sesiones del calendario.
- materiales.json, bloques_material.json y preguntas.json: los apuntes, diapositivas, guiones y fichas generados.
- intentos.json: cada respuesta tuya en el repaso, con la nota del corrector, tu nota si la corregiste, tu confianza y la latencia.
- servidas.json: lo que el tutor apostaba (p_predicha) antes de cada pregunta.
- llamadas.json y puntuaciones.json: el registro de llamadas al modelo (tokens, tiempos) y sus métricas.
Las fuentes (documentos y fragmentos) no se exportan aquí: los originales están en servidor/crudo.
"""


def _a_json(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (UUID, Decimal)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return [_a_json(x) for x in v]
    if isinstance(v, str) and len(v) > 2000 and v.startswith("["):
        return v
    if hasattr(v, "tolist"):
        return v.tolist()
    return v


async def exportar(carpeta: Path) -> dict[str, int]:
    carpeta.mkdir(parents=True, exist_ok=True)
    cuentas = {}
    async with nueva_sesion() as s:
        for t in TABLAS:
            filas = (await s.execute(text(f"select * from {t}"))).mappings().all()
            datos = [{k: _a_json(v) for k, v in f.items()} for f in filas]
            (carpeta / f"{t}.json").write_text(json.dumps(datos, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
            cuentas[t] = len(datos)
    (carpeta / "LEEME.txt").write_text(LEEME, encoding="utf-8")
    return cuentas


async def borrar_todo(confirmar: bool, fuentes: bool = False) -> dict[str, int]:
    tablas = BORRAR + (FUENTES if fuentes else [])
    cuentas = {}
    async with nueva_sesion() as s, s.begin():
        for t in tablas:
            cuentas[t] = await s.scalar(text(f"select count(*) from {t}"))
        if confirmar:
            await s.execute(text(f"truncate {', '.join(tablas)} restart identity cascade"))
    return cuentas
