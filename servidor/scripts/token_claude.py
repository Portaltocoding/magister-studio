"""Saca el token de `claude setup-token` sin que haya que copiarlo a mano (modo terminal, para los arrancadores).

Lo lanzan magister.sh y Magister-docker.ps1 dentro de la imagen de la API:

    docker run --rm -it -v <secretos>:/salida --entrypoint python <imagen-api> /app/token_claude.py /salida

Ejecuta `claude setup-token` en una terminal virtual muy ancha y deja pasar lo que escribes y lo que sale. Cuando
aparece el enlace para iniciar sesión, lo escribe en `<salida>/.enlace` para que el arrancador lo abra en el
navegador del equipo. Al acabar, si ha salido un token `sk-ant-`, lo guarda en `<salida>/claude_token` y sale con 0;
si no, sale con 1 y el arrancador pide pegarlo a mano. No manda nada a ningún sitio.

La lógica (pty, enlace, token) está en magister.cerebro.token_claude, que también ofrece SesionToken para hacerlo
paso a paso desde código (el alta desde la página).
"""

import os
import select
import sys
import termios
import tty

from magister.cerebro.token_claude import abrir_pty, buscar_enlace, buscar_token


def guardar(ruta: str, valor: str) -> None:
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(valor)
    os.chmod(ruta, 0o644)  # la API lo lee con otro usuario


def main() -> int:
    salida = sys.argv[1] if len(sys.argv) > 1 else "/salida"
    try:
        filas = os.get_terminal_size(0).lines
    except OSError:
        filas = 24
    pid, fd = abrir_pty(["claude", "setup-token"], filas)

    visto = bytearray()
    enlace_guardado = False
    entradas = [fd, 0]
    modo_viejo = None
    try:
        modo_viejo = termios.tcgetattr(0)
        tty.setraw(0)
    except termios.error:
        pass
    try:
        while True:
            try:
                listos, _, _ = select.select(entradas, [], [])
            except InterruptedError:
                continue
            if fd in listos:
                try:
                    datos = os.read(fd, 4096)
                except OSError:
                    break
                if not datos:
                    break
                os.write(1, datos)
                visto += datos
                if not enlace_guardado:
                    enlace = buscar_enlace(bytes(visto))
                    if enlace:
                        guardar(os.path.join(salida, ".enlace"), enlace)
                        enlace_guardado = True
            if 0 in listos:
                datos = os.read(0, 1024)
                if datos:
                    os.write(fd, datos)
                else:
                    entradas.remove(0)
    finally:
        if modo_viejo is not None:
            termios.tcsetattr(0, termios.TCSAFLUSH, modo_viejo)
    os.waitpid(pid, 0)

    token = buscar_token(bytes(visto))
    if not token:
        return 1
    guardar(os.path.join(salida, "claude_token"), token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
