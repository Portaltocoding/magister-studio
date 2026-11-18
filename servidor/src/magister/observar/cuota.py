"""La cuota de la suscripción: cuánto llevas usado en la sesión (ventana de 5 h) y en la semana, y cuánto se comería
una generación antes de aceptarla.

El CLI de Claude dice tras cada llamada la utilización de las dos ventanas (0 a 1). Con eso:
- el estado es el último dato que llegó;
- la calibración relaciona lo que sube cada barra con lo que han costado las llamadas de Magister desde el dato
  anterior (mediana de las últimas muestras: el uso de Claude fuera de Magister también sube la barra y es ruido);
- la estimación de una acción es su coste medio en tus llamadas por esa calibración.
Sin muestras suficientes se usa una cota prudente: lo usado en la ventana entre lo que Magister ha gastado en ella
(tiende a sobrestimar, que es lo seguro al avisar).

Se guarda en la tabla `instalacion` (clave «cuota»), sin migración.
"""

import statistics
import time
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from magister.cerebro.modelo import Llamada
from magister.datos.produccion import Ajuste, LlamadaFila
from magister.datos.sesion import nueva_sesion

CLAVE = "cuota"
VENTANAS = {"sesion": "five_hour", "semana": "seven_day"}
DURACION = {"sesion": 5 * 3600, "semana": 7 * 24 * 3600}
MUESTRAS = 40
MINIMO_MUESTRAS = 3
MISMA_VENTANA_S = 600

# Los prompts que gasta preparar una lección (apuntes, sus jueces y sus preguntas). Diapositivas y guion van aparte.
PROMPTS_MATERIAL = ("apuntes_contrato", "apuntes_bloque", "apuntes_refinar", "preguntas", "preguntas_test", "priming",
                    "conceptos", "juez_tono", "juez_completitud")
MINUTOS_GUION = 6


# ===== Puro: calibración =====

def actualizar(estado: dict, limites: dict | None, coste: float) -> dict:
    """El estado nuevo tras una llamada que costó `coste` (equivalente en USD) y trajo `limites` (o no)."""
    e = {"sesion": None, "semana": None, "pendiente": {"sesion": 0.0, "semana": 0.0}, "muestras": {"sesion": [], "semana": []},
         **estado}
    e["pendiente"] = {v: float(e["pendiente"].get(v, 0.0)) + coste for v in VENTANAS}
    e["muestras"] = {v: list(e["muestras"].get(v, [])) for v in VENTANAS}
    for v, nombre in VENTANAS.items():
        dato = (limites or {}).get(nombre)
        if not dato or dato.get("utilization") is None:
            continue
        uso, reinicia = float(dato["utilization"]), int(dato.get("resetsAt") or 0)
        if reinicia <= 0:
            continue  # sin hora de renovación no se sabe a qué ventana pertenece
        previo = e.get(v)
        # La misma ventana aunque su hora de renovación baile unos minutos entre llamadas.
        if previo and abs(previo["reinicia"] - reinicia) <= MISMA_VENTANA_S:
            if uso < previo["uso"]:
                continue  # una lectura vieja que llega tarde (dos llamadas a la vez): no hace retroceder la barra
            if uso > previo["uso"] and e["pendiente"][v] > 0:
                e["muestras"][v] = (e["muestras"][v] + [(uso - previo["uso"]) / e["pendiente"][v]])[-MUESTRAS:]
                e["pendiente"][v] = 0.0
            # Si no se movió (la barra sube de 1 en 1 %), se sigue acumulando el coste hasta que se mueva.
        else:
            e["pendiente"][v] = 0.0  # ventana nueva: lo de antes no se compara con esto
        e[v] = {"uso": uso, "reinicia": reinicia}
    return e


def fraccion_por_coste(estado: dict, ventana: str) -> float | None:
    """Cuánto sube la barra (0 a 1) por cada unidad de coste, según las muestras; None si aún no hay bastantes."""
    m = (estado.get("muestras") or {}).get(ventana) or []
    return statistics.median(m) if len(m) >= MINIMO_MUESTRAS else None


def coste_de_video(coste_guion: float, minutos: int) -> float:
    """El guion escala con la duración (sobre todo la salida); la entrada (los apuntes) es fija."""
    return coste_guion * (0.4 + 0.6 * minutos / MINUTOS_GUION)


# ===== Con base =====

