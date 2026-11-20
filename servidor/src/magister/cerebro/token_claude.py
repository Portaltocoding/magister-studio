"""Conducir `claude setup-token` desde código: sacar el enlace de inicio de sesión, pasarle el código y leer el token.

Lo usan el alta desde la propia página (cerebro/cuenta.py: el navegador pide la cuenta de Claude) y, como alternativa
por terminal, servidor/scripts/token_claude.py:

    with SesionToken() as sesion:
        enlace = sesion.arrancar()             # https://claude.ai/oauth/authorize?...  -> se enseña al usuario
        token = sesion.enviar_codigo(codigo)   # el código que la página de Claude le da -> "sk-ant-..."

Solo Linux y macOS (pty). Todo es bloqueante: desde código async, con asyncio.to_thread. claude corre en una
terminal virtual muy ancha para que ni el enlace ni el token se partan en varias líneas. No importa nada de magister.
"""

from __future__ import annotations

import os
import re
import select
import signal
import time
from collections.abc import Sequence

ANCHO = 1000
_ANSI = re.compile(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]")
# Solo un enlace ya terminado (le sigue un espacio o un salto de línea): un trozo a medio llegar no vale.
_ENLACE = re.compile(rb"https://[^\s\"'<>]*oauth[^\s\"'<>]*(?=\s)")
_TOKEN = re.compile(rb"sk-ant-[A-Za-z0-9_\-]{20,}")


class ErrorToken(Exception):
    """claude no ha dado el enlace o el token (se ha cerrado, ha tardado demasiado o el código no valía)."""


def limpiar(datos: bytes) -> bytes:
    """Quita los códigos de color y de cursor de la terminal."""
    return _ANSI.sub(b"", datos).replace(b"\r", b"\n")


def buscar_enlace(salida: bytes) -> str | None:
    """El enlace de inicio de sesión de la salida de claude, si ya ha salido entero."""
    hallado = _ENLACE.search(limpiar(salida))
    return hallado.group().decode() if hallado else None


def buscar_token(salida: bytes) -> str | None:
    """El último token sk-ant- de la salida de claude, si lo hay."""
    tokens = _TOKEN.findall(limpiar(salida))
    return tokens[-1].decode() if tokens else None


def abrir_pty(orden: Sequence[str], filas: int = 24, ancho: int = ANCHO) -> tuple[int, int]:
    """Lanza `orden` en una terminal virtual de `filas` x `ancho`. Devuelve (pid, descriptor del lado maestro)."""
    import fcntl
    import pty
    import struct
    import termios

    pid, fd = pty.fork()
    if pid == 0:
        try:
            fcntl.ioctl(1, termios.TIOCSWINSZ, struct.pack("HHHH", filas, ancho, 0, 0))
            os.execvp(orden[0], list(orden))
        finally:
            os._exit(127)
    return pid, fd


class SesionToken:
    """Una ejecución de `claude setup-token`, paso a paso: arrancar() da el enlace y enviar_codigo() el token."""

    def __init__(self, orden: Sequence[str] = ("claude", "setup-token"), filas: int = 24, ancho: int = ANCHO):
        self.orden = tuple(orden)
        self.filas = filas
        self.ancho = ancho
        self.salida = bytearray()  # todo lo que ha escrito claude, tal cual
        self._pid: int | None = None
        self._fd: int | None = None

    def __enter__(self) -> SesionToken:
        return self

    def __exit__(self, *_) -> None:
        self.cerrar()

    def _leer_hasta(self, buscar, espera_s: float) -> str:
        assert self._fd is not None
        limite = time.monotonic() + espera_s
        while True:
            hallado = buscar(bytes(self.salida))
            if hallado:
                return hallado
            queda = limite - time.monotonic()
            if queda <= 0:
                raise ErrorToken("claude tarda demasiado en responder")
            listos, _, _ = select.select([self._fd], [], [], queda)
            if not listos:
                continue
            try:
                datos = os.read(self._fd, 4096)
            except OSError:
                datos = b""
            if not datos:
                hallado = buscar(bytes(self.salida))
                if hallado:
                    return hallado
                raise ErrorToken("claude se ha cerrado antes de tiempo")
            self.salida += datos

    def arrancar(self, espera_s: float = 60.0) -> str:
        """Lanza claude y espera al enlace de inicio de sesión, que devuelve."""
        if self._pid is None:
            self._pid, self._fd = abrir_pty(self.orden, self.filas, self.ancho)
        return self._leer_hasta(buscar_enlace, espera_s)

    def enviar_codigo(self, codigo: str, espera_s: float = 120.0) -> str:
        """Le pasa a claude el código que da la página de Claude y devuelve el token sk-ant-."""
        if self._fd is None:
            raise ErrorToken("primero hay que llamar a arrancar()")
        limpio = "".join(codigo.split())
        if not limpio:
            raise ErrorToken("el código está vacío")
        os.write(self._fd, limpio.encode() + b"\r")
        return self._leer_hasta(buscar_token, espera_s)

    def cerrar(self) -> None:
        """Termina claude si sigue vivo y libera la terminal. Se puede llamar varias veces."""
        if self._pid is not None:
            try:
                os.kill(self._pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(self._pid, 0)
            except ChildProcessError:
                pass
            self._pid = None
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None
