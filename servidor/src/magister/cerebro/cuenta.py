"""La cuenta de Claude con la que se lanza `claude -p`: dónde está el token, si funciona y el alta desde la página.

El token puede venir de tres sitios, por este orden:
1. El fichero de `MAGISTER_CLAUDE_TOKEN_FICHERO` (permisos 600), que escribe el alta desde la página. Se lee en cada
   llamada: un token nuevo vale sin reiniciar la API y manda sobre el de la variable de entorno (que puede estar viejo).
2. La variable `CLAUDE_CODE_OAUTH_TOKEN` (en Docker, `entrada.sh` la saca del secreto de los arrancadores).
3. El inicio de sesión de `claude` en el equipo (el desarrollo en Windows usa el tuyo).

El token nunca sale de aquí por una ruta, un registro ni un mensaje de error. Solo importa de `magister.config`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

from magister.cerebro.token_claude import ErrorToken, SesionToken
from magister.config import ajustes

VARIABLE = "CLAUDE_CODE_OAUTH_TOKEN"
_FORMA = re.compile(r"^sk-ant-[A-Za-z0-9_\-]{20,}$")
ESPERA_ESTADO_S = 8.0  # `claude auth status` no llama al modelo: si tarda más, no hay respuesta
ESPERA_ALTA_S = 600.0  # una conexión a medias se abandona pasado este rato
ORDEN_ALTA = ("claude", "setup-token")  # las pruebas lo cambian por un claude falso

# Lo que dice claude cuando la cuenta no vale (token caducado, revocado o sin sesión). Sale en `result` o en stderr.
_CUENTA = re.compile(r"invalid api key|please run /login|oauth token|authentication[_ ](?:error|failed)|not logged in"
                     r"|invalid (?:bearer )?token|\b401\b|cuenta de claude no está conectada", re.IGNORECASE)
# El texto con el que sale el fallo de cuenta hacia las rutas y la página (web/src/componentes/errores.ts lo reconoce).
MENSAJE_CUENTA = "la cuenta de Claude no está conectada o ha caducado"

_caida = False  # el último intento con claude falló por la cuenta (en memoria: al reiniciar se vuelve a ver)


class ErrorCuenta(Exception):
    """El alta de la cuenta no ha salido; el mensaje se puede enseñar tal cual."""


def es_error_de_cuenta(texto: str) -> bool:
    return bool(_CUENTA.search(texto or ""))


def marcar_caida() -> None:
    global _caida
    _caida = True


def marcar_buena() -> None:
    global _caida
    _caida = False


def caida() -> bool:
    return _caida


# ===== El token en disco =====

def ruta_token() -> Path:
    return Path(ajustes.claude_token_fichero)


def token_valido(texto: str | None) -> str | None:
    limpio = "".join((texto or "").split())
    return limpio if _FORMA.match(limpio) else None


def leer_token() -> str | None:
    """El token guardado desde la página, o None. Bloqueante (un fichero minúsculo)."""
    try:
        return token_valido(ruta_token().read_text(encoding="utf-8"))
    except OSError:
        return None


def guardar_token(token: str) -> None:
    """Lo escribe entero o nada (fichero temporal y renombrado), con permisos 600. Bloqueante."""
    valido = token_valido(token)
    if not valido:
        raise ErrorCuenta("El código no ha dado un token válido.")
    destino = ruta_token()
    destino.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=destino.parent, prefix=".claude_token-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(valido)
        with contextlib.suppress(OSError):  # Windows no tiene permisos al estilo Unix
            os.chmod(tmp, 0o600)
        os.replace(tmp, destino)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def entorno_claude() -> dict[str, str] | None:
    """El entorno con el que lanzar claude: el de la API con el token del fichero, si lo hay. None = el de siempre."""
    token = leer_token()
    if not token:
        return None
    return {**os.environ, VARIABLE: token}


# ===== ¿Hay cuenta? =====

async def _sesion_de_claude() -> bool:
    """`claude auth status` (sin llamar al modelo): sale con 0 si hay sesión iniciada."""
    ruta = shutil.which("claude")
    if not ruta:
        return False
    try:
        proc = await asyncio.create_subprocess_exec(ruta, "auth", "status", stdin=asyncio.subprocess.DEVNULL,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    except OSError:
        return False
    try:
        salida, _ = await asyncio.wait_for(proc.communicate(), ESPERA_ESTADO_S)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        return False
    if proc.returncode != 0:
        return False
    with contextlib.suppress(ValueError):
        return bool(json.loads(salida.decode("utf-8", "replace")).get("loggedIn", True))
    return True


async def estado() -> dict:
    """{"conectada": bool, "origen": "fichero"|"entorno"|"sesion"|None, "caida": bool}. El comprobante más barato que
    sea fiable: un fichero o una variable (sin gastar nada), el fichero de credenciales de claude y, al final,
    `claude auth status`. Si la última llamada falló por la cuenta, la conexión no vale aunque el token exista."""
    if ajustes.motor == "eco":
        return {"conectada": True, "origen": None, "caida": False}
    origen: str | None = None
    if await asyncio.to_thread(leer_token):
        origen = "fichero"
    elif token_valido(os.environ.get(VARIABLE)):
        origen = "entorno"
    elif (Path.home() / ".claude" / ".credentials.json").is_file() or await _sesion_de_claude():
        origen = "sesion"
    return {"conectada": origen is not None and not _caida, "origen": origen, "caida": _caida}


# ===== El alta desde la página =====

class _Alta:
    def __init__(self) -> None:
        self.sesion: SesionToken | None = None
        self.desde = 0.0
        self.cerrojo = asyncio.Lock()


_alta = _Alta()


def _cerrar_alta() -> None:
    sesion, _alta.sesion = _alta.sesion, None
    if sesion is not None:
        sesion.cerrar()


async def iniciar_alta() -> str:
    """Lanza `claude setup-token` y devuelve el enlace de inicio de sesión. Una sola a la vez: pedir otra cierra la
    anterior (el «Probar otra vez»), salvo que una esté arrancando justo ahora."""
    if _alta.cerrojo.locked():
        raise ErrorCuenta("Ya estoy preparando la conexión. Espera unos segundos.")
    async with _alta.cerrojo:
        await asyncio.to_thread(_cerrar_alta)
        sesion = SesionToken(orden=ORDEN_ALTA)
        try:
            enlace = await asyncio.to_thread(sesion.arrancar)
        except ErrorToken:
            await asyncio.to_thread(sesion.cerrar)
            raise ErrorCuenta("No he conseguido el enlace de Claude. Pulsa «Probar otra vez».") from None
        except (ImportError, OSError):  # sin pty (Windows) o sin el programa
            await asyncio.to_thread(sesion.cerrar)
            raise ErrorCuenta("Conectar o cambiar la cuenta de Claude se hace desde la versión de Docker de Magister, "
                              "no desde este equipo.") from None
        _alta.sesion, _alta.desde = sesion, time.monotonic()
        return enlace


async def terminar_alta(codigo: str) -> None:
    """Le pasa a claude el código que enseña la página de Claude y guarda el token. La sesión se cierra siempre."""
    async with _alta.cerrojo:
        sesion, _alta.sesion = _alta.sesion, None
        if sesion is None or time.monotonic() - _alta.desde > ESPERA_ALTA_S:
            if sesion is not None:
                await asyncio.to_thread(sesion.cerrar)
            raise ErrorCuenta("La conexión ha caducado. Pulsa «Probar otra vez» para empezar de nuevo.")
        try:
            token = await asyncio.to_thread(sesion.enviar_codigo, codigo)
            await asyncio.to_thread(guardar_token, token)
        except ErrorToken:
            raise ErrorCuenta("Ese código no ha valido. Pulsa «Probar otra vez» y copia el código entero.") from None
        finally:
            await asyncio.to_thread(sesion.cerrar)
    marcar_buena()
