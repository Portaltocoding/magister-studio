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

    eco.encolar(dg.Dibujo, [{"svg": SVG}, {"svg": "no es un svg"}, {"svg": "tampoco"}, {"svg": "nada"}, {"svg": "x"}])
    r = await cliente.post("/api/diagramas", json={"encargo": "Mapa de argumentos: ¿son creencias los delirios?",
                                                   "contexto": "Bortolotti defiende que sí."})
    assert r.status_code == 200 and r.json()["svg"] == SVG
    # Si el modelo no da un SVG válido tras sus intentos, null: la web enseña el encargo como texto.
    r = await cliente.post("/api/diagramas", json={"encargo": "Otro mapa, que no saldrá bien", "contexto": ""})
    assert r.json()["svg"] is None
    assert (await cliente.post("/api/diagramas", json={"encargo": "corto"})).status_code == 422
