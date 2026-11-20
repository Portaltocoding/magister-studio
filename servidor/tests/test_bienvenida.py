"""La bienvenida: conectar la cuenta de Claude desde la página, el token en disco y el aviso de cuenta caída.

Ninguna prueba llama al `claude` de verdad: el alta usa una sesión falsa (o un claude falso en Python con pty, en
Linux y macOS) y el modelo, el motor eco o un proceso de mentira.
"""

import json
import stat
import sys

import pytest

from magister.cerebro import cuenta, modelo
from magister.cerebro.token_claude import ErrorToken

TOKEN = "sk-ant-oat01-AbC_d-123456789012345678901234567890"
ENLACE = "https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz"


class SesionFalsa:
    cerradas = 0

    def __init__(self, orden=()):
        self.orden = orden

    def arrancar(self, espera_s: float = 60.0) -> str:
        return ENLACE

    def enviar_codigo(self, codigo: str, espera_s: float = 120.0) -> str:
        if codigo.strip() != "codigo-bueno":
            raise ErrorToken("OAuth error: invalid code")
        return TOKEN

    def cerrar(self) -> None:
        SesionFalsa.cerradas += 1


@pytest.fixture(autouse=True)
def cuenta_limpia(monkeypatch, tmp_path):
    monkeypatch.setattr(cuenta.ajustes, "claude_token_fichero", str(tmp_path / "datos" / "claude_token"))
    monkeypatch.setattr(cuenta, "SesionToken", SesionFalsa)
    monkeypatch.setattr(cuenta, "_alta", cuenta._Alta())
    monkeypatch.delenv(cuenta.VARIABLE, raising=False)
    SesionFalsa.cerradas = 0
    cuenta.marcar_buena()
    yield
    cuenta.marcar_buena()


# ===== El token en disco =====

def test_guardar_y_leer_el_token_con_permisos_600():
    assert cuenta.leer_token() is None and cuenta.entorno_claude() is None
    cuenta.guardar_token(f" {TOKEN}\n")
    assert cuenta.leer_token() == TOKEN
    if sys.platform != "win32":
        assert stat.S_IMODE(cuenta.ruta_token().stat().st_mode) == 0o600
    assert cuenta.entorno_claude()[cuenta.VARIABLE] == TOKEN


def test_un_token_que_no_lo_parece_no_se_guarda():
    with pytest.raises(cuenta.ErrorCuenta):
        cuenta.guardar_token("OAuth error: invalid code")
    assert not cuenta.ruta_token().exists()


def test_el_token_del_fichero_manda_sobre_la_variable(monkeypatch):
    monkeypatch.setenv(cuenta.VARIABLE, "sk-ant-oat01-viejo-aaaaaaaaaaaaaaaaaaaaaaaa")
    cuenta.guardar_token(TOKEN)
    assert cuenta.entorno_claude()[cuenta.VARIABLE] == TOKEN


# ===== claude -p recoge el token sin reiniciar y detecta la cuenta caída =====

def _claude_que_cuenta(resultado: dict, salida: int = 0) -> list[str]:
    codigo = ("import json,os,sys\n"
              "print(json.dumps({'type': 'stream_event', 'usa': os.environ.get('CLAUDE_CODE_OAUTH_TOKEN', '')}), flush=True)\n"
              f"print(json.dumps({resultado!r}), flush=True)\n"
              f"sys.exit({salida})\n")
    return [sys.executable, "-c", codigo]


@pytest.mark.anyio
async def test_cada_llamada_lee_el_token_del_fichero():
    args = _claude_que_cuenta({"type": "result"})
    assert [e async for e in modelo._proceso_claude(args, "")][0]["usa"] == ""
    cuenta.guardar_token(TOKEN)  # sin reiniciar nada
    assert [e async for e in modelo._proceso_claude(args, "")][0]["usa"] == TOKEN


