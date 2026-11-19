"""El trabajador: coge trabajos de la cola y los ejecuta.

    uv run magister-trabajador          proceso aparte
    (o dentro de la API con MAGISTER_TRABAJOS_EN_API=true, el valor por defecto)

Corre MAGISTER_TRABAJOS_A_LA_VEZ trabajos a la vez (2 por defecto): un research o un MP4 largo ya no deja en espera
los apuntes y las diapositivas de lo demás.

Errores transitorios (el modelo, la red, un plazo): espera exponencial (2 s, factor 2,
con jitter) hasta 5 intentos. Permanentes (la lección no existe): `fallido` sin reintento.
Una salida estructurada que no sale bien falla al segundo intento, y lo frenado por el freno
de llamadas no se reintenta: reintentar dentro de la pausa solo quema intentos.
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
INTENTOS_ESTRUCTURA = 2
MENSAJE_ESTRUCTURA = ("No he conseguido un resultado válido tras varios intentos. Vuelve a pedirlo; "
                      "si se repite, cambia algo de lo que pides.")
MENSAJE_FRENO = "Hay demasiadas llamadas al modelo seguidas y están en pausa unos minutos. Vuelve a pedirlo luego."


def frenado(e: Exception) -> bool:
    """El freno llega como ErrorModelo («freno: ...») o, dentro de estructurar, como el último error de un ErrorEstructura."""
    texto = str(e)
    return (isinstance(e, ErrorModelo) and texto.startswith("freno:")) or (
        isinstance(e, ErrorEstructura) and "error del modelo: freno:" in texto)


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
        elif t.tipo == "video_mp4":
            from magister.trabajos.video import ejecutar as ejecutar_video

            await ejecutar_video(t.id, t.parametros)
        elif t.tipo == "repintar":
            from magister.trabajos.material import repintar

            await repintar(t.id, t.parametros)
        elif t.tipo == "incorporar":
            from magister.trabajos.incorporar import ejecutar as ejecutar_incorporar

            await ejecutar_incorporar(t.id, t.parametros)
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
        if frenado(e):
            registro.warning("trabajo %s frenado: %s", t.id, e)
            await cola.terminar(t.id, "fallido", MENSAJE_FRENO)
        elif isinstance(e, ErrorEstructura) and t.intentos >= INTENTOS_ESTRUCTURA:
            registro.warning("trabajo %s: sin salida válida tras %s intentos: %s", t.id, t.intentos, e)
            await cola.terminar(t.id, "fallido", MENSAJE_ESTRUCTURA)
        elif t.intentos >= ajustes.trabajos_intentos:
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


async def bucle(pausa: float = 2.0, a_la_vez: int | None = None) -> None:
    """MAGISTER_TRABAJOS_A_LA_VEZ trabajadores en este proceso, cada uno con su nombre y su bucle. Que no cojan el
    mismo trabajo ni dos de la misma lección lo garantiza la reserva en la base (`cola.coger`), no este proceso: vale
    igual con otro `magister-trabajador` aparte. Cada tarea lleva su propio contexto (la traza del trabajo)."""
    n = max(1, a_la_vez or cola.a_la_vez())
    base = nombre()
    await asyncio.gather(*(_uno(base if n == 1 else f"{base}-{k}", pausa) for k in range(1, n + 1)))


async def _uno(quien: str, pausa: float) -> None:
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
