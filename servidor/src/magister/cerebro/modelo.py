"""La única puerta entre Magister y el modelo.

`generar` lanza `claude -p` como subproceso asíncrono y devuelve el texto trozo a
trozo. Con `MAGISTER_MOTOR=eco` no lanza nada: repite el último mensaje palabra a
palabra, para probar sin gastar cuota.
"""

import asyncio
import contextlib
import contextvars
import inspect
import json
import logging
import random
import shutil
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

from magister.config import ajustes

LIMITE_LINEA = 1024 * 1024  # 1 MiB: las líneas de stream-json pueden ser largas.


@dataclass
class Turno:
    rol: Literal["usuario", "tutor"]
    contenido: str


class ErrorModelo(Exception):
    pass


def componer_entrada(historial: list[Turno]) -> str:
    """Los turnos previos van dentro de <conversacion_previa>; el último, al final."""
    if not historial:
        raise ErrorModelo("historial vacío")
    *previos, ultimo = historial
    partes: list[str] = []
    if previos:
        lineas = [f"{'Alumno' if t.rol == 'usuario' else 'Tutor'}: {t.contenido}" for t in previos]
        partes.append("<conversacion_previa>\n" + "\n\n".join(lineas) + "\n</conversacion_previa>\n")
    partes.append(ultimo.contenido)
    return "\n".join(partes)


async def _eco(historial: list[Turno]) -> AsyncIterator[str]:
    texto = "Eco: " + historial[-1].contenido
    for palabra in texto.split(" "):
        await asyncio.sleep(0.05)
        yield palabra + " "


def argumentos_claude(sistema: str, esquema: dict | None = None, modelo: str | None = None) -> list[str]:
    ruta = shutil.which("claude")
    if not ruta:
        raise ErrorModelo("no encuentro el programa claude en el PATH")
    args = [
        ruta,
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--model",
        modelo or ajustes.modelo,
        "--system-prompt",
        sistema,
    ]
    if esquema is not None:
        args += ["--json-schema", json.dumps(esquema, ensure_ascii=False)]
    return args


async def _lineas_claude(
    sistema: str, entrada: str, esquema: dict | None = None, modelo: str | None = None
) -> AsyncIterator[dict]:
    """Lanza claude -p y entrega cada línea JSON. Valida el final (result, código)."""
    proc = await asyncio.create_subprocess_exec(
        *argumentos_claude(sistema, esquema, modelo),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        limit=LIMITE_LINEA,
    )
    trozos_err: list[bytes] = []

    async def leer_stderr() -> None:
        assert proc.stderr is not None
        while bloque := await proc.stderr.read(4096):
            trozos_err.append(bloque)

    tarea_err = asyncio.create_task(leer_stderr())
    final_err = lambda: b"".join(trozos_err).decode("utf-8", "replace")[-800:].strip()  # noqa: E731
    try:
        async with asyncio.timeout(ajustes.timeout_s):
            assert proc.stdin is not None and proc.stdout is not None
            proc.stdin.write(entrada.encode("utf-8"))
            await proc.stdin.drain()
            proc.stdin.close()
            resultado: dict | None = None
            async for crudo in proc.stdout:
                linea = crudo.decode("utf-8", "replace").strip()
                if not linea:
                    continue
                try:
                    evento = json.loads(linea)
                except json.JSONDecodeError:
                    continue
                if evento.get("type") == "result":
                    resultado = evento
                    if evento.get("is_error"):
                        raise ErrorModelo(str(evento.get("result") or evento.get("subtype") or "error del modelo"))
                yield evento
            codigo = await proc.wait()
            await tarea_err
            if codigo != 0:
                raise ErrorModelo(f"claude salió con código {codigo}: {final_err()}")
            if resultado is None:
                raise ErrorModelo(f"claude terminó sin resultado: {final_err()}")
    except TimeoutError:
        raise ErrorModelo("plazo agotado") from None
    finally:
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await proc.wait()
        if not tarea_err.done():
            tarea_err.cancel()




# Observación (Parte VI): el cerebro no importa `observar`; ofrece ganchos y contexto.

traza_actual: contextvars.ContextVar[str | None] = contextvars.ContextVar("traza_actual", default=None)
prompt_actual: contextvars.ContextVar[tuple[str, str] | None] = contextvars.ContextVar("prompt_actual", default=None)


@dataclass
class Llamada:
    funcion: str
    motor: str
    modelo_pedido: str
    modelo_respondido: str | None = None
    sistema: str = ""
    entrada: str = ""
    respuesta: str = ""
    tokens_entrada: int = 0
    tokens_salida: int = 0
    tokens_cache_lectura: int = 0
    tokens_cache_escritura: int = 0
    coste_equivalente: float = 0.0
    ttft_ms: int | None = None
    total_ms: int = 0
    reintentos: int = 0
    respaldo: bool = False
    error: str | None = None
    prompt_nombre: str | None = None
    prompt_version: str | None = None
    traza_id: str | None = None
    estructurada: bool = False


Observador = Callable[[Llamada], Awaitable[None] | None]
_observadores: list[Observador] = []


def registrar_observador(fn: Observador) -> None:
    if fn not in _observadores:
        _observadores.append(fn)


def quitar_observadores() -> None:
    _observadores.clear()


