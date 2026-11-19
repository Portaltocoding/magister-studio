"""Automatizaciones: reglas que el alumno enciende y que la API revisa cada pocos minutos.

- preparar_siguiente: prepara (apuntes y fichas) la próxima lección del calendario con unos días de antelación.
- diapositivas_al_preparar / video_al_preparar: cuando una lección queda preparada, hace sus diapositivas o su vídeo
  (el vídeo, solo en las lecciones que el roadmap elige: plan/videos.py).
- solo_de_noche: todo lo anterior solo entre las 0:00 y las 7:00, para no gastar cuota mientras estudias.

Como mucho un trabajo por vuelta y nunca si ya hay uno en marcha: la cola no se llena sola.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta

from sqlalchemy import text

from magister.datos.sesion import nueva_sesion
from magister.material import videos_plan
from magister.trabajos import cola

registro = logging.getLogger(__name__)

PREDETERMINADAS = {
    "preparar_siguiente": {"activa": False, "dias_antes": 1},
    "diapositivas_al_preparar": {"activa": False},
    "video_al_preparar": {"activa": False, "estilo": "clase", "minutos": 6},
    "solo_de_noche": False,
}
INTERVALO_S = 600

# Las (plan_id, clave) que el research automático lanzaría ahora (api/app.py lo engancha al arrancar): sus apuntes
# esperan como si sus fuentes ya estuvieran llegando. Sin gancho, no se espera a nada más.
_por_investigar: Callable[[date], Awaitable[set[tuple[int, str]]]] | None = None


def registrar_por_investigar(funcion: Callable[[date], Awaitable[set[tuple[int, str]]]] | None) -> None:
    global _por_investigar
    _por_investigar = funcion


async def leer() -> dict:
    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, "automatizaciones")
    valor = fila.valor if fila else {}
    return {k: ({**v, **valor.get(k, {})} if isinstance(v, dict) else valor.get(k, v)) for k, v in PREDETERMINADAS.items()}


async def guardar(config: dict) -> dict:
    from sqlalchemy.dialects.postgresql import insert

    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(Ajuste).values(clave="automatizaciones", valor=config)
                        .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": config}))
    return await leer()


async def anotar(texto: str) -> None:
    """El registro de lo que hicieron las automatizaciones (las 30 últimas)."""
    from sqlalchemy.dialects.postgresql import insert

    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s, s.begin():
        fila = await s.get(Ajuste, "automatizaciones_registro")
        lista = [{"momento": datetime.now().isoformat(timespec="minutes"), "texto": texto}, *((fila.valor or {}).get("lista", []) if fila else [])][:30]
        await s.execute(insert(Ajuste).values(clave="automatizaciones_registro", valor={"lista": lista})
                        .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": {"lista": lista}}))


async def ver_registro() -> list[dict]:
    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, "automatizaciones_registro")
    return (fila.valor or {}).get("lista", []) if fila else []


def es_de_noche(ahora: datetime) -> bool:
    return 0 <= ahora.hour < 7


async def _hay_trabajo_en_marcha() -> bool:
    async with nueva_sesion() as s:
        return bool(await s.scalar(text("select count(*) from trabajos where estado in ('pendiente', 'en_curso')")))


async def _lecciones(hoy: date, dias: int) -> list[dict]:
    """Por lección de los planes aceptados: su primera sesión pendiente y qué material tiene ya."""
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select l.plan_id, l.clave, l.titulo, l.orden, "
            "(select min(se.fecha) from sesiones se where se.plan_id = l.plan_id and se.leccion_clave = l.clave and se.estado = 'pendiente'), "
            "coalesce(array_agg(distinct m.tipo) filter (where m.estado in ('listo', 'revisar')), '{}') "
            "from lecciones l join planes p on p.id = l.plan_id and p.estado = 'aceptado' "
            "left join materiales m on m.plan_id = l.plan_id and m.leccion_clave = l.clave "
            "group by l.plan_id, l.clave, l.titulo, l.orden order by l.plan_id, l.orden"))).all()
    return [{"plan_id": p, "clave": c, "titulo": t, "fecha": f, "tipos": set(tipos or [])} for p, c, t, _, f, tipos in filas]


async def _marcar_videos(lecciones: list[dict]) -> None:
    """Qué lecciones llevan vídeo según tu preferencia del roadmap, y de cuántos minutos (el estilo es el de la regla)."""
    pref = await videos_plan.preferencias()
    elegidas: set[tuple[int, str]] = set()
    for plan_id in {x["plan_id"] for x in lecciones}:
        elegidas |= {(plan_id, r.clave) for r in await videos_plan.recomendadas(plan_id, pref["cuantos"])}
    for x in lecciones:
        x.update(video=(x["plan_id"], x["clave"]) in elegidas, minutos=pref["minutos"])


def elegir_tarea(config: dict, lecciones: list[dict], hoy: date,
                 descartadas: frozenset[tuple[int, str, str]] = frozenset(),
                 esperando: frozenset[tuple[int, str]] = frozenset()) -> tuple[dict, list[str], dict] | None:
    """La primera cosa que toca hacer según las reglas encendidas, o None. Sin efectos: se puede probar.

    `descartadas` son las (plan_id, clave, tipo principal) que ya se intentaron hoy y no salieron: se saltan.
    `esperando` son las (plan_id, clave) cuyas fuentes están llegando: sus apuntes esperan (solo los de preparar)."""

    def fuera(lec: dict, tipo: str) -> bool:
        return (lec["plan_id"], lec["clave"], tipo) in descartadas

    regla = config["preparar_siguiente"]
    if regla.get("activa"):
        limite = hoy + timedelta(days=int(regla.get("dias_antes", 1)))
        for lec in lecciones:
            if (lec["plan_id"], lec["clave"]) in esperando:
                continue
            if lec["fecha"] and lec["fecha"] <= limite and "apuntes" not in lec["tipos"] and not fuera(lec, "apuntes"):
                return lec, ["apuntes", "preguntas"], {}
    if config["diapositivas_al_preparar"].get("activa"):
        for lec in lecciones:
            if "apuntes" in lec["tipos"] and "diapositivas" not in lec["tipos"] and not fuera(lec, "diapositivas"):
                return lec, ["diapositivas"], {}
    video = config["video_al_preparar"]
    if video.get("activa"):
        # Solo las lecciones que tu plan elige para vídeo (las más duras, tantas como pidas en el roadmap); sin esa
        # marca (configuraciones antiguas), todas.
        for lec in lecciones:
            if "apuntes" in lec["tipos"] and "guion" not in lec["tipos"] and lec.get("video", True) and not fuera(lec, "guion"):
                return lec, ["guion"], {"video": {"estilo": lec.get("estilo") or video.get("estilo", "clase"),
                                                  "minutos": int(lec.get("minutos") or video.get("minutos", 6))}}
    return None


async def _esperando_fuentes(minutos: int) -> dict[tuple[int, str], datetime]:
    """Las lecciones cuyas fuentes están llegando, con hasta cuándo se las espera: una búsqueda de research en curso, un
    trabajo «incorporar» por hacer o propuestas aprobadas cuya versión aún se indexa. Solo lo empezado hace menos de
    `minutos`: pasado el plazo, los apuntes se preparan igual."""
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select plan_id, leccion_clave, creada_en from tareas_research "
            "where estado = 'en_curso' and creada_en > now() - make_interval(mins => :m) "
            "union all select plan_id, leccion_clave, creado_en from trabajos "
            "where tipo = 'incorporar' and estado in ('pendiente', 'en_curso') and leccion_clave is not null "
            "and creado_en > now() - make_interval(mins => :m) "
            "union all select p.plan_id, p.leccion_clave, v.ingerida_en from propuestas p join versiones v on v.id = p.version_id "
            "where p.estado = 'aprobada' and v.estado in ('recibida', 'pendiente') and v.ingerida_en > now() - make_interval(mins => :m)"
        ), {"m": minutos})).all()
    salida: dict[tuple[int, str], datetime] = {}
    for plan_id, clave, desde in filas:
        hasta = desde + timedelta(minutes=minutos)
        salida[(plan_id, clave)] = max(salida.get((plan_id, clave), hasta), hasta)
    return salida


async def una_vuelta(ahora: datetime | None = None) -> str | None:
    """Revisa las reglas y, si toca, encola un trabajo. Devuelve qué hizo (o None)."""
    from magister.config import ajustes

    ahora = ahora or datetime.now()
    config = await leer()
    if config.get("solo_de_noche") and not es_de_noche(ahora):
        return None
    if await _hay_trabajo_en_marcha():
        return None
    lecciones = await _lecciones(ahora.date(), 7)
    if config["video_al_preparar"].get("activa"):
        await _marcar_videos(lecciones)
    # Los apuntes de una lección cuyas fuentes están llegando esperan (hasta MAGISTER_MATERIAL_ESPERA_FUENTES minutos):
    # hechos ahora, saldrían a ciegas y habría que rehacerlos.
    hasta = await _esperando_fuentes(ajustes.material_espera_fuentes) if config["preparar_siguiente"].get("activa") else {}
    if config["preparar_siguiente"].get("activa") and _por_investigar is not None:
        # También lo que el research automático va a lanzar ya (tras reiniciar, su primera vuelta tarda unos minutos).
        try:
            proxima = ahora.astimezone() + timedelta(seconds=ajustes.research_intervalo_s)
            for leccion in await _por_investigar(ahora.date()):
                hasta.setdefault(leccion, proxima)
        except Exception:  # noqa: BLE001 si no se sabe, se prepara como antes
            registro.exception("qué va a buscar el research automático")
    esperando = frozenset(hasta)
    # Lo que ya se intentó hoy (hecho, fallido o cancelado) no se reabre: se pasa a lo siguiente. Mañana se reintenta.
    descartadas: set[tuple[int, str, str]] = set()
    sin_esperar = elegir_tarea(config, lecciones, ahora.date()) if esperando else None
    if sin_esperar is not None and (sin_esperar[0]["plan_id"], sin_esperar[0]["clave"]) in esperando:
        lec = sin_esperar[0]
        aviso = f"Espero a las fuentes de {lec['clave']} (hasta las {hasta[(lec['plan_id'], lec['clave'])].astimezone():%H:%M})"
        if not any(x.get("texto") == aviso for x in await ver_registro()):
            await anotar(aviso)
    for _ in range(3 * len(lecciones) + 1):
        tarea = elegir_tarea(config, lecciones, ahora.date(), frozenset(descartadas), esperando)
        if tarea is None:
            return None
        lec, tipos, preferencias = tarea
        que = {"apuntes": "preparar", "diapositivas": "hacer las diapositivas de", "guion": "hacer el vídeo de"}[tipos[0]]
        clave = cola.clave_idempotencia(automatizacion=True, plan_id=lec["plan_id"], leccion=lec["clave"], tipos=sorted(tipos),
                                        dia=ahora.date().isoformat())
        async with nueva_sesion() as s:
            estado = await s.scalar(text("select estado from trabajos where clave = :c"), {"c": clave})
        if estado in ("hecho", "fallido", "cancelado"):
            descartadas.add((lec["plan_id"], lec["clave"], tipos[0]))
            if estado != "cancelado":
                aviso = f"No he podido {que} {lec['clave']} · {lec['titulo']}: lo dejo por hoy."
                if not any(x.get("texto") == aviso for x in await ver_registro()):
                    await anotar(aviso)
            continue
        if estado is not None:
            return None
        _, nuevo = await cola.encolar("material", lec["plan_id"], lec["clave"], {"tipos": tipos, "preferencias": preferencias}, clave)
        if not nuevo:
            return None
        texto = f"Puesto en cola: {que} {lec['clave']} · {lec['titulo']}"
        await anotar(texto)
        return texto
    return None


async def bucle() -> None:
    ultimo_ajuste = None
    while True:
        try:
            await una_vuelta()
        except Exception:  # noqa: BLE001
            registro.exception("automatizaciones")
        # Tu modelo de olvido se reajusta solo una vez al día, de madrugada si el equipo está encendido o al arrancar.
        hoy = date.today()
        if ultimo_ajuste != hoy:
            ultimo_ajuste = hoy
            try:
                from magister.aprender import personal

                r = await personal.ajustar()
                if r.get("hecho"):
                    await anotar(f"Tu modelo de olvido se ha ajustado a tus repasos ({r['conceptos']} conceptos).")
                from magister.aprender import red

                antes = (red.meta() or {}).get("estado")
                rr = await red.entrenar()
                if rr.get("estado") == "activa" and antes != "activa":
                    await anotar("La red neuronal de olvido ya predice tus aciertos mejor que FSRS: ahora decide ella.")
            except Exception:  # noqa: BLE001
                registro.exception("ajuste personal")
        await asyncio.sleep(INTERVALO_S)
