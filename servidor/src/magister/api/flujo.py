"""El flujo SSE del tutor: inicio, deltas y fin o error, con guardado blindado.

Lo usan la ruta de mensajes (v0.1) y, después, las sesiones de tutor (v0.5).
"""

import time
from collections.abc import AsyncIterator, Awaitable, Callable

import anyio
from fastapi.sse import ServerSentEvent

from magister.cerebro.modelo import ErrorModelo

Guardar = Callable[[str, str, int | None, int], Awaitable[int | None]]


async def flujo_tutor(
    trozos: AsyncIterator[str],
    guardar: Guardar,
    inicio: dict,
) -> AsyncIterator[ServerSentEvent]:
    """`guardar(texto, estado, ms_primer_token, ms_total)` devuelve el id guardado."""
    t0 = time.perf_counter()
    ms_primer: int | None = None
    texto: list[str] = []
    estado = "interrumpido"
    detalle_error: str | None = None
    mensaje_id: int | None = None
    yield ServerSentEvent(data=inicio, event="inicio")
    try:
        try:
            async for t in trozos:
                if ms_primer is None:
                    ms_primer = int((time.perf_counter() - t0) * 1000)
                texto.append(t)
                yield ServerSentEvent(data={"t": t}, event="delta")
            estado = "completo"
        except ErrorModelo as e:
            estado = "error"
            detalle_error = str(e)
    finally:
        ms_total = int((time.perf_counter() - t0) * 1000)
        contenido = "".join(texto)
        if estado == "error" and not contenido:
            contenido = f"[error] {detalle_error}"
        with anyio.CancelScope(shield=True):
            mensaje_id = await guardar(contenido, estado, ms_primer, ms_total)
    if estado == "error":
        yield ServerSentEvent(data={"detalle": detalle_error}, event="error")
    else:
        yield ServerSentEvent(
            data={"mensaje_id": mensaje_id, "ms_primer_token": ms_primer, "ms_total": ms_total}, event="fin"
        )
