"""Los diagramas ricos del chat: el encargo se dibuja aparte (sin modelo en las pruebas: el eco)."""

import pytest

from magister.material import diagramas as dg

SVG = '<svg viewBox="0 0 960 600" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="100" height="40" rx="10"/></svg>'


def test_reglas_del_svg() -> None:
    assert dg.reglas(dg.Dibujo(svg=SVG)) == []
    assert dg.reglas(dg.Dibujo(svg="Aquí tienes: " + SVG))
    assert dg.reglas(dg.Dibujo(svg=SVG.replace("<rect", '<a href="x"><rect').replace("</svg>", "</a></svg>")))
    assert dg.reglas(dg.Dibujo(svg=SVG.replace("<rect", '<rect onclick="x()"')))


def test_topes_de_tamano() -> None:
    assert dg.excesos(SVG) == []
    caja = '<rect class="c" x="20" y="20" width="210" height="64" rx="10"/><text class="t" x="125" y="58">Tesis</text>'
    grande = SVG.replace("</svg>", caja * 60 +"</svg>")
    avisos = dg.excesos(grande)
    assert any("caracteres" in a for a in avisos) and any("formas y textos" in a for a in avisos)
    assert dg.excesos(SVG.replace("<rect", "<!-- caja --><rect")) == ["svg: sin comentarios, <title>, <desc> ni metadatos"]
    # No son reglas: un dibujo grande pero válido no provoca otro intento (otra llamada cara).
    assert dg.reglas(dg.Dibujo(svg=grande)) == []


@pytest.mark.anyio
async def test_un_dibujo_grande_se_da_y_se_avisa(monkeypatch, caplog) -> None:
    grande =SVG.replace("</svg>", '<text class="s" x="1" y="1">verbo</text>' * 80 + "</svg>")
    llamadas = []

    async def estructurar_falso(*a, **k):
        llamadas.append(1)
        return dg.Dibujo(svg=grande)

    monkeypatch.setattr(dg, "estructurar", estructurar_falso)
    with caplog.at_level("WARNING", logger="magister.diagramas"):
        assert await dg._llamar("Mapa de ideas del tema", "texto") == grande
    assert llamadas == [1] and "más grande de lo pedido" in caplog.text


def test_el_prompt_pide_un_dibujo_corto() -> None:
    from magister.cerebro.prompts import cargar

    texto = cargar("diagrama_chat").rellenar()
    assert "<style>.c{fill:#e8e6e0" in texto and "12 cajas, 14 flechas y 40 textos" in texto
    assert "Antes de dibujar, decide" not in texto  # invitaba a razonar por escrito antes del SVG


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
async def test_la_ruta_pasa_si_sigues_ahi(cliente, monkeypatch) -> None:
    """La ruta le da a `dibujar` cómo saber si el cliente se ha ido (request.is_disconnected), para no lanzar en vano."""
    vistos: list = []

    async def dibujar_falso(encargo, contexto, desconectado=None):
        vistos.append(desconectado)
        return None if desconectado is None else ("ido" if await desconectado() else SVG)

    monkeypatch.setattr(dg, "dibujar", dibujar_falso)
    r = await cliente.post("/api/diagramas", json={"encargo": "Mapa de ideas del tema", "contexto": "texto"})
    assert r.json()["svg"] == SVG  # el cliente sigue conectado mientras espera la respuesta
    assert len(vistos) == 1 and callable(vistos[0])


@pytest.mark.anyio
async def test_peticiones_iguales_a_la_vez_comparten_una_llamada(monkeypatch) -> None:
    import asyncio

    llamadas: list[str] = []

    async def llamar_falso(encargo, contexto):
        llamadas.append(encargo)
        await asyncio.sleep(0.05)
        return SVG

    monkeypatch.setattr(dg, "_llamar", llamar_falso)
    monkeypatch.setattr(dg, "_repetido", lambda *a: False)
    iguales = await asyncio.gather(*(dg.dibujar("Mapa de ideas del tema", "texto") for _ in range(10)))
    assert iguales == [SVG] * 10 and llamadas == ["Mapa de ideas del tema"]
    await asyncio.gather(*(dg.dibujar(f"Mapa número {i}", "texto") for i in range(6)))
    assert len(llamadas) == 7


def _claude_de_mentira(monkeypatch, lanzados: list[str], suelta):
    """El proceso de claude, sin claude: apunta qué se lanza y no acaba hasta que se suelte."""
    from magister.cerebro import modelo

    async def lanzar_falso(sistema, entrada, esquema=None, modelo_=None):
        lanzados.append(entrada)
        await suelta.wait()
        yield {"type": "result"}

    monkeypatch.setattr(modelo, "_lanzar_claude", lanzar_falso)


