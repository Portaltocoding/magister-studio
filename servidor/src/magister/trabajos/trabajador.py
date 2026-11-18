"""El trabajador: coge trabajos de la cola y los ejecuta.

    uv run magister-trabajador          proceso aparte
    (o dentro de la API con MAGISTER_TRABAJOS_EN_API=true, el valor por defecto)

Errores transitorios (el modelo, la red, un plazo): espera exponencial (2 s, factor 2,
con jitter) hasta 5 intentos. Permanentes (la lección no existe): `fallido` sin reintento.
"""

import asyncio
import logging
import os
import random
import socket
import sys

from magister.cerebro.estructura import ErrorEstructura
from magister.cerebro.modelo import ErrorModelo
from magister.config import ajustes
from magister.material.entrada import LeccionNoExiste
from magister.material.generador import Cancelado
from magister.trabajos import cola

registro = logging.getLogger("magister.trabajador")
TRANSITORIOS = (ErrorModelo, ErrorEstructura, TimeoutError, ConnectionError, OSError)
LATIDO_S = 30


def nombre() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"


async def ejecutar_uno(quien: str) -> bool:
    """Coge y ejecuta un trabajo. Devuelve False si no había ninguno."""
    from magister.trabajos.material import ejecutar

    t = await cola.coger(quien)
    if t is None:
        return False
    vivo = True

    async def latir() -> None:
        while vivo:
            await cola.latido(quien, t.id)
            await asyncio.sleep(LATIDO_S)

    latidos = asyncio.create_task(latir())
    try:
        from magister.cerebro.modelo import traza_actual

        traza_actual.set(t.traza_id or f"trabajo-{t.id}")
        if t.tipo == "juez_online":
            from magister.observar.juez_online import juzgar

            await juzgar(t.parametros)
        elif t.tipo == "material":
            await ejecutar(t.id, t.plan_id, t.leccion_clave, t.parametros.get("tipos", ["apuntes"]),
                           t.parametros.get("preferencias"))
        elif t.tipo in ("proyecto_roadmap", "proyecto_nivel"):
            from magister.proyectos.trabajo import ejecutar as ejecutar_proyecto

            await ejecutar_proyecto(t.id, t.tipo, t.parametros)
        else:
            await cola.terminar(t.id, "fallido", f"tipo de trabajo desconocido: {t.tipo}")
            return True
        if not await cola.cancelado(t.id):
            await cola.terminar(t.id, "hecho")
    except Cancelado:
        registro.info("trabajo %s cancelado", t.id)
    except (LeccionNoExiste, LookupError) as e:
        await cola.terminar(t.id, "fallido", str(e))
    except TRANSITORIOS as e:
        if t.intentos >= ajustes.trabajos_intentos:
            await cola.terminar(t.id, "fallido", f"tras {t.intentos} intentos: {e}")
        else:
            espera = 2 * 2 ** (t.intentos - 1) * (0.5 + random.random())
            registro.warning("trabajo %s: %s; reintento en %.0f s", t.id, e, espera)
            await cola.reintentar_luego(t.id, espera, str(e))
    except Exception as e:  # noqa: BLE001 un error de programación no se reintenta
        registro.exception("trabajo %s", t.id)
        await cola.terminar(t.id, "fallido", f"{type(e).__name__}: {e}")
    finally:
        vivo = False
        latidos.cancel()
    return True


async def bucle(pausa: float = 2.0) -> None:
    quien = nombre()
    registro.info("trabajador %s en marcha", quien)
    while True:
        try:
            await cola.latido(quien, None)
            if not await ejecutar_uno(quien):
                await asyncio.sleep(pausa)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            registro.exception("fallo en el bucle del trabajador")
            await asyncio.sleep(pausa * 5)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    try:
        asyncio.run(bucle())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
