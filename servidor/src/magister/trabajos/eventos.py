"""El progreso de un trabajo por SSE: `LISTEN trabajos` en una conexión propia de asyncpg."""

import asyncio
from collections.abc import AsyncIterator

import asyncpg

from magister.config import ajustes
from magister.trabajos import cola

TERMINADOS = ("hecho", "fallido", "cancelado")


def _dsn(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


def _eventos(t: dict, avisos_vistos: int) -> list[dict]:
    salida = [{"tipo": "fase", "trabajo_id": t["id"], "nodo": t["nodo"] or t["estado"], "paso": t["paso"], "total": t["total"],
               "estado": t["estado"]}]
    for a in t["avisos"][avisos_vistos:]:
        salida.append({"tipo": "aviso", "trabajo_id": t["id"], **a})
    if t["estado"] == "hecho":
        salida.append({"tipo": "fin", "trabajo_id": t["id"], "materiales": t["materiales"]})
    elif t["estado"] in ("fallido", "cancelado"):
        salida.append({"tipo": "error", "trabajo_id": t["id"], "detalle": t["error"] or t["estado"],
                       "reintentable": t["estado"] == "cancelado"})
    return salida


async def seguir(trabajo_id: int, url: str | None = None, latido_s: float = 15.0) -> AsyncIterator[dict]:
    """Al conectar emite el estado actual; después, uno por cada NOTIFY de este trabajo."""
    cola_local: asyncio.Queue[str] = asyncio.Queue()
    conexion = await asyncpg.connect(_dsn(url or ajustes.db_url))

    def al_notificar(_c, _pid, _canal, carga: str) -> None:
        if carga == str(trabajo_id):
            cola_local.put_nowait(carga)

    await conexion.add_listener("trabajos", al_notificar)
    try:
        vistos = 0
        while True:
            t = await cola.leer(trabajo_id)
            if t is None:
                yield {"tipo": "error", "trabajo_id": trabajo_id, "detalle": "trabajo no encontrado", "reintentable": False}
                return
            for ev in _eventos(t, vistos):
                yield ev
            vistos = len(t["avisos"])
            if t["estado"] in TERMINADOS:
                return
            try:
                await asyncio.wait_for(cola_local.get(), timeout=latido_s)
            except TimeoutError:
                pass
    finally:
        await conexion.remove_listener("trabajos", al_notificar)
        await conexion.close()