async def _llamada(prompt: str, entrada: str) -> list[dict]:
    from magister.cerebro import modelo

    marca = modelo.prompt_actual.set((prompt, "v1"))
    try:
        return [e async for e in modelo._lineas_claude("s", entrada)]
    finally:
        modelo.prompt_actual.reset(marca)


@pytest.mark.anyio
async def test_los_diagramas_tienen_tope_y_el_chat_nunca_espera(monkeypatch) -> None:
    """MAGISTER_DIAGRAMAS_A_LA_VEZ: los que pasan del tope esperan en cola sin lanzar claude; el chat sale al momento."""
    import asyncio

    from magister.cerebro import modelo

    monkeypatch.setattr(modelo.ajustes, "diagramas_a_la_vez", 2)
    lanzados: list[str] = []
    suelta = asyncio.Event()
    _claude_de_mentira(monkeypatch, lanzados, suelta)
    dibujos = [asyncio.create_task(_llamada("diagrama_chat", f"d{i}")) for i in range(5)]
    await asyncio.sleep(0.05)
    assert sorted(lanzados) == ["d0", "d1"]  # el resto, en cola: sin proceso
    chat = asyncio.create_task(_llamada("conversar", "pregunta"))
    await asyncio.sleep(0.05)
    assert "pregunta" in lanzados  # con los dos huecos ocupados, el chat no espera
    suelta.set()
    await asyncio.gather(chat, *dibujos)
    assert len(lanzados) == 6


@pytest.mark.anyio
async def test_si_te_vas_mientras_espera_en_cola_no_se_lanza(monkeypatch) -> None:
    import asyncio

    from magister.cerebro import modelo

    monkeypatch.setattr(modelo.ajustes, "diagramas_a_la_vez", 1)
    monkeypatch.setattr(dg, "_repetido", lambda *a: False)
    monkeypatch.setattr(dg, "SONDEO_S", 0.02)
    lanzados: list[str] = []
    suelta = asyncio.Event()
    _claude_de_mentira(monkeypatch, lanzados, suelta)

    async def llamar(encargo, contexto):  # como _llamar, sin caché ni esquema: solo la llamada a claude
        await _llamada("diagrama_chat", encargo)
        return SVG

    monkeypatch.setattr(dg, "_llamar", llamar)
    primero = asyncio.create_task(dg.dibujar("Mapa que se dibuja", "texto"))
    await asyncio.sleep(0.05)
    segundo = asyncio.create_task(dg.dibujar("Mapa que espera", "texto"))
    await asyncio.sleep(0.05)
    assert lanzados == ["Mapa que se dibuja"]

    async def ido() -> bool:
        return True

    # Quien lo pidió se va (cierra la pestaña): la ruta lo ve con request.is_disconnected.
    tercero = await dg.dibujar("Mapa de la pestaña cerrada", "texto", desconectado=ido)
    segundo.cancel()
    suelta.set()
    assert await primero == SVG and tercero is None
    await asyncio.sleep(0.1)
    assert lanzados == ["Mapa que se dibuja"]  # ni el cancelado ni el de la pestaña cerrada han lanzado claude
    # Si ya se está dibujando, se acaba aunque te vayas (queda en la caché para cuando vuelvas).
    suelta.clear()
    cuarto = asyncio.create_task(dg.dibujar("Mapa ya empezado", "texto"))
    await asyncio.sleep(0.05)
    cuarto.cancel()
    suelta.set()
    await asyncio.sleep(0.1)
    assert lanzados[-1] == "Mapa ya empezado" and not dg._en_curso


def test_trozos_del_mismo_encargo_no_se_dibujan() -> None:
    dg._recientes.clear()
    assert not dg._repetido("Mapa", "texto de antes", 100.0)
    assert dg._repetido("Mapa de argumentos", "texto de antes", 101.0)  # el mismo encargo, más largo: fallo de la web
    assert not dg._repetido("Mapa de argumentos", "texto de antes", 102.0)  # el mismo otra vez: lo resuelve la caché
    assert not dg._repetido("Otro mapa", "otro texto de antes", 103.0)  # otro diagrama de la respuesta
    assert not dg._repetido("Algo distinto", "texto de antes", 200.0)  # pasado el minuto, vale
    dg._recientes.clear()