async def notificar(llamada: Llamada) -> None:
    """La instrumentación nunca rompe una petición."""
    for fn in list(_observadores):
        try:
            r = fn(llamada)
            if inspect.isawaitable(r):
                await r
        except Exception:  # noqa: BLE001
            logging.getLogger("magister.cerebro").exception("observador")


def llenar_desde_resultado(llamada: Llamada, resultado: dict) -> None:
    uso = resultado.get("usage") or {}
    llamada.tokens_entrada = int(uso.get("input_tokens") or 0)
    llamada.tokens_salida = int(uso.get("output_tokens") or 0)
    llamada.tokens_cache_lectura = int(uso.get("cache_read_input_tokens") or 0)
    llamada.tokens_cache_escritura = int(uso.get("cache_creation_input_tokens") or 0)
    llamada.coste_equivalente = float(resultado.get("total_cost_usd") or 0.0)
    modelos = list((resultado.get("modelUsage") or {}).keys())
    llamada.modelo_respondido = modelos[0] if modelos else None


# Resiliencia: reintentos antes del primer trozo y un cortacircuitos por motor.

FALLOS_PARA_ABRIR = 5
SEGUNDOS_ABIERTO = 60


@dataclass
class Cortacircuitos:
    fallos: int = 0
    abierto_hasta: float = 0.0

    def permitido(self) -> bool:
        return time.monotonic() >= self.abierto_hasta

    def exito(self) -> None:
        self.fallos = 0

    def fallo(self) -> None:
        self.fallos += 1
        if self.fallos >= FALLOS_PARA_ABRIR:
            self.abierto_hasta = time.monotonic() + SEGUNDOS_ABIERTO
            self.fallos = 0


cortacircuitos: dict[str, Cortacircuitos] = {}


def transitorio(e: ErrorModelo) -> bool:
    texto = str(e).lower()
    return any(x in texto for x in ("plazo", "overloaded", "rate", "529", "500", "502", "503", "timeout", "conexión", "connection"))


async def _claude_texto(sistema: str, historial: list[Turno], modelo: str, llamada: Llamada) -> AsyncIterator[str]:
    resultado: dict = {}
    entrada = componer_entrada(historial)
    llamada.entrada = entrada
    primero = True
    lineas = _lineas_claude(sistema, entrada, None, modelo)
    try:
        while True:
            try:
                plazo = ajustes.plazo_primer_token_s if primero else ajustes.timeout_s
                evento = await asyncio.wait_for(lineas.__anext__(), timeout=plazo)
            except StopAsyncIteration:
                break
            except TimeoutError:
                raise ErrorModelo("plazo agotado esperando el primer trozo" if primero else "plazo agotado") from None
            if evento.get("type") == "result":
                resultado = evento
                continue
            if evento.get("type") != "stream_event":
                continue
            delta = evento.get("event", {}).get("delta", {})
            if delta.get("type") == "text_delta" and delta.get("text"):
                primero = False
                yield delta["text"]
    finally:
        await lineas.aclose()
        llenar_desde_resultado(llamada, resultado)


async def generar(sistema: str, historial: list[Turno], tarea: str | None = None) -> AsyncIterator[str]:
    """Trozos de texto de la respuesta, tal cual llegan, sin añadir nada.

    Reintenta (espera exponencial con jitter completo, base 1 s, tope 8 s, máximo 2) solo si
    falla antes del primer trozo y el fallo es transitorio; después de empezar a hablar no se
    reintenta, porque el texto ya salió."""
    if not historial:
        raise ErrorModelo("historial vacío")
    from magister.cerebro.enrutador import ruta

    p = prompt_actual.get()
    motor, modelo = ruta(tarea, p[0] if p else None)
    llamada = Llamada(funcion=tarea or (p[0] if p else "conversar"), motor=motor, modelo_pedido=modelo, sistema=sistema,
                      prompt_nombre=p[0] if p else None, prompt_version=p[1] if p else None, traza_id=traza_actual.get())
    t0 = time.perf_counter()
    partes: list[str] = []
    try:
        if motor == "eco":
            async for t in _eco(historial):
                if llamada.ttft_ms is None:
                    llamada.ttft_ms = int((time.perf_counter() - t0) * 1000)
                partes.append(t)
                yield t
            return
        breaker = cortacircuitos.setdefault(motor, Cortacircuitos())
        for intento in range(3):
            if not breaker.permitido():
                raise ErrorModelo(f"el motor {motor} está en pausa tras varios fallos seguidos; vuelve a probar en un minuto")
            try:
                async for t in _claude_texto(sistema, historial, modelo, llamada):
                    if llamada.ttft_ms is None:
                        llamada.ttft_ms = int((time.perf_counter() - t0) * 1000)
                    partes.append(t)
                    yield t
                breaker.exito()
                return
            except ErrorModelo as e:
                breaker.fallo()
                if partes or intento == 2 or not transitorio(e):
                    raise
                llamada.reintentos += 1
                await asyncio.sleep(random.uniform(0, min(8.0, 1.0 * 2**intento)))
    except ErrorModelo as e:
        llamada.error = str(e)
        raise
    finally:
        llamada.respuesta = "".join(partes)
        llamada.total_ms = int((time.perf_counter() - t0) * 1000)
        with contextlib.suppress(Exception):
            await notificar(llamada)
