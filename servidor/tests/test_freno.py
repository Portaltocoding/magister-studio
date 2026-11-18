"""El freno de llamadas: nada puede disparar llamadas al modelo sin control (pasó: 162 en una hora por un fallo)."""

import pytest

from magister.cerebro import freno, modelo


@pytest.fixture
def topes(monkeypatch):
    monkeypatch.setattr(freno.ajustes, "freno_ventana_s", 600)
    monkeypatch.setattr(freno.ajustes, "freno_por_prompt", 3)
    monkeypatch.setattr(freno.ajustes, "freno_total", 5)
    avisos: list[tuple[str, str]] = []
    monkeypatch.setattr(freno, "_avisos", [lambda c, d: avisos.append((c, d))])
    freno.reiniciar()
    yield avisos
    freno.reiniciar()


def test_un_prompt_que_se_dispara_se_para_entero_y_avisa_una_vez(topes) -> None:
    for t in (0, 1, 2):
        freno.comprobar("diagrama_chat", t)
    with pytest.raises(freno.Frenado, match="diagrama_chat"):
        freno.comprobar("diagrama_chat", 3)
    # Sigue parado toda la ventana, aunque las llamadas viejas ya no cuenten; y avisa una sola vez.
    for t in (4, 300, 599):
        with pytest.raises(freno.Frenado, match="en pausa"):
            freno.comprobar("diagrama_chat", t)
    assert len(topes) == 1 and "3 llamadas en 10 min" in topes[0][1]
    freno.comprobar("conversar", 10)  # los demás prompts siguen
    freno.comprobar("diagrama_chat", 604)  # pasada la pausa, vuelve


def test_en_total_se_para_todo(topes) -> None:
    for i, t in enumerate(range(5)):
        freno.comprobar(f"p{i}", t)
    with pytest.raises(freno.Frenado, match="todas"):
        freno.comprobar("conversar", 6)
    with pytest.raises(freno.Frenado, match="todas"):
        freno.comprobar("otro", 100)
    assert topes[0][0] == freno.TODO


@pytest.mark.anyio
async def test_una_llamada_frenada_no_lanza_claude_ni_se_reintenta(topes, monkeypatch) -> None:
    lanzados: list[str] = []

    async def lanzar_falso(sistema, entrada, esquema=None, modelo=None):
        lanzados.append(entrada)
        yield {"type": "result"}

    monkeypatch.setattr(modelo, "_lanzar_claude", lanzar_falso)
    marca = modelo.prompt_actual.set(("diagrama_chat", "v1"))
    try:
        for _ in range(3):
            assert [e async for e in modelo._lineas_claude("s", "x")] == [{"type": "result"}]
        with pytest.raises(modelo.ErrorModelo) as e:
            [e async for e in modelo._lineas_claude("s", "x")]
    finally:
        modelo.prompt_actual.reset(marca)
    assert len(lanzados) == 3 and not modelo.transitorio(e.value)
