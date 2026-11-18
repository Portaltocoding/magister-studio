"""Cada tarea tiene su plazo (config/modelos.yaml): pasado, la llamada se corta y se reintenta, y no más veces de las
que diga. Sin modelo: un «claude» de mentira que no para de mandar señales."""

import sys

import pytest

from magister.cerebro import enrutador, modelo


def test_cada_tarea_y_prompt_tiene_su_plazo() -> None:
    assert enrutador.plazo(None, "diagrama_chat") == 90  # el del prompt, más corto que el de su tarea
    assert enrutador.plazo("asesor") == 60 and enrutador.plazo(None, "conversar") == 300
    assert enrutador.plazo(None, "apuntes_bloque") == 420  # el de su tarea (generar)
    assert enrutador.reintentos("asesor") == 1 and enrutador.reintentos(None, "conceptos") == 2


def _sin_parar(segundos: float) -> list[str]:
    codigo = ("import json,time\n"
              f"fin = time.time() + {segundos}\n"
              "while time.time() < fin:\n"
              "    time.sleep(0.1); print(json.dumps({'type': 'stream_event'}), flush=True)\n"
              "print(json.dumps({'type': 'result'}), flush=True)\n")
    return [sys.executable, "-c", codigo]


@pytest.mark.anyio
async def test_el_plazo_de_la_tarea_corta_aunque_siga_mandando_senales() -> None:
    marca = modelo._plazo_actual.set(0.6)
    try:
        with pytest.raises(modelo.ErrorModelo, match="plazo agotado"):
            [e async for e in modelo._proceso_claude(_sin_parar(3), "")]
        eventos = [e async for e in modelo._proceso_claude(_sin_parar(0.2), "")]
        assert eventos[-1]["type"] == "result"
    finally:
        modelo._plazo_actual.reset(marca)


@pytest.mark.anyio
async def test_al_cortarse_se_reintenta_las_veces_de_su_tarea(monkeypatch) -> None:
    monkeypatch.setattr(modelo.ajustes, "motor", "cli")
    monkeypatch.setattr(modelo.asyncio, "sleep", lambda *_: _nada())
    vistos: list[tuple[str | None, float | None]] = []

    async def lanzar_falso(sistema, entrada, esquema=None, modelo_=None):
        vistos.append((modelo.tarea_actual.get(), modelo._plazo_actual.get()))
        raise modelo.ErrorModelo("plazo agotado")
        yield {}

    monkeypatch.setattr(modelo, "_lanzar_claude", lanzar_falso)
    with pytest.raises(modelo.ErrorModelo):
        [t async for t in modelo.generar("s", [modelo.Turno("usuario", "hola")], "asesor")]
    assert vistos == [("asesor", 60.0), ("asesor", 60.0)]  # 1 intento + 1 reintento, con el plazo del asesor
    modelo.cortacircuitos.clear()


async def _nada() -> None:
    return None
