"""Correr el grafo de una conversación y traducir su flujo a eventos sencillos.

Eventos que salen: {"tipo": "fase", "nodo"}, {"tipo": "delta", "t"} y
{"tipo": "plan", ...propuesta}. Errores del modelo salen como ErrorModelo.
"""

from collections.abc import AsyncIterator
from datetime import date

from langgraph.types import Command

from magister.flujo.grafo import grafo


def _config(cid: int) -> dict:
    return {"configurable": {"thread_id": str(cid)}}


async def pendiente_de_decision(cid: int) -> bool:
    estado = await grafo().aget_state(_config(cid))
    return any(t.interrupts for t in estado.tasks)


async def propuesta_pendiente(cid: int) -> dict | None:
    estado = await grafo().aget_state(_config(cid))
    for tarea in estado.tasks:
        for interrupcion in tarea.interrupts:
            return interrupcion.value
    return None


async def fase_actual(cid: int) -> str | None:
    estado = await grafo().aget_state(_config(cid))
    return (estado.values or {}).get("fase")


async def _correr(entrada: dict | Command, cid: int) -> AsyncIterator[dict]:
    async for modo, datos in grafo().astream(entrada, _config(cid), stream_mode=["custom", "updates"]):
        if modo == "custom":
            if "t" in datos:
                yield {"tipo": "delta", "t": datos["t"]}
            elif "fase" in datos:
                yield {"tipo": "fase", "nodo": datos["fase"]}
            elif "citas" in datos:
                yield {"tipo": "citas", **datos}
            elif "opciones" in datos:
                yield {"tipo": "opciones", **datos["opciones"]}
            elif "guardado" in datos:
                yield {"tipo": "guardado", **datos["guardado"]}
            elif "acciones" in datos:
                yield {"tipo": "acciones", "acciones": datos["acciones"]}
            elif "latido" in datos:  # el modelo sigue razonando: segundos desde que empezó
                yield {"tipo": "latido", "segundos": datos["latido"]}
            elif "adelanto" in datos:  # mientras razona: por dónde irá la respuesta y frases para la espera
                yield {"tipo": "adelanto", **datos["adelanto"]}
        elif modo == "updates" and "__interrupt__" in datos:
            for interrupcion in datos["__interrupt__"]:
                yield {"tipo": "plan", **interrupcion.value}


async def mensaje(
    cid: int, texto: str, turnos: list[dict], hoy: date, fase_inicial: str, voz: bool = False, extra: dict | None = None
) -> AsyncIterator[dict]:
    """Un mensaje del alumno. Si había un plan propuesto, el mensaje cuenta como «cambiar»."""
    if await pendiente_de_decision(cid):
        async for ev in decision(cid, {"accion": "cambiar", "texto": texto}, hoy, turnos):
            yield ev
        return
    entrada: dict = {"conversacion_id": cid, "mensaje": texto, "turnos": turnos, "hoy": hoy.isoformat(), "voz": voz,
                     # Siempre se escriben todas: así un mensaje no hereda la llamada o el modo del anterior.
                     "llamada": False, "modo": None, "plan_id_leccion": None, "leccion_clave": None, "contexto": None, "nota_guardada": False,
                     "corregir": False, "asesor": False,
                     **{k: v for k, v in (extra or {}).items()}}
    if await fase_actual(cid) is None:
        entrada["fase"] = fase_inicial
    async for ev in _correr(entrada, cid):
        yield ev


async def decision(cid: int, cuerpo: dict, hoy: date, turnos: list[dict] | None = None) -> AsyncIterator[dict]:
    actualizar: dict = {"hoy": hoy.isoformat()}
    if turnos is not None:
        actualizar["turnos"] = turnos
    async for ev in _correr(Command(resume=cuerpo, update=actualizar), cid):
        yield ev
