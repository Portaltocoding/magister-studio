"""El asesor que hace cosas: tras su respuesta prepara el cambio que ofreció, y tú lo aplicas, descartas o deshaces."""

import logging
from collections.abc import AsyncIterator
from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.sse import ServerSentEvent

from magister.api.rutas_proyectos import RutaEnCastellano
from magister.asesor import arnes, herramientas
from magister.asesor.agente import NoSePuede, preparar
from magister.asesor.cambios import encargo_de, sin_bloque_cambio, sin_ids
from magister.cerebro.estructura import ErrorEstructura
from magister.cerebro.modelo import ErrorModelo

rutas = APIRouter(prefix="/api", route_class=RutaEnCastellano)
registro = logging.getLogger("magister.asesor")


def ahora() -> datetime:
    return datetime.now(timezone.utc)


async def tras_respuesta(cid: int, proyecto_id: int | None, texto: str, mensaje_id: int | None, turnos: list[dict],
                         hoy: date, plan_id: int | None = None) -> AsyncIterator[ServerSentEvent]:
    """Si la respuesta del asesor acaba en un bloque ```cambio, prepara ese cambio y lo manda como evento `cambio`
    (o `cambio_fallido`, con el porqué). No aplica nada. `plan_id`: el plan activo de la app, si hay."""
    encargo = encargo_de(texto)
    if not encargo:
        return
    yield ServerSentEvent(data={"nodo": "preparar_cambio", "detalle": "Preparando el cambio…"}, event="fase")
    propuesta = None
    proyecto = None
    try:
        proyecto = await arnes.leer_proyecto(proyecto_id)
        plan = await arnes.leer_plan(plan_id, hoy)
        conversacion = [*turnos, {"rol": "tutor", "contenido": sin_bloque_cambio(texto)}]
        async for que, dato in preparar(encargo, conversacion, proyecto, proyecto_id if proyecto else None, hoy,
                                        ahora().isoformat(timespec="seconds"), plan):
            if que == "leyendo":  # que se vea qué está mirando, no un «pensando» mudo
                mirando = " y ".join(herramientas.descripcion(x) for x in dato)
                yield ServerSentEvent(data={"nodo": "preparar_cambio", "detalle": f"Mirando {mirando}…"}, event="fase")
            else:
                cambios, resultado, prompt, lecturas = dato
                propuesta = await arnes.proponer(cid, mensaje_id, proyecto_id, encargo, cambios, resultado, proyecto,
                                                 prompt, lecturas, plan)
    except NoSePuede as e:
        # No es un fallo: el agente explica por qué no cabe en lo que puede hacer (se enseña tal cual).
        yield ServerSentEvent(data={"detalle": sin_ids(str(e), (proyecto or {}).get("roadmap")), "explicado": True},
                              event="cambio_fallido")
        return
    except arnes.ErrorCambio as e:
        yield ServerSentEvent(data={"detalle": e.detalle}, event="cambio_fallido")
        return
    except (ErrorEstructura, ErrorModelo) as e:
        registro.warning("no se pudo preparar el cambio del asesor: %s", e)
        yield ServerSentEvent(data={"detalle": "no he conseguido preparar un cambio que encaje con tu proyecto; "
                                               "dímelo con otras palabras o más concreto"}, event="cambio_fallido")
        return
    if propuesta is not None:
        yield ServerSentEvent(data=propuesta, event="cambio")


@rutas.get("/conversaciones/{cid}/cambios")
async def cambios_de_conversacion(cid: int) -> list[dict]:
    return await arnes.de_conversacion(cid)


async def _hacer(fn, cambio_id: int) -> dict:
    try:
        return await fn(cambio_id, ahora())
    except arnes.ErrorCambio as e:
        raise HTTPException(e.codigo, e.detalle) from None


async def preparar_apuntes(plan_id: int, clave: str) -> int:
    """Lo mismo que «Generar el material» en Lecciones (la misma ruta, con lo de siempre): encola apuntes y fichas."""
    from magister.api.rutas_material import PedirMaterial, pedir_material
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        return (await pedir_material(plan_id, clave, PedirMaterial(), s))["trabajo_id"]


@rutas.post("/cambios/{cambio_id}/aplicar")
async def aplicar(cambio_id: int) -> dict:
    return await _hacer(lambda cid, momento: arnes.aplicar(cid, momento, preparar_apuntes), cambio_id)


@rutas.post("/cambios/{cambio_id}/descartar")
async def descartar(cambio_id: int) -> dict:
    return await _hacer(arnes.descartar, cambio_id)


@rutas.post("/cambios/{cambio_id}/deshacer")
async def deshacer(cambio_id: int) -> dict:
    return await _hacer(arnes.deshacer, cambio_id)
