"""El tope de llamadas y los niveles de los harness (evals/tope.py). Lógica pura: sin base, sin red y sin claude.

Se lanzan también sin el conftest (que abre la base de pruebas): `uv run pytest --noconftest tests/test_evals_tope.py`.
"""

import argparse
import asyncio

import pytest
from pydantic import BaseModel

from evals import tope
from magister.cerebro import estructura, modelo
from magister.config import ajustes


class Cosa(BaseModel):
    x: int


@pytest.fixture
def eco(monkeypatch):
    monkeypatch.setattr(ajustes, "motor", "eco")
    estructura.eco.vaciar()
    yield estructura.eco
    estructura.eco.vaciar()


def test_pedir_cuenta_y_corta_en_el_tope():
    t = tope.Tope(2)
    t.pedir("a")
    t.pedir("b")
    assert (t.hechas, t.quedan, t.cortado) == (2, 0, False)
    with pytest.raises(tope.TopeAlcanzado):
        t.pedir("c")
    assert t.hechas == 2 and t.cortado
    assert "2 de un tope de 2" in t.resumen() and "parcial" in t.resumen()


def test_cabe_mira_antes_de_empezar_un_caso():
    t = tope.Tope(3, hechas=1)
    assert t.cabe(2) and not t.cabe(3)


def test_tope_cero_no_deja_ninguna():
    t = tope.Tope(0)
    with pytest.raises(tope.TopeAlcanzado):
        t.pedir()


def test_tope_no_valido():
    with pytest.raises(ValueError):
        tope.Tope(-1)
    with pytest.raises(ValueError):
        tope.Tope(3, "medio")


def test_el_tope_atraviesa_except_exception():
    # Así un harness con `except Exception` (o un reintento de estructurar) no lo confunde con un fallo del modelo.
    with pytest.raises(tope.TopeAlcanzado):
        try:
            tope.Tope(0).pedir()
        except Exception:  # noqa: BLE001
            pytest.fail("no debería tragárselo")


def test_argumentos_y_nivel_por_defecto():
    ap = argparse.ArgumentParser()
    tope.argumentos(ap, corto=4, completo=30)
    t = tope.de_args(ap.parse_args([]))
    assert (t.nivel, t.maximo) == ("corto", 4)
    t = tope.de_args(ap.parse_args(["--nivel", "completo"]))
    assert (t.nivel, t.maximo) == ("completo", 30)
    t = tope.de_args(ap.parse_args(["--nivel", "completo", "--max-llamadas", "7"]))
    assert (t.nivel, t.maximo) == ("completo", 7)


def test_del_nivel():
    casos = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    assert tope.del_nivel(casos, "completo", ["a"]) == casos
    assert tope.del_nivel(casos, "corto", ["c", "a"]) == [{"id": "a"}, {"id": "c"}]  # en el orden del banco
    assert tope.del_nivel(casos, "corto", 2) == casos[:2]
    with pytest.raises(ValueError):
        tope.del_nivel(casos, "corto", ["z"])


def test_contar_cuenta_las_salidas_estructuradas_del_eco(eco):
    eco.encolar(Cosa, [{"x": 1}, {"x": 2}, {"x": 3}])
    t = tope.Tope(2)

    async def tres():
        return [await estructura.estructurar("s", "e", Cosa, reintentos=0) for _ in range(3)]

    with tope.contar(t), pytest.raises(tope.TopeAlcanzado):
        asyncio.run(tres())
    assert t.hechas == 2 and t.cortado
    # Fuera del bloque todo vuelve a ser como antes: el eco ya no pide permiso.
    assert asyncio.run(estructura.estructurar("s", "e", Cosa, reintentos=0)).x == 3


def test_contar_cuenta_cada_reintento_de_estructurar(eco):
    # Un intento que no valida es otra llamada al modelo: cuenta.
    eco.encolar(Cosa, [{"x": "no"}, {"x": 5}])
    t = tope.Tope(10)
    with tope.contar(t):
        r = asyncio.run(estructura.estructurar("s", "e", Cosa, reintentos=1))
    assert r.x == 5 and t.hechas == 2


def test_contar_cuenta_el_texto_del_eco(eco, monkeypatch):
    async def rapido(historial):
        yield "hola"

    monkeypatch.setattr(modelo, "_eco", rapido)
    t = tope.Tope(1)

    async def dos():
        for _ in range(2):
            "".join([x async for x in modelo.generar("s", [modelo.Turno("usuario", "hola")])])

    with tope.contar(t), pytest.raises(tope.TopeAlcanzado):
        asyncio.run(dos())
    assert t.hechas == 1


def test_contar_no_lanza_claude_si_no_cabe(monkeypatch):
    lanzados = []

    async def falso(sistema, entrada, esquema=None, modelo_=None):
        lanzados.append(entrada)
        yield {"type": "result"}

    monkeypatch.setattr(modelo, "_lanzar_claude", falso)
    t = tope.Tope(1)

    async def lanzar(entrada):
        return [x async for x in modelo._lanzar_claude("s", entrada)]

    with tope.contar(t):
        assert asyncio.run(lanzar("una")) == [{"type": "result"}]
        with pytest.raises(tope.TopeAlcanzado):
            asyncio.run(lanzar("dos"))
    assert lanzados == ["una"]  # la segunda no llegó a lanzarse
    assert modelo._lanzar_claude is falso  # restaurado
