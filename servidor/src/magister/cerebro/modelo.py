"""La única puerta entre Magister y el modelo.

`generar` lanza `claude -p` como subproceso asíncrono y devuelve el texto trozo a
trozo. Con `MAGISTER_MOTOR=eco` no lanza nada: repite el último mensaje palabra a
palabra, para probar sin gastar cuota.
"""

import asyncio
import contextlib
import json
import shutil
from collections.abc import AsyncIterator
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


def argumentos_claude(sistema: str, esquema: dict | None = None) -> list[str]:
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
        ajustes.modelo,
        "--system-prompt",
        sistema,
    ]
    if esquema is not None:
        args += ["--json-schema", json.dumps(esquema, ensure_ascii=False)]
    return args


async def _claude(sistema: str, historial: list[Turno]) -> AsyncIterator[str]:
    async for evento in _lineas_claude(sistema, componer_entrada(historial)):
        if evento.get("type") != "stream_event":
            continue
        delta = evento.get("event", {}).get("delta", {})
        if delta.get("type") == "text_delta" and delta.get("text"):
            yield delta["text"]


async def _lineas_claude(sistema: str, entrada: str, esquema: dict | None = None) -> AsyncIterator[dict]:
    """Lanza claude -p y entrega cada línea JSON. Valida el final (result, código)."""
    proc = await asyncio.create_subprocess_exec(
        *argumentos_claude(sistema, esquema),
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


async def generar(sistema: str, historial: list[Turno]) -> AsyncIterator[str]:
    """Trozos de texto de la respuesta, tal cual llegan, sin añadir nada."""
    if not historial:
        raise ErrorModelo("historial vacío")
    if ajustes.motor == "eco":
        async for t in _eco(historial):
            yield t
        return
    async for t in _claude(sistema, historial):
        yield t
