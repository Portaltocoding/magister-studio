"""Prueba de contrato de Magister, independiente del proxy que haya delante.

Solo usa la biblioteca estándar, para lanzarse con cualquier Python 3:

    python contrato/probar.py http://localhost:8080
    python contrato/probar.py http://localhost:8080 --juntos

La primera debe salir en verde. La segunda pide los eventos de golpe y debe salir en
rojo: si no falla así, tampoco fallará cuando un proxy acumule la respuesta.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

EVENTOS = 5
SEPARACION_MINIMA_S = 1.0


def probar_salud(base: str) -> list[str]:
    try:
        r = urllib.request.urlopen(f"{base}/api/salud", timeout=10)
    except urllib.error.HTTPError as error:
        return [f"código {error.code}, se esperaba 200"]
    with r:
        crudo = r.read()
        fallos = []
        try:
            cuerpo = json.loads(crudo)
        except ValueError:
            fallos.append(f"el cuerpo no es JSON (empieza por {crudo[:40]!r}): ¿hay proxy delante?")
            cuerpo = {}
        if isinstance(cuerpo, dict) and cuerpo and cuerpo.get("ok") is not True:
            fallos.append(f"el cuerpo no trae ok: true ({cuerpo})")
        for cabecera in ("X-Magister-Version", "X-Request-Id"):
            if not r.headers.get(cabecera):
                fallos.append(f"falta la cabecera {cabecera}")
    return fallos


def probar_pulso(base: str, juntos: bool) -> tuple[list[str], list[float]]:
    url = f"{base}/api/pulso?n={EVENTOS}" + ("&juntos=1" if juntos else "")
    llegadas = []
    try:
        r = urllib.request.urlopen(url, timeout=30)
    except urllib.error.HTTPError as error:
        return [f"código {error.code}, se esperaba 200"], llegadas
    with r:
        inicio = time.monotonic()
        for linea in r:  # línea a línea, según llegan
            if linea.startswith(b"event: pulso"):
                llegadas.append(time.monotonic() - inicio)

    fallos = []
    if len(llegadas) != EVENTOS:
        fallos.append(f"llegaron {len(llegadas)} eventos pulso, se esperaban {EVENTOS}")
    elif llegadas[-1] - llegadas[0] < SEPARACION_MINIMA_S:
        fallos.append(
            f"los {EVENTOS} eventos llegaron en {llegadas[-1] - llegadas[0]:.2f} s, "
            f"menos de {SEPARACION_MINIMA_S:.0f} s: la respuesta se está acumulando"
        )
    return fallos, llegadas


def informar(nombre: str, fallos: list[str], detalle: str = "") -> bool:
    if fallos:
        print(f"ROJO   {nombre}")
        for fallo in fallos:
            print(f"       - {fallo}")
    else:
        print(f"VERDE  {nombre}{detalle}")
    return not fallos


def main() -> int:
    analizador = argparse.ArgumentParser(description="Prueba de contrato de Magister.")
    analizador.add_argument("entrada", help="dirección de entrada, por ejemplo http://localhost:8080")
    analizador.add_argument("--juntos", action="store_true", help="pide los eventos de golpe; debe fallar")
    args = analizador.parse_args()
    base = args.entrada.rstrip("/")

    try:
        bien = informar("salud: 200, ok y cabeceras del sobre", probar_salud(base))
        fallos, llegadas = probar_pulso(base, args.juntos)
    except OSError as error:
        print(f"ROJO   no se puede conectar con {base}: {error}")
        return 1

    tiempos = ", ".join(f"{t:.2f}" for t in llegadas)
    huecos = [b - a for a, b in zip(llegadas, llegadas[1:])]
    media = f"; entre eventos {sum(huecos) / len(huecos):.2f} s de media" if huecos else ""
    nombre = "pulso: eventos de uno en uno" + (" (con --juntos, debe salir en rojo)" if args.juntos else "")
    bien = informar(nombre, fallos, f" (llegadas: {tiempos} s{media})") and bien
    if fallos and llegadas:
        print(f"       llegadas: {tiempos} s")
    return 0 if bien else 1


if __name__ == "__main__":
    sys.exit(main())
