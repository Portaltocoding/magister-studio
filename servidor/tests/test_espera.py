"""Mientras el tutor razona sin escribir (puede ser más de un minuto): el pulso a la web y, si tarda, el guion de por
dónde irá la respuesta y unas frases con gracia sobre el tema. Sin modelo: el reloj y la llamada son de mentira."""

import asyncio

import pytest

from magister.cerebro.modelo import Turno
from magister.flujo import comun

GUION = "Voy a ver:\n1. Si los delirios son creencias"


@pytest.fixture
def entorno(monkeypatch):
    enviados: list[dict] = []
    reloj = {"t": 100.0}
    monkeypatch.setattr(comun, "escribir", lambda **d: enviados.append(d))
    monkeypatch.setattr(comun, "reloj", lambda: reloj["t"])
    pedidos: list[str] = []

    async def estructurar_falso(sistema, entrada, Modelo, **_):
        pedidos.append(entrada)
        await asyncio.sleep(0.01)
        return Modelo(guion=GUION, frases=["Delirando un poco…", "Confabulando con criterio…", " "])

    monkeypatch.setattr(comun, "estructurar", estructurar_falso)
    return enviados, reloj, pedidos


@pytest.mark.anyio
async def test_pulso_cada_segundo_y_guion_si_tarda(entorno) -> None:
    enviados, reloj, pedidos = entorno
    e = comun._Espera([Turno("usuario", "¿Son creencias los delirios?")])
    for t in (100.0, 100.4, 101.2, 103.0):
        reloj["t"] = t
        e.latido()
    assert [d["latido"] for d in enviados] == [0, 1, 3] and e.tarea is None
    reloj["t"] = 104.5
    e.latido()
    await e.tarea
    assert pedidos == ["¿Son creencias los delirios?"]
    assert enviados[-1] == {"adelanto": {"guion": GUION, "frases": ["Delirando un poco…", "Confabulando con criterio…"]}}


@pytest.mark.anyio
async def test_si_llega_el_texto_no_hay_guion_tardio(entorno) -> None:
    enviados, reloj, _ = entorno
    e = comun._Espera([Turno("usuario", "pregunta")])
    reloj["t"] = 109.0
    e.latido()
    e.cerrar()  # primer trozo de la respuesta
    await asyncio.sleep(0.05)
    e.latido()
    assert not any("adelanto" in d for d in enviados) and e.tarea.cancelled()


@pytest.mark.anyio
async def test_hablar_pone_el_pulso_solo_en_el_chat(monkeypatch) -> None:
    from magister.cerebro import modelo

    vistos: list[object] = []

    async def generar_falso(sistema, historial, tarea=None):
        vistos.append(modelo.latido_actual.get())
        yield "hola"

    monkeypatch.setattr(comun, "generar", generar_falso)
    monkeypatch.setattr(comun, "escribir", lambda **d: None)
    await comun.hablar("s", [Turno("usuario", "x")])
    await comun.hablar("s", [Turno("usuario", "x")], tarea="llamada")
    assert vistos[0] is not None and vistos[1] is None and modelo.latido_actual.get() is None
