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
import tempfile
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
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


# Windows no acepta líneas de órdenes de más de 32.767 caracteres: un prompt de sistema largo (apuntes de 20.000
# caracteres más un esquema grande) va en un fichero temporal, con --system-prompt-file.
SISTEMA_EN_FICHERO = 8000
TOPE_VECES = 3  # una llamada que no para de mandar señales se corta, como mucho, a 3 veces el plazo


def argumentos_claude(sistema: str, esquema: dict | None = None, modelo: str | None = None,
                      fichero_sistema: str | None = None) -> list[str]:
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
    ]
    args += ["--system-prompt-file", fichero_sistema] if fichero_sistema else ["--system-prompt", sistema]
    if esquema is not None:
        args += ["--json-schema", json.dumps(esquema, ensure_ascii=False)]
    return args


# Cada claude -p es un proceso de unos 390 MB que tarda unos 6 s (medido el 18-11-2026). Lo de segundo plano (generar
# material, jueces) espera turno para no tumbar el equipo en un pico; lo tuyo en directo (chat, asesor, llamada) nunca.
TAREAS_DE_FONDO = frozenset({"generar", "juez"})
_turnos: dict[int, asyncio.Semaphore] = {}


def _turno_de_fondo() -> asyncio.Semaphore | None:
    from magister.cerebro.enrutador import tarea_de_prompt

    p = prompt_actual.get()
    if tarea_de_prompt(p[0] if p else None) not in TAREAS_DE_FONDO:
        return None
    # Un semáforo por bucle de eventos (las pruebas abren uno por prueba).
    return _turnos.setdefault(id(asyncio.get_running_loop()), asyncio.Semaphore(max(1, ajustes.modelo_fondo_a_la_vez)))


async def _lineas_claude(
    sistema: str, entrada: str, esquema: dict | None = None, modelo: str | None = None
) -> AsyncIterator[dict]:
    """Como `_lanzar_claude`, pero lo de segundo plano espera su turno (TAREAS_DE_FONDO)."""
    turno = _turno_de_fondo()
    async with turno if turno is not None else contextlib.nullcontext():
        async with contextlib.aclosing(_lanzar_claude(sistema, entrada, esquema, modelo)) as lineas:
            async for evento in lineas:
                yield evento


async def _lanzar_claude(
    sistema: str, entrada: str, esquema: dict | None = None, modelo: str | None = None
) -> AsyncIterator[dict]:
    """Lanza claude -p y entrega cada línea JSON. Valida el final (result, código)."""
    fichero = await asyncio.to_thread(_escribir_sistema, sistema) if len(sistema) > SISTEMA_EN_FICHERO else None
    try:
        async with contextlib.aclosing(_proceso_claude(argumentos_claude(sistema, esquema, modelo, fichero), entrada)) as lineas:
            async for evento in lineas:
                yield evento
    finally:
        if fichero:
            await asyncio.to_thread(Path(fichero).unlink, True)


def _escribir_sistema(sistema: str) -> str:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", prefix="magister-sistema-", delete=False) as f:
        f.write(sistema)
        return f.name


async def _proceso_claude(args: list[str], entrada: str) -> AsyncIterator[dict]:
    proc = await asyncio.create_subprocess_exec(
        *args,
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
        # El plazo cuenta sin noticias del modelo (MAGISTER_TIMEOUT_S), no en total: una pregunta difícil razona un minuto
        # o más antes de escribir (medido: 75 s de razonamiento y 111 s en total) y no se corta mientras avanza. Con un
        # tope absoluto, por si nunca acaba.
        bucle = asyncio.get_running_loop()
        tope = bucle.time() + ajustes.timeout_s * TOPE_VECES
        async with asyncio.timeout(ajustes.timeout_s) as plazo:
            assert proc.stdin is not None and proc.stdout is not None
            proc.stdin.write(entrada.encode("utf-8"))
            await proc.stdin.drain()
            proc.stdin.close()
            resultado: dict | None = None
            limites: dict | None = None
            async for crudo in proc.stdout:
                plazo.reschedule(min(tope, bucle.time() + ajustes.timeout_s))
                linea = crudo.decode("utf-8", "replace").strip()
                if not linea:
                    continue
                try:
                    evento = json.loads(linea)
                except json.JSONDecodeError:
                    continue
                # Cuánta cuota de la suscripción queda (ventana de 5 h y de 7 días): llega antes del resultado y viaja con él.
                if evento.get("type") == "rate_limit_event":
                    limites = (evento.get("rate_limit_info") or {}).get("unifiedWindows") or limites
                if evento.get("type") == "result":
                    if limites:
                        evento["_limites"] = limites
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
    # La cuota de la suscripción tras esta llamada, tal como la da el CLI: {"five_hour": {"utilization": 0.41, "resetsAt": ...},
    # "seven_day": {...}}. None si el motor no la da (eco) o no llegó.
    limites: dict | None = None


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
    llamada.limites = resultado.get("_limites")


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
