"""La voz local (Piper) y el registro de las llamadas."""

import json

import pytest

from magister.config import ajustes
from magister.voz import piper

pytestmark = pytest.mark.anyio


async def test_sin_piper_no_hay_voces_y_la_pantalla_usa_la_del_navegador(cliente, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(ajustes, "voz_piper", str(tmp_path / "no-existe.exe"))
    assert (await cliente.get("/api/voz/voces")).json() == []
    r = await cliente.post("/api/voz", json={"texto": "Hola.", "voz": "davefx"})
    assert r.status_code == 503


async def test_el_registro_de_una_llamada_se_guarda_y_se_lista(cliente, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(ajustes, "registros", str(tmp_path))
    cuerpo = {"conversacion_id": 7, "tipo": "clase", "leccion": "L4", "segundos": 95, "voz": "magister:davefx",
              "resumen": {"turnos": 2, "ecos_descartados": 1},
              "eventos": [{"t": 0, "e": "llamar"}, {"t": 4100, "e": "eco", "d": {"texto": "hola"}}]}
    r = await cliente.post("/api/llamadas/registro", json=cuerpo)
    assert r.status_code == 201
    fichero = tmp_path / "llamadas" / r.json()["fichero"]
    guardado = json.loads(fichero.read_text(encoding="utf-8"))
    assert guardado["eventos"][1]["e"] == "eco" and guardado["resumen"]["ecos_descartados"] == 1
    lista = (await cliente.get("/api/llamadas/registros")).json()
    assert lista[0]["tipo"] == "clase" and lista[0]["eventos"] == 2


@pytest.mark.skipif(not piper.disponibles(), reason="Piper no está instalado en este equipo")
async def test_piper_dice_una_frase_y_la_repetida_sale_de_memoria() -> None:
    try:
        voz = piper.disponibles()[0].id
        wav = await piper.sintetizar("Hola, esto es una prueba.", voz)
        assert wav[:4] == b"RIFF" and len(wav) > 1000
        assert await piper.sintetizar("Hola,   esto es una prueba.", voz) is wav  # mismo texto normalizado: de la caché
    finally:
        await piper.cerrar()
