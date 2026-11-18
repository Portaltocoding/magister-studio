"""El mapa de modelos: quién hace qué, en qué modelo y con qué resultado (Parte VI).

Agrega `llamadas` y `puntuaciones` por tarea y por plantilla y saca recomendaciones con
reglas fijas: ningún modelo interviene en los números ni en los consejos.

    uv run python -m magister.observar.mapa_modelos 30
"""

import os
from collections import defaultdict
from datetime import datetime
from statistics import mean

from sqlalchemy import text

from magister.cerebro.enrutador import tabla
from magister.config import ajustes
from magister.datos.sesion import nueva_sesion

HACE = {
    "conversar": "Conversa contigo, responde y negocia el plan.",
    "explicar": "Explica un concepto o un fallo con tus apuntes delante.",
    "corregir": "Corrige tus respuestas y dice por qué.",
    "generar": "Escribe apuntes, preguntas, diapositivas y guiones.",
    "planificar": "Monta el plan de estudio.",
    "extraer": "Saca datos de un texto: perfil, conceptos, reescrituras.",
    "juez": "Revisa la calidad de otras respuestas (tono, completitud).",
}
INTERACTIVAS = {"conversar", "explicar", "corregir", "planificar"}
GRANDES = ("opus", "sonnet")
# Umbrales de las reglas: aquí, a la vista, y no repartidos por el código.
MIN_LLAMADAS = 5
MIN_CALIDAD = 10
PROMPT_GRANDE = 4000
CACHE_BAJA = 0.30
CALIDAD_ALTA = 0.85
CALIDAD_BAJA = 0.60
TTFT_ALTO_MS = 8000
TOTAL_ALTO_MS = 60000
ERROR_ALTO = 0.05
REINTENTOS_ALTOS = 0.3


def percentil(valores: list[float], p: float) -> float | None:
    """Percentil con interpolación lineal; None si no hay datos."""
    v = sorted(valores)
    if not v:
        return None
    k = (len(v) - 1) * p
    i = int(k)
    j = min(i + 1, len(v) - 1)
    return v[i] + (v[j] - v[i]) * (k - i)


def modelo_configurado(tarea: str) -> str:
    """Lo que dice el yaml (o la variable MAGISTER_MODELO_<TAREA>) para la tarea, con «defecto» resuelto."""
    conf = tabla().get("tareas", {}).get(tarea, {})
    variable = os.environ.get(f"MAGISTER_MODELO_{tarea.upper()}")
    modelo = variable.partition(":")[2] if variable else conf.get("modelo", "defecto")
    return ajustes.modelo if modelo in ("defecto", "") else modelo


def tarea_de(plantilla: str | None, funcion: str) -> str:
    prompts = tabla().get("prompts", {})
    if plantilla and plantilla in prompts:
        return prompts[plantilla]
    return funcion if funcion in tabla().get("tareas", {}) else "conversar"


def _media(xs: list[float]) -> float | None:
    return mean(xs) if xs else None


