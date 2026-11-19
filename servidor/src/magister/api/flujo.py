"""El flujo SSE del tutor: inicio, fases, deltas, plan y fin o error, con guardado blindado.

Recibe eventos ya normalizados ({"tipo": "delta" | "fase" | "plan", ...}) y los pasa a
SSE. El texto de los delta se acumula y se guarda como respuesta del tutor al final,
aunque el cliente se vaya a medias.
"""

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable

import anyio
from fastapi.sse import ServerSentEvent

from magister.cerebro.modelo import ErrorModelo, traza_actual
from magister.config import ajustes
from magister.seguridad.salida import CanarioDetectado, FiltroSalida

Guardar = Callable[[str, str, int | None, int, dict], Awaitable[int | None]]
CORTADO = "He dejado esta respuesta a medias: ha llegado otra pregunta."


class TurnoCortado(Exception):
    """Ha llegado otro turno en la misma conversación y este se ha cortado."""


_FIN = object()


class Turno:
    """Un turno del chat cuyos eventos (el grafo, con su claude) se leen en una tarea propia, para poder cortarlo de
    verdad desde otra petición: `cortar()` cancela esa tarea y, con ella, el grafo y el proceso claude (cerebro/modelo.py
    lo mata al cerrarse); el flujo lo guarda como «interrumpido». Si te vas a medias (cierras la pestaña, pulsas Parar),
    la tarea se cancela igual. `hecho` se enciende cuando el turno ha acabado del todo (con su respuesta guardada)."""

    ESPERA_S = 10  # lo que puede tardar en morir claude y cerrarse el grafo

    def __init__(self) -> None:
        self.hecho = asyncio.Event()
        self.cortado = False
        self._tarea: asyncio.Task | None = None
        self._cola: asyncio.Queue = asyncio.Queue()

    def cortar(self) -> None:
        self.cortado = True
        if self._tarea is not None:
            self._tarea.cancel()
        self._cola.put_nowait(_FIN)

    async def eventos(self, origen: AsyncIterator[dict]) -> AsyncIterator[dict]:
        completo = False

        async def leer() -> None:
            nonlocal completo
            try:
                async for ev in origen:
                    self._cola.put_nowait(ev)
                completo = True
            except Exception as e:  # noqa: BLE001  (sale por el flujo, igual que si no hubiera tarea)
                self._cola.put_nowait(e)
            finally:
                self._cola.put_nowait(_FIN)

        self._tarea = asyncio.create_task(leer())
        if self.cortado:
            self._tarea.cancel()
        try:
            while (x := await self._cola.get()) is not _FIN:
                if isinstance(x, Exception):
                    raise x
                yield x
        finally:
            self._tarea.cancel()
            with anyio.move_on_after(self.ESPERA_S, shield=True):
                await asyncio.wait({self._tarea})
        if self.cortado and not completo:
            raise TurnoCortado


async def flujo_tutor(
    eventos: AsyncIterator[dict],
    guardar: Guardar,
    inicio: dict,
) -> AsyncIterator[ServerSentEvent]:
    """`guardar(texto, estado, ms_primer_token, ms_total, extra)` devuelve el id guardado (o None).

    `extra` lleva las citas y la traza de búsqueda, que viajan en el evento `fin`."""
    t0 = time.perf_counter()
    ms_primer: int | None = None
    texto: list[str] = []
    estado = "interrumpido"
    cortado = False
    detalle_error: str | None = None
    mensaje_id: int | None = None
    extra: dict = {}
    filtro = FiltroSalida(canario=ajustes.canario)
    yield ServerSentEvent(data=inicio, event="inicio")
    try:
        try:
            async for ev in eventos:
                tipo = ev.get("tipo")
                if tipo == "delta":
                    if ms_primer is None:
                        ms_primer = int((time.perf_counter() - t0) * 1000)
                    seguro = filtro.trozo(ev["t"])
                    if seguro:
                        texto.append(seguro)
                        yield ServerSentEvent(data={"t": seguro}, event="delta")
                elif tipo == "citas":
                    extra = {k: v for k, v in ev.items() if k != "tipo"}
                else:
                    datos = {k: v for k, v in ev.items() if k != "tipo"}
                    yield ServerSentEvent(data=datos, event=str(tipo))
            resto = filtro.final()
            if resto:
                texto.append(resto)
                yield ServerSentEvent(data={"t": resto}, event="delta")
            estado = "completo"
        except CanarioDetectado:
            estado = "error"
            detalle_error = "he cortado la respuesta: contenía algo que no debía salir"
        except ErrorModelo as e:
            estado = "error"
            detalle_error = str(e)
        except TurnoCortado:
            cortado = True  # se guarda como «interrumpido», igual que si te hubieras ido
            try:
                if resto := filtro.final():  # lo que el filtro retenía también es parte de lo que llevaba
                    texto.append(resto)
            except CanarioDetectado:
                estado = "error"
                detalle_error = "he cortado la respuesta: contenía algo que no debía salir"
    finally:
        ms_total = int((time.perf_counter() - t0) * 1000)
        contenido = "".join(texto)
        if estado == "error" and not contenido:
            contenido = f"[error] {detalle_error}"
        # Un corte antes de la primera palabra (le interrumpes en una llamada) no deja un mensaje vacío en el hilo.
        if contenido or estado == "error":
            with anyio.CancelScope(shield=True):
                mensaje_id = await guardar(contenido, estado, ms_primer, ms_total, extra)
    if cortado:
        yield ServerSentEvent(data={"mensaje_id": mensaje_id, "detalle": CORTADO}, event="cortado")
    elif estado == "error":
        yield ServerSentEvent(data={"detalle": detalle_error}, event="error")
    else:
        fin = {"mensaje_id": mensaje_id, "ms_primer_token": ms_primer, "ms_total": ms_total, "traza_id": traza_actual.get()}
        if filtro.retirados:
            fin["retirado"] = filtro.retirados
        if "citas" in extra:
            fin.update(citas=extra["citas"], busqueda_id=extra.get("busqueda_id"), sin_fuentes=extra.get("sin_fuentes"))
        yield ServerSentEvent(data=fin, event="fin")