async def guardar_cuota(ll: Llamada) -> None:
    """Observador del cerebro: cada llamada actualiza el estado y, si trajo los límites, la calibración."""
    if ll.motor == "eco" or (not ll.limites and not ll.coste_equivalente):
        return
    async with nueva_sesion() as s, s.begin():
        # Primero la fila existe (dos llamadas a la vez en el primer uso no chocan) y luego se bloquea.
        await s.execute(insert(Ajuste).values(clave=CLAVE, valor={}).on_conflict_do_nothing(index_elements=[Ajuste.clave]))
        fila = await s.get(Ajuste, CLAVE, with_for_update=True, populate_existing=True)
        nuevo = actualizar(fila.valor or {}, ll.limites, ll.coste_equivalente)
        nuevo["actualizado"] = int(time.time())
        fila.valor = nuevo


async def _estado_guardado() -> dict:
    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, CLAVE)
        return fila.valor if fila else {}


async def _coste_medio(prompts: tuple[str, ...]) -> float:
    async with nueva_sesion() as s:
        return float(await s.scalar(select(func.avg(LlamadaFila.coste_equivalente)).where(LlamadaFila.prompt_nombre.in_(prompts))) or 0.0)


async def _coste_material_por_leccion() -> float:
    from magister.datos.material import Material

    async with nueva_sesion() as s:
        total = float(await s.scalar(select(func.sum(LlamadaFila.coste_equivalente)).where(LlamadaFila.prompt_nombre.in_(PROMPTS_MATERIAL))) or 0.0)
        lecciones = int(await s.scalar(select(func.count()).select_from(Material).where(Material.tipo == "apuntes")) or 0)
    return total / lecciones if lecciones else 0.0


async def _coste_en_ventana(ventana: str, reinicia: int) -> float:
    desde = datetime.fromtimestamp(reinicia - DURACION[ventana], UTC)
    async with nueva_sesion() as s:
        return float(await s.scalar(select(func.sum(LlamadaFila.coste_equivalente)).where(LlamadaFila.creada >= desde)) or 0.0)


async def coste_de(accion: str, minutos: int | None = None) -> float:
    """Coste equivalente medio de una acción, sacado de tus llamadas."""
    if accion == "video":
        return coste_de_video(await _coste_medio(("guion_grafico",)) or await _coste_medio(("guion",)) or 0.07, minutos or MINUTOS_GUION)
    if accion == "diapositivas":
        return await _coste_medio(("diapositivas",))
    if accion == "material":
        return await _coste_material_por_leccion()
    if accion == "mensaje":
        return await _coste_medio(("conversar", "responder"))
    # Proyectos: el roadmap entero (más el dibujo de la arquitectura) y detallar un nivel. Mientras no haya llamadas
    # tuyas de esos prompts, un valor prudente (sobrestimar es lo seguro al avisar).
    if accion == "proyecto":
        return (await _coste_medio(("proyecto_roadmap",)) or 0.12) + (await _coste_medio(("proyecto_arquitectura",)) or 0.05)
    if accion == "nivel":
        return await _coste_medio(("proyecto_nivel",)) or 0.06
    # Un plan nuevo: el diagnóstico y el planificador.
    if accion == "plan":
        return (await _coste_medio(("planificar",)) or 0.05) + (await _coste_medio(("diagnostico",)) or 0.01) * 4
    raise ValueError(f"acción desconocida: {accion}")


def vigente(d: dict | None, ahora: float) -> dict | None:
    """La ventana tal como está ahora: si su hora de renovación ya pasó, se renovó y está vacía (hasta la próxima
    llamada no se sabe cuándo vuelve a renovarse)."""
    if not d:
        return None
    if d["reinicia"] <= ahora:
        return {"uso": 0.0, "reinicia": None}
    return {"uso": d["uso"], "reinicia": d["reinicia"]}


async def estado() -> dict:
    """Lo que enseña la barra: uso de cada ventana (0 a 1) y cuándo se renueva."""
    e = await _estado_guardado()
    ahora = time.time()
    return {v: vigente(e.get(v), ahora) for v in VENTANAS}


async def estimar(accion: str, minutos: int | None = None) -> dict:
    """Cuánto subiría cada barra con esta acción (fracción de la ventana), y si la cifra está calibrada."""
    e = await _estado_guardado()
    coste = await coste_de(accion, minutos)
    ahora = time.time()
    salida: dict = {"accion": accion}
    for v in VENTANAS:
        por_coste = fraccion_por_coste(e, v)
        calibrada = por_coste is not None
        d = e.get(v)
        # Sin muestras, la cota prudente solo vale con una ventana vigente (la de una renovada ya no dice nada).
        if not calibrada and d and d["reinicia"] > ahora:
            gastado = await _coste_en_ventana(v, d["reinicia"])
            por_coste = d["uso"] / gastado if gastado > 0 else None
        # Sin coste conocido (aún no hay llamadas de esa acción) no hay estimación: mejor «sin datos» que «gratis».
        extra = round(coste * por_coste, 4) if por_coste and coste > 0 else None
        salida[v] = {"extra": extra, "calibrada": calibrada}
    return salida