def resumen(filas: list[dict]) -> dict:
    """Estadísticas de un grupo de llamadas (cada fila, un dict con las columnas de `llamadas` y las notas)."""
    n = len(filas)
    entrada = [f["tokens_entrada"] + f["tokens_cache_lectura"] + f["tokens_cache_escritura"] for f in filas]
    leido = sum(f["tokens_cache_lectura"] for f in filas)
    costes = [f["coste_equivalente"] or 0.0 for f in filas]
    ttft = [f["ttft_ms"] for f in filas if f["ttft_ms"] is not None]
    total = [f["total_ms"] for f in filas if f["total_ms"] is not None]
    tono = [f["tono_juez"] for f in filas if f.get("tono_juez") is not None]
    fb = [f["feedback_usuario"] for f in filas if f.get("feedback_usuario") is not None]
    modelos: dict[str, int] = defaultdict(int)
    for f in filas:
        modelos[f["modelo_respondido"] or f["modelo_pedido"]] += 1
    return {
        "llamadas": n,
        "modelos_respondidos": dict(sorted(modelos.items(), key=lambda kv: -kv[1])),
        "coste_total": round(sum(costes), 4),
        "coste_medio": round(sum(costes) / n, 5) if n else 0.0,
        "tokens_entrada_medios": round(mean(entrada)) if n else 0,
        "tokens_salida_medios": round(mean(f["tokens_salida"] for f in filas)) if n else 0,
        "cache_leida": round(leido / sum(entrada), 3) if sum(entrada) else 0.0,
        "ttft_p50_ms": percentil(ttft, 0.5), "ttft_p95_ms": percentil(ttft, 0.95),
        "total_p50_ms": percentil(total, 0.5), "total_p95_ms": percentil(total, 0.95),
        "tasa_error": round(sum(1 for f in filas if f["error"]) / n, 3) if n else 0.0,
        "reintentos_medios": round(mean(f["reintentos"] for f in filas), 3) if n else 0.0,
        "respaldos": sum(1 for f in filas if f["respaldo"]),
        "calidad": {
            "tono_juez": _media(tono), "n_tono_juez": len(tono),
            "feedback_usuario": _media(fb), "n_feedback_usuario": len(fb),
        },
    }


def _calidad(r: dict) -> tuple[float | None, int]:
    """La señal de calidad con más datos: el juez de tono o, si hay más, el pulgar."""
    c = r["calidad"]
    if c["n_tono_juez"] >= c["n_feedback_usuario"] and c["tono_juez"] is not None:
        return c["tono_juez"], c["n_tono_juez"]
    return c["feedback_usuario"], c["n_feedback_usuario"]


def recomendaciones(tareas: list[dict], plantillas: list[dict]) -> list[dict]:
    """Reglas fijas; cada una lleva el número que la justifica."""
    out: list[dict] = []

    def ya(tipo: str, objeto: str, gravedad: str, texto: str, numero: str) -> None:
        out.append({"tipo": tipo, "objeto": objeto, "gravedad": gravedad, "texto": texto, "numero": numero})

    for p in plantillas:
        if p["llamadas"] >= MIN_LLAMADAS and p["tokens_entrada_medios"] >= PROMPT_GRANDE and p["cache_leida"] < CACHE_BAJA:
            ya("cache", p["plantilla"], "media",
               f"«{p['plantilla']}» manda prompts grandes y casi no aprovecha la caché: separa lo fijo de lo variable y pon lo fijo primero.",
               f"{p['tokens_entrada_medios']} tokens de entrada de media, {p['cache_leida']:.0%} leído de caché")
    for t in tareas:
        n, nombre = t["llamadas"], t["tarea"]
        if n < MIN_LLAMADAS:
            continue
        cal, ncal = _calidad(t)
        modelo = (t["modelo_configurado"] or "").lower()
        if t["tasa_error"] > ERROR_ALTO:
            ya("errores", nombre, "alta", f"La tarea «{nombre}» falla demasiado: revisa el motor o el prompt.",
               f"{t['tasa_error']:.0%} de {n} llamadas con error")
        if t["reintentos_medios"] > REINTENTOS_ALTOS:
            ya("reintentos", nombre, "media", f"La tarea «{nombre}» reintenta a menudo: cada reintento es tiempo y coste perdidos.",
               f"{t['reintentos_medios']:.2f} reintentos por llamada")
        if t["respaldos"]:
            ya("respaldo", nombre, "media", f"La tarea «{nombre}» ha tenido que caer al modelo de respaldo.",
               f"{t['respaldos']} de {n} llamadas con respaldo")
        if nombre in INTERACTIVAS:
            if (t["ttft_p95_ms"] or 0) > TTFT_ALTO_MS or (t["total_p95_ms"] or 0) > TOTAL_ALTO_MS:
                ya("latencia", nombre, "alta",
                   f"«{nombre}» es interactiva y tarda demasiado en empezar o en acabar: prueba un modelo más rápido o un prompt más corto.",
                   f"p95 de primer token {(t['ttft_p95_ms'] or 0) / 1000:.1f} s, total {(t['total_p95_ms'] or 0) / 1000:.1f} s")
        elif any(g in modelo for g in GRANDES) and cal is not None and ncal >= MIN_CALIDAD and cal >= CALIDAD_ALTA:
            ya("bajar_modelo", nombre, "baja",
               f"«{nombre}» es una tarea de fondo con un modelo grande ({t['modelo_configurado']}) y la calidad es alta: candidata a probar con haiku.",
               f"calidad media {cal:.0%} en {ncal} valoraciones, {t['coste_total']:.2f} USD en el periodo")
        if cal is not None and ncal >= MIN_CALIDAD and cal < CALIDAD_BAJA:
            if "haiku" in modelo:
                ya("subir_modelo", nombre, "media", f"«{nombre}» va con haiku y la calidad es baja: prueba un modelo mayor.",
                   f"calidad media {cal:.0%} en {ncal} valoraciones")
            else:
                ya("calidad_baja", nombre, "media",
                   f"La calidad de «{nombre}» es baja con {t['modelo_configurado']}: el problema parece del prompt o del criterio del juez, no del modelo; revisa los suspensos.",
                   f"calidad media {cal:.0%} en {ncal} valoraciones")
        distinto = [m for m in t["modelos_respondidos"] if modelo and modelo not in m.lower() and m != "eco"]
        if distinto:
            ya("desvio", nombre, "baja", f"«{nombre}» está configurada con {t['modelo_configurado']} pero ha respondido otro modelo.",
               ", ".join(f"{m}: {t['modelos_respondidos'][m]}" for m in distinto))
    orden = {"alta": 0, "media": 1, "baja": 2}
    return sorted(out, key=lambda r: orden[r["gravedad"]])


