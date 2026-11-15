"""La seguridad mínima de la API: token local y tamaño máximo del cuerpo.

Es un middleware ASGI puro (sin BaseHTTPMiddleware) para no tocar el flujo SSE.
No hay CORSMiddleware a propósito: con un solo origen no hace falta, y sin él el
navegador no deja a otras páginas leer las respuestas.
"""

import hmac
import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from magister.config import ajustes

MAXIMO_CUERPO = 64 * 1024  # 64 KiB: sobra para un mensaje de chat.
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


class Proteccion:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        ruta = scope["path"]
        cabeceras = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}

        if ajustes.token and ruta.startswith("/api/") and ruta not in RUTAS_LIBRES:
            recibido = cabeceras.get("x-magister-token", "")
            if not hmac.compare_digest(recibido.encode(), ajustes.token.encode()):
                await _responder(send, 401, "falta el token o no es válido")
                return

        longitud = cabeceras.get("content-length")
        if longitud is not None:
            if not longitud.isdigit() or int(longitud) > MAXIMO_CUERPO:
                await _responder(send, 413, "el cuerpo pasa del máximo de 64 KiB")
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
            if leido > MAXIMO_CUERPO:
                await _responder(send, 413, "el cuerpo pasa del máximo de 64 KiB")
                return
            if not mensaje.get("more_body", False):
                break

        async def repetir() -> Message:
            return mensajes.pop(0) if mensajes else await receive()

        await self.app(scope, repetir, send)
