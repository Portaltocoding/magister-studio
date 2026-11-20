"""magister.cerebro.token_claude: sacar enlace y token de la salida de `claude setup-token`, sin llamar a claude."""

import sys

import pytest

from magister.cerebro.token_claude import ErrorToken, SesionToken, buscar_enlace, buscar_token

ENLACE = "https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz"
TOKEN = "sk-ant-oat01-AbC_d-123456789012345678901234567890"


def test_enlace_con_colores_e_hipervinculo():
    salida = (
        b"\x1b[2K\x1b[1mBrowser didn't open? Use the url below:\x1b[22m\r\n"
        b"\x1b]8;;https://x\x1b\\" + ENLACE.encode() + b"\x1b]8;;\x1b\\\r\n"
    )
    assert buscar_enlace(salida) == ENLACE


def test_enlace_a_medias_no_vale():
    assert buscar_enlace(b"https://claude.ai/oauth/autho") is None


def test_token_el_ultimo_y_sin_colores():
    salida = b"\x1b[1msk-ant-oat01-viejo-aaaaaaaaaaaaaaaaaaaaaaaa\x1b[22m\r\n\x1b[32m" + TOKEN.encode() + b"\x1b[39m\r\n"
    assert buscar_token(salida) == TOKEN
    assert buscar_token(b"nada por aqui") is None


# Un claude falso: escribe el enlace, lee el código y, si es el bueno, escribe el token.
_FALSO = f"""
import sys
print("Use the url below to sign in:")
print({ENLACE!r})
print("Paste code here if prompted > ", end="", flush=True)
codigo = sys.stdin.readline().strip()
print()
print({TOKEN!r} if codigo == "codigo-bueno" else "OAuth error: invalid code", flush=True)
"""


@pytest.mark.skipif(sys.platform == "win32", reason="pty solo existe en Linux y macOS")
def test_sesion_paso_a_paso():
    with SesionToken(orden=[sys.executable, "-c", _FALSO]) as sesion:
        assert sesion.arrancar(espera_s=10) == ENLACE
        assert sesion.enviar_codigo("  codigo-bueno \n", espera_s=10) == TOKEN


@pytest.mark.skipif(sys.platform == "win32", reason="pty solo existe en Linux y macOS")
def test_sesion_codigo_malo():
    with SesionToken(orden=[sys.executable, "-c", _FALSO]) as sesion:
        sesion.arrancar(espera_s=10)
        with pytest.raises(ErrorToken):
            sesion.enviar_codigo("otro", espera_s=10)


def test_enviar_sin_arrancar():
    with pytest.raises(ErrorToken):
        SesionToken().enviar_codigo("x")