@pytest.mark.anyio
async def test_un_token_caducado_da_el_error_de_cuenta_sin_el_texto_crudo():
    args = _claude_que_cuenta({"type": "result", "is_error": True, "result": "OAuth token has expired. Please run /login"})
    with pytest.raises(modelo.ErrorModelo) as e:
        [x async for x in modelo._proceso_claude(args, "")]
    assert str(e.value) == cuenta.MENSAJE_CUENTA and cuenta.caida()
    # Una llamada buena la quita.
    [x async for x in modelo._proceso_claude(_claude_que_cuenta({"type": "result"}), "")]
    assert not cuenta.caida()


def test_que_errores_son_de_la_cuenta():
    assert cuenta.es_error_de_cuenta("Invalid API key · Please run /login")
    assert cuenta.es_error_de_cuenta("authentication_error: invalid bearer token")
    assert not cuenta.es_error_de_cuenta("usage limit reached") and not cuenta.es_error_de_cuenta("plazo agotado")


# ===== ¿Hay cuenta? =====

@pytest.mark.anyio
async def test_estado_de_la_cuenta(monkeypatch):
    monkeypatch.setattr(cuenta.ajustes, "motor", "cli")
    monkeypatch.setattr(cuenta.Path, "home", lambda: cuenta.ruta_token().parent / "sin_casa")

    async def sin_sesion():
        return False

    monkeypatch.setattr(cuenta, "_sesion_de_claude", sin_sesion)
    assert await cuenta.estado() == {"conectada": False, "origen": None, "caida": False}
    monkeypatch.setenv(cuenta.VARIABLE, TOKEN)
    assert (await cuenta.estado())["origen"] == "entorno"
    cuenta.guardar_token(TOKEN)
    assert (await cuenta.estado())["origen"] == "fichero"
    cuenta.marcar_caida()
    assert await cuenta.estado() == {"conectada": False, "origen": "fichero", "caida": True}

    # Sin token ni variable pero con el inicio de sesión de claude (el desarrollo en Windows): conectada.
    cuenta.marcar_buena()
    cuenta.ruta_token().unlink()
    monkeypatch.delenv(cuenta.VARIABLE)

    async def con_sesion():
        return True

    monkeypatch.setattr(cuenta, "_sesion_de_claude", con_sesion)
    assert await cuenta.estado() == {"conectada": True, "origen": "sesion", "caida": False}


# ===== Las rutas =====

@pytest.mark.anyio
async def test_alta_completa_por_las_rutas(cliente):
    r = await cliente.post("/api/bienvenida/cuenta/iniciar")
    assert r.status_code == 200 and r.json() == {"enlace": ENLACE}
    r = await cliente.post("/api/bienvenida/cuenta/codigo", json={"codigo": "  codigo-bueno \n"})
    assert r.status_code == 200 and r.json() == {"conectada": True}
    assert TOKEN not in r.text and cuenta.leer_token() == TOKEN
    assert SesionFalsa.cerradas >= 1


@pytest.mark.anyio
async def test_codigo_malo_pide_probar_otra_vez_y_no_guarda_nada(cliente):
    await cliente.post("/api/bienvenida/cuenta/iniciar")
    r = await cliente.post("/api/bienvenida/cuenta/codigo", json={"codigo": "otro"})
    assert r.status_code == 400 and "Probar otra vez" in r.json()["detail"]
    assert cuenta.leer_token() is None
    # La sesión se cerró: otro código sin empezar de nuevo no vale.
    r = await cliente.post("/api/bienvenida/cuenta/codigo", json={"codigo": "codigo-bueno"})
    assert r.status_code == 400 and "caducado" in r.json()["detail"]
    # Probar otra vez.
    assert (await cliente.post("/api/bienvenida/cuenta/iniciar")).status_code == 200
    assert (await cliente.post("/api/bienvenida/cuenta/codigo", json={"codigo": "codigo-bueno"})).status_code == 200


