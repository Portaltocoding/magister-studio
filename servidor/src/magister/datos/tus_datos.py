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
          "llamadas", "puntuaciones", "candidatos_banco", "eventos", "notas", "examenes", "proyectos",
          "proyecto_decisiones", "asesor_cambios", "propuestas", "tareas_research", "lecciones_apoyo",
          "lecciones_fragmentos", "banco_tono"]
# Las tablas que no son tuyas: de la instalación (el canario está en `instalacion`), la cola, cachés y avisos.
# Toda tabla está en TABLAS, en FUENTES o aquí (lo comprueba un test): así una nueva no se queda fuera sin decidirlo.
NO_SON_DEL_USUARIO = ["alembic_version", "instalacion", "configuraciones", "prompts_activos", "prompts_versiones",
                      "trabajadores", "trabajos", "cache_respuestas", "alertas"]
# Lo que borra `borrar-todo` (las fuentes, solo con --fuentes). El orden respeta las claves foráneas.
BORRAR = ["asesor_cambios", "proyecto_decisiones", "proyectos", "notas", "examenes", "candidatos_banco", "puntuaciones", "llamadas", "servidas", "intentos", "etiquetas", "banco_tono", "preguntas_concepto",
          "preguntas", "bloques_material", "materiales", "trabajos", "propuestas", "tareas_research", "lecciones_apoyo",
          "lecciones_fragmentos", "sesiones", "dependencias", "conceptos", "lecciones", "planes", "mensajes_citas", "mensajes",
          "conversaciones", "temas", "cache_respuestas", "alertas", "eventos"]
FUENTES = ["busquedas", "fragmentos", "versiones", "documentos", "fuentes"]

LEEME = """Exportación de Magister Studio

Un fichero JSON por tabla, con todas sus filas. Lo principal:
- conversaciones.json y mensajes.json: tus conversaciones con el tutor (rol, contenido, estado y tiempos).
- planes.json: tus planes, con tu perfil de estudio (perfil) en cada versión; lecciones, conceptos y sesiones del calendario.
- materiales.json, bloques_material.json y preguntas.json: los apuntes, diapositivas, guiones y fichas generados.
- intentos.json: cada respuesta tuya en el repaso, con la nota del corrector, tu nota si la corregiste, tu confianza y la latencia.
- servidas.json: lo que el tutor apostaba (p_predicha) antes de cada pregunta.
- llamadas.json y puntuaciones.json: el registro de llamadas al modelo (tokens, tiempos) y sus métricas.
- notas.json y examenes.json: Mis notas y tus exámenes y evaluaciones.
- proyectos.json, proyecto_decisiones.json y asesor_cambios.json: tus proyectos, su diario y los cambios del asesor.
- propuestas.json y tareas_research.json: las fuentes que se te propusieron y las búsquedas que las trajeron.
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


async def _existentes(s, tablas: list[str]) -> list[str]:
    """Las que ya están en la base: con una migración sin aplicar, exportar y borrar no fallan por una tabla nueva."""
    hay = set((await s.execute(text("select tablename from pg_tables where schemaname = current_schema()"))).scalars())
    return [t for t in tablas if t in hay]


async def exportar(carpeta: Path) -> dict[str, int]:
    carpeta.mkdir(parents=True, exist_ok=True)
    cuentas = {}
    async with nueva_sesion() as s:
        for t in await _existentes(s, TABLAS):
            filas = (await s.execute(text(f"select * from {t}"))).mappings().all()
            datos = [{k: _a_json(v) for k, v in f.items()} for f in filas]
            (carpeta / f"{t}.json").write_text(json.dumps(datos, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
            cuentas[t] = len(datos)
    (carpeta / "LEEME.txt").write_text(LEEME, encoding="utf-8")
    return cuentas


async def borrar_todo(confirmar: bool, fuentes: bool = False) -> dict[str, int]:
    cuentas = {}
    async with nueva_sesion() as s, s.begin():
        tablas = await _existentes(s, BORRAR + (FUENTES if fuentes else []))
        for t in tablas:
            cuentas[t] = await s.scalar(text(f"select count(*) from {t}"))
        if confirmar:
            await s.execute(text(f"truncate {', '.join(tablas)} restart identity cascade"))
    return cuentas
