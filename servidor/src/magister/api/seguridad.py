"""La seguridad mínima de la API: token local, nada que venga de otra web y tamaño máximo del cuerpo.

Es un middleware ASGI puro (sin BaseHTTPMiddleware) para no tocar el flujo SSE.
No hay CORSMiddleware a propósito: con un solo origen no hace falta, y sin él el
navegador no deja a otras páginas leer las respuestas.
"""

import hmac
import json
import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from magister.config import ajustes

MAXIMO_CUERPO = 64 * 1024  # 64 KiB: sobra para un mensaje de chat.
# Un fichero subido (multipart) no es un mensaje: su tope de verdad lo pone la ruta (50 MiB en las fuentes); aquí solo
# se deja pasar, con holgura para los campos del formulario.
MAXIMO_SUBIDA = 51 * 1024 * 1024
RUTAS_LIBRES = {"/api/salud"}


async def _responder(send: Send, codigo: int, detalle: str) -> None:
    cuerpo = json.dumps({"detail": detalle}, ensure_ascii=False).encode()
    await send(
        {
            "type": "http.response.start",
            "status": codigo,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(cuerpo)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": cuerpo})


ORIGENES_ESCRITORIO = {"magister://app"}
EQUIPO_LOCAL = re.compile(r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")


def origen_propio(origen: str, host: str) -> bool:
    """La propia app: servida por la API, por Vite o Caddy en este equipo (cualquier puerto) o por el escritorio."""
    return (origen in ORIGENES_ESCRITORIO or bool(EQUIPO_LOCAL.match(origen))
            or (bool(host) and origen in (f"http://{host}", f"https://{host}")))


class Proteccion:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        ruta = scope["path"]
        cabeceras = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}

        metodo = scope.get("method", "GET")
        tipo = cabeceras.get("content-type", "")
        con_cuerpo = cabeceras.get("content-length", "0") not in ("", "0") or "transfer-encoding" in cabeceras
        if (ruta.startswith("/api/") and metodo in ("POST", "PUT", "PATCH") and con_cuerpo
                and not tipo.startswith("application/json") and not tipo.startswith("multipart/form-data")):
            await _responder(send, 415, "las rutas que escriben solo aceptan application/json")
            return

        if ajustes.token and ruta.startswith("/api/") and ruta not in RUTAS_LIBRES:
            recibido = cabeceras.get("x-magister-token", "")
            if not hmac.compare_digest(recibido.encode(), ajustes.token.encode()):
                await _responder(send, 401, "falta el token o no es válido")
                return

        # Sin token (uvicorn en el 127.0.0.1:8000 a pelo), otra web abierta en el navegador podría lanzar contra la API
        # un POST sin cuerpo o un GET que gasta modelo (un <img>). Con token no hace falta: esa web no puede ponerlo.
        if not ajustes.token and ruta.startswith("/api/") and ruta not in RUTAS_LIBRES:
            if cabeceras.get("sec-fetch-site") == "cross-site":
                await _responder(send, 403, "petición desde otra web: no se acepta")
                return
            origen = cabeceras.get("origin")
            if metodo in ("POST", "PUT", "PATCH", "DELETE") and origen is not None and not origen_propio(origen, cabeceras.get("host", "")):
                await _responder(send, 403, "petición desde otra web: no se acepta")
                return

        subida = tipo.startswith("multipart/form-data")
        maximo = MAXIMO_SUBIDA if subida else MAXIMO_CUERPO
        demasiado = "el fichero pasa del máximo de 50 MiB" if subida else "el cuerpo pasa del máximo de 64 KiB"
        longitud = cabeceras.get("content-length")
        if longitud is not None:
            if not longitud.isdigit() or int(longitud) > maximo:
                await _responder(send, 413, demasiado)
                return
            await self.app(scope, receive, send)
            return

        if "transfer-encoding" not in cabeceras:
            await self.app(scope, receive, send)
            return

        # Cuerpo troceado sin longitud: se lee hasta el máximo y se reenvía tal cual.
        mensajes: list[Message] = []
        leido = 0
        while True:
            mensaje = await receive()
            mensajes.append(mensaje)
            if mensaje["type"] != "http.request":
                break
            leido += len(mensaje.get("body", b""))
            if leido > maximo:
                await _responder(send, 413, demasiado)
                return
            if not mensaje.get("more_body", False):
                break

        async def repetir() -> Message:
            return mensajes.pop(0) if mensajes else await receive()

        await self.app(scope, repetir, send)
