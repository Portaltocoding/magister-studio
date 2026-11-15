import json

import httpx
import pytest

from magister.api.app import app
from magister.config import ajustes


@pytest.fixture(autouse=True)
async def _base(base):
    yield


def cliente() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://prueba")


@pytest.mark.anyio
async def test_salud() -> None:
    async with cliente() as c:
        r = await c.get("/api/salud")

    assert r.status_code == 200
    assert r.json() == {"ok": True, "motor": ajustes.motor, "modelo": ajustes.modelo}


@pytest.mark.anyio
async def test_pulso_emite_cinco_eventos() -> None:
    async with cliente() as c:
        r = await c.get("/api/pulso")

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    bloques = [b for b in r.text.split("\n\n") if b.strip() and not b.startswith(":")]
    eventos = []
    for bloque in bloques:
        campos = dict(linea.split(": ", 1) for linea in bloque.splitlines())
        eventos.append((campos["event"], json.loads(campos["data"])))
    assert eventos == [("pulso", {"i": i}) for i in range(5)]


@pytest.mark.anyio
async def test_cabeceras_del_sobre() -> None:
    async with cliente() as c:
        nueva = await c.get("/api/salud")
        propia = await c.get("/api/salud", headers={"X-Request-Id": "abc123"})

    assert nueva.headers["X-Magister-Version"] == "0.1"
    assert nueva.headers["X-Request-Id"]
    assert propia.headers["X-Magister-Version"] == "0.1"
    assert propia.headers["X-Request-Id"] == "abc123"


@pytest.fixture
def con_token(monkeypatch) -> str:
    monkeypatch.setattr(ajustes, "token", "secreto-de-prueba")
    return "secreto-de-prueba"


@pytest.mark.anyio
async def test_sin_token_configurado_no_se_exige(monkeypatch) -> None:
    monkeypatch.setattr(ajustes, "token", "")
    async with cliente() as c:
        r = await c.get("/api/pulso", params={"n": 1})
    assert r.status_code == 200


@pytest.mark.anyio
async def test_token_falta_o_no_coincide_da_401(con_token: str) -> None:
    async with cliente() as c:
        sin = await c.get("/api/pulso", params={"n": 1})
        malo = await c.get("/api/pulso", params={"n": 1}, headers={"X-Magister-Token": "otro"})

    for r in (sin, malo):
        assert r.status_code == 401
        assert r.json() == {"detail": "falta el token o no es válido"}
        assert r.headers["X-Magister-Version"] == "0.1"
        assert r.headers["X-Request-Id"]


@pytest.mark.anyio
async def test_token_correcto_pasa_y_salud_es_libre(con_token: str) -> None:
    async with cliente() as c:
        bueno = await c.get("/api/pulso", params={"n": 1}, headers={"X-Magister-Token": con_token})
        salud = await c.get("/api/salud")

    assert bueno.status_code == 200
    assert salud.status_code == 200


@pytest.mark.anyio
async def test_cuerpo_de_mas_de_64_kib_da_413() -> None:
    async with cliente() as c:
        grande = await c.post("/api/salud", content=b"x" * (64 * 1024 + 1))
        justo = await c.post("/api/salud", content=b"x" * (64 * 1024))

    assert grande.status_code == 413
    assert grande.json() == {"detail": "el cuerpo pasa del máximo de 64 KiB"}
    assert justo.status_code == 405  # pasa el límite y llega a la ruta, que solo acepta GET
