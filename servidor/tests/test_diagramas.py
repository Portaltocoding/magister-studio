"""Los diagramas ricos del chat: el encargo se dibuja aparte (sin modelo en las pruebas: el eco)."""

import pytest

from magister.material import diagramas as dg

SVG = '<svg viewBox="0 0 960 600" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="100" height="40" rx="10"/></svg>'


def test_reglas_del_svg() -> None:
    assert dg.reglas(dg.Dibujo(svg=SVG)) == []
    assert dg.reglas(dg.Dibujo(svg="Aquí tienes: " + SVG))
    assert dg.reglas(dg.Dibujo(svg=SVG.replace("<rect", '<a href="x"><rect').replace("</svg>", "</a></svg>")))
    assert dg.reglas(dg.Dibujo(svg=SVG.replace("<rect", '<rect onclick="x()"')))


def test_el_tutor_sabe_encargar_diagramas() -> None:
    from magister.cerebro.prompts import cargar

    texto = cargar("conversar").texto
    assert "```diagrama" in texto and "Mapa de argumentos" in texto


@pytest.mark.anyio
async def test_la_ruta_dibuja_el_encargo(cliente) -> None:
    from magister.cerebro.estructura import eco

    dg._recientes.clear()
    eco.encolar(dg.Dibujo, [{"svg": SVG}, {"svg": "no es un svg"}, {"svg": "tampoco"}, {"svg": "nada"}, {"svg": "x"}])
    r = await cliente.post("/api/diagramas", json={"encargo": "Mapa de argumentos: ¿son creencias los delirios?",
                                                   "contexto": "Bortolotti defiende que sí."})
    assert r.status_code == 200 and r.json()["svg"] == SVG
    # Si el modelo no da un SVG válido tras sus intentos, null: la web enseña el encargo como texto.
    r = await cliente.post("/api/diagramas", json={"encargo": "Otro mapa, que no saldrá bien", "contexto": ""})
    assert r.json()["svg"] is None
    assert (await cliente.post("/api/diagramas", json={"encargo": "corto"})).status_code == 422


@pytest.mark.anyio
async def test_peticiones_iguales_a_la_vez_comparten_una_llamada_y_hay_tope(monkeypatch) -> None:
    import asyncio

    llamadas: list[str] = []
    a_la_vez = {"ahora": 0, "maximo": 0}

    async def llamar_falso(encargo, contexto):
        llamadas.append(encargo)
        a_la_vez["ahora"] += 1
        a_la_vez["maximo"] = max(a_la_vez["maximo"], a_la_vez["ahora"])
        await asyncio.sleep(0.05)
        a_la_vez["ahora"] -= 1
        return SVG

    monkeypatch.setattr(dg, "_llamar", llamar_falso)
    monkeypatch.setattr(dg, "_repetido", lambda *a: False)
    iguales = await asyncio.gather(*(dg.dibujar("Mapa de ideas del tema", "texto") for _ in range(10)))
    assert iguales == [SVG] * 10 and llamadas == ["Mapa de ideas del tema"]
    await asyncio.gather(*(dg.dibujar(f"Mapa número {i}", "texto") for i in range(6)))
    assert len(llamadas) == 7 and a_la_vez["maximo"] <= dg.A_LA_VEZ


def test_trozos_del_mismo_encargo_no_se_dibujan() -> None:
    dg._recientes.clear()
    assert not dg._repetido("Mapa", "texto de antes", 100.0)
    assert dg._repetido("Mapa de argumentos", "texto de antes", 101.0)  # el mismo encargo, más largo: fallo de la web
    assert not dg._repetido("Mapa de argumentos", "texto de antes", 102.0)  # el mismo otra vez: lo resuelve la caché
    assert not dg._repetido("Otro mapa", "otro texto de antes", 103.0)  # otro diagrama de la respuesta
    assert not dg._repetido("Algo distinto", "texto de antes", 200.0)  # pasado el minuto, vale
    dg._recientes.clear()