@pytest.mark.anyio
async def test_una_conexion_a_medias_caduca(cliente, monkeypatch):
    await cliente.post("/api/bienvenida/cuenta/iniciar")
    monkeypatch.setattr(cuenta, "ESPERA_ALTA_S", -1)
    r = await cliente.post("/api/bienvenida/cuenta/codigo", json={"codigo": "codigo-bueno"})
    assert r.status_code == 400 and "caducado" in r.json()["detail"] and cuenta.leer_token() is None


@pytest.mark.anyio
async def test_una_sola_sesion_a_la_vez(cliente):
    await cliente.post("/api/bienvenida/cuenta/iniciar")
    await cliente.post("/api/bienvenida/cuenta/iniciar")  # la segunda cierra la primera
    assert SesionFalsa.cerradas >= 1 and cuenta._alta.sesion is not None


@pytest.mark.anyio
async def test_sin_pty_el_mensaje_es_claro(cliente, monkeypatch):
    class SinPty(SesionFalsa):
        def arrancar(self, espera_s: float = 60.0) -> str:
            raise ModuleNotFoundError("No module named 'fcntl'")

    monkeypatch.setattr(cuenta, "SesionToken", SinPty)
    r = await cliente.post("/api/bienvenida/cuenta/iniciar")
    assert r.status_code == 409 and "Docker" in r.json()["detail"]


@pytest.mark.anyio
async def test_estado_de_la_bienvenida_y_nombre(cliente):
    r = (await cliente.get("/api/bienvenida")).json()
    assert r["estado"] == "pendiente" and r["nombre"] == "" and r["cuenta"]["conectada"] is True  # motor eco
    assert (await cliente.put("/api/preferencias", json={"nombre": "Lucía"})).json()["nombre"] == "Lucía"
    assert (await cliente.put("/api/bienvenida/estado", json={"estado": "hecha"})).json() == {"estado": "hecha"}
    r = (await cliente.get("/api/bienvenida")).json()
    assert r["estado"] == "hecha" and r["nombre"] == "Lucía"
    assert (await cliente.put("/api/bienvenida/estado", json={"estado": "pendiente"})).status_code == 200
    assert (await cliente.get("/api/bienvenida")).json()["estado"] == "pendiente"
    assert (await cliente.put("/api/bienvenida/estado", json={"estado": "otra"})).status_code == 422


@pytest.mark.anyio
async def test_la_prueba_rapida(cliente, monkeypatch):
    assert (await cliente.post("/api/bienvenida/probar")).json()["ok"] is True  # motor eco

    async def caducado(*_a, **_k):
        raise modelo.ErrorModelo(cuenta.MENSAJE_CUENTA)
        yield ""

    from magister.api import rutas_bienvenida

    monkeypatch.setattr(rutas_bienvenida, "generar", caducado)
    r = (await cliente.post("/api/bienvenida/probar")).json()
    assert r["ok"] is False and r["cuenta"] is False


@pytest.mark.anyio
async def test_ninguna_ruta_devuelve_el_token(cliente):
    cuenta.guardar_token(TOKEN)
    for ruta in ("/api/bienvenida", "/api/preferencias"):
        assert TOKEN not in (await cliente.get(ruta)).text
    assert TOKEN not in json.dumps(await cuenta.estado())


# ===== Con un claude falso de verdad (pty), solo en Linux y macOS =====

_FALSO = f"""
import sys
print("Use the url below to sign in:")
print({ENLACE!r})
codigo = sys.stdin.readline().strip()
print({TOKEN!r} if codigo == "codigo-bueno" else "OAuth error: invalid code", flush=True)
"""


@pytest.mark.skipif(sys.platform == "win32", reason="pty solo existe en Linux y macOS")
@pytest.mark.anyio
async def test_alta_con_un_claude_falso(monkeypatch):
    from magister.cerebro.token_claude import SesionToken

    monkeypatch.setattr(cuenta, "SesionToken", SesionToken)
    monkeypatch.setattr(cuenta, "ORDEN_ALTA", (sys.executable, "-c", _FALSO))
    assert await cuenta.iniciar_alta() == ENLACE
    await cuenta.terminar_alta("codigo-bueno")
    assert cuenta.leer_token() == TOKEN
