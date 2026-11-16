"""Automatizaciones: reglas que el alumno enciende y que la API revisa cada pocos minutos.

- preparar_siguiente: prepara (apuntes y fichas) la próxima lección del calendario con unos días de antelación.
- diapositivas_al_preparar / video_al_preparar: cuando una lección queda preparada, hace sus diapositivas o su vídeo.
- solo_de_noche: todo lo anterior solo entre las 0:00 y las 7:00, para no gastar cuota mientras estudias.

Como mucho un trabajo por vuelta y nunca si ya hay uno en marcha: la cola no se llena sola.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import text

from magister.datos.sesion import nueva_sesion
from magister.trabajos import cola

registro = logging.getLogger(__name__)

PREDETERMINADAS = {
    "preparar_siguiente": {"activa": False, "dias_antes": 1},
    "diapositivas_al_preparar": {"activa": False},
    "video_al_preparar": {"activa": False, "estilo": "clase", "minutos": 6},
    "solo_de_noche": False,
}
INTERVALO_S = 600


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


def elegir_tarea(config: dict, lecciones: list[dict], hoy: date) -> tuple[dict, list[str], dict] | None:
    """La primera cosa que toca hacer según las reglas encendidas, o None. Sin efectos: se puede probar."""
    regla = config["preparar_siguiente"]
    if regla.get("activa"):
        limite = hoy + timedelta(days=int(regla.get("dias_antes", 1)))
        for lec in lecciones:
            if lec["fecha"] and lec["fecha"] <= limite and "apuntes" not in lec["tipos"]:
                return lec, ["apuntes", "preguntas"], {}
    if config["diapositivas_al_preparar"].get("activa"):
        for lec in lecciones:
            if "apuntes" in lec["tipos"] and "diapositivas" not in lec["tipos"]:
                return lec, ["diapositivas"], {}
    video = config["video_al_preparar"]
    if video.get("activa"):
        for lec in lecciones:
            if "apuntes" in lec["tipos"] and "guion" not in lec["tipos"]:
                return lec, ["guion"], {"video": {"estilo": video.get("estilo", "clase"), "minutos": int(video.get("minutos", 6))}}
    return None


async def una_vuelta(ahora: datetime | None = None) -> str | None:
    """Revisa las reglas y, si toca, encola un trabajo. Devuelve qué hizo (o None)."""
    ahora = ahora or datetime.now()
    config = await leer()
    if config.get("solo_de_noche") and not es_de_noche(ahora):
        return None
    if await _hay_trabajo_en_marcha():
        return None
    tarea = elegir_tarea(config, await _lecciones(ahora.date(), 7), ahora.date())
    if tarea is None:
        return None
    lec, tipos, preferencias = tarea
    clave = cola.clave_idempotencia(automatizacion=True, plan_id=lec["plan_id"], leccion=lec["clave"], tipos=sorted(tipos),
                                    dia=ahora.date().isoformat())
    _, nuevo = await cola.encolar("material", lec["plan_id"], lec["clave"], {"tipos": tipos, "preferencias": preferencias}, clave)
    if not nuevo:
        return None
    que = {"apuntes": "preparar", "diapositivas": "hacer las diapositivas de", "guion": "hacer el vídeo de"}[tipos[0]]
    texto = f"Puesto en cola: {que} {lec['clave']} · {lec['titulo']}"
    await anotar(texto)
    return texto


async def bucle() -> None:
    while True:
        try:
            await una_vuelta()
        except Exception:  # noqa: BLE001
            registro.exception("automatizaciones")
        await asyncio.sleep(INTERVALO_S)
