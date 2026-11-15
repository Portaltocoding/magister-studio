"""El flujo SSE del tutor: inicio, fases, deltas, plan y fin o error, con guardado blindado.

Recibe eventos ya normalizados ({"tipo": "delta" | "fase" | "plan", ...}) y los pasa a
SSE. El texto de los delta se acumula y se guarda como respuesta del tutor al final,
aunque el cliente se vaya a medias.
"""

import time
from collections.abc import AsyncIterator, Awaitable, Callable

import anyio
from fastapi.sse import ServerSentEvent

from magister.cerebro.modelo import ErrorModelo

Guardar = Callable[[str, str, int | None, int], Awaitable[int | None]]


async def flujo_tutor(
    eventos: AsyncIterator[dict],
    guardar: Guardar,
    inicio: dict,
) -> AsyncIterator[ServerSentEvent]:
    """`guardar(texto, estado, ms_primer_token, ms_total)` devuelve el id guardado (o None)."""
    t0 = time.perf_counter()
    ms_primer: int | None = None
    texto: list[str] = []
    estado = "interrumpido"
    detalle_error: str | None = None
    mensaje_id: int | None = None
    yield ServerSentEvent(data=inicio, event="inicio")
    try:
        try:
            async for ev in eventos:
                tipo = ev.get("tipo")
                if tipo == "delta":
                    if ms_primer is None:
                        ms_primer = int((time.perf_counter() - t0) * 1000)
                    texto.append(ev["t"])
                    yield ServerSentEvent(data={"t": ev["t"]}, event="delta")
                else:
                    datos = {k: v for k, v in ev.items() if k != "tipo"}
                    yield ServerSentEvent(data=datos, event=str(tipo))
            estado = "completo"
        except ErrorModelo as e:
            estado = "error"
            detalle_error = str(e)
    finally:
        ms_total = int((time.perf_counter() - t0) * 1000)
        contenido = "".join(texto)
        if estado == "error" and not contenido:
            contenido = f"[error] {detalle_error}"
        if contenido or estado != "completo":
            with anyio.CancelScope(shield=True):
                mensaje_id = await guardar(contenido, estado, ms_primer, ms_total)
    if estado == "error":
        yield ServerSentEvent(data={"detalle": detalle_error}, event="error")
    else:
        yield ServerSentEvent(
            data={"mensaje_id": mensaje_id, "ms_primer_token": ms_primer, "ms_total": ms_total}, event="fin"
        )