def construir(filas: list[dict], dias: int) -> dict:
    por_tarea: dict[str, list[dict]] = defaultdict(list)
    por_plantilla: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for f in filas:
        t = tarea_de(f["prompt_nombre"], f["funcion"])
        por_tarea[t].append(f)
        por_plantilla[(f["prompt_nombre"] or f["funcion"], t)].append(f)
    nombres = list(dict.fromkeys([*tabla().get("tareas", {}), *por_tarea]))
    tareas = [{"tarea": t, "hace": HACE.get(t, ""), "interactiva": t in INTERACTIVAS, "modelo_configurado": modelo_configurado(t),
               **resumen(por_tarea.get(t, []))} for t in nombres]
    plantillas = [{"plantilla": p, "tarea": t, "modelo_configurado": modelo_configurado(t), **resumen(fs)}
                  for (p, t), fs in sorted(por_plantilla.items(), key=lambda kv: -sum(f["coste_equivalente"] or 0 for f in kv[1]))]
    return {"dias": dias, "generado": datetime.now().astimezone().isoformat(timespec="seconds"), "tareas": tareas,
            "plantillas": plantillas, "recomendaciones": recomendaciones(tareas, plantillas)}


async def mapa(dias: int = 30) -> dict:
    async with nueva_sesion() as s:
        r = await s.execute(text(
            "select l.funcion, l.prompt_nombre, l.modelo_pedido, l.modelo_respondido, l.tokens_entrada, l.tokens_salida, "
            "l.tokens_cache_lectura, l.tokens_cache_escritura, l.coste_equivalente, l.ttft_ms, l.total_ms, l.reintentos, "
            "l.respaldo, l.error, t.valor as tono_juez, f.valor as feedback_usuario "
            "from llamadas l "
            "left join puntuaciones t on t.traza_id = l.traza_id and t.nombre = 'tono_juez' "
            "left join puntuaciones f on f.traza_id = l.traza_id and f.nombre = 'feedback_usuario' "
            "where l.creada > now() - make_interval(days => :d)"), {"d": dias})
        filas = [dict(x._mapping) for x in r]
    return construir(filas, dias)


if __name__ == "__main__":
    import asyncio
    import json
    import sys

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    print(json.dumps(asyncio.run(mapa(int(sys.argv[1]) if len(sys.argv) > 1 else 30)), indent=1, ensure_ascii=False))
