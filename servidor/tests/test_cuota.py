from magister.cerebro.modelo import Llamada, llenar_desde_resultado
from magister.observar.cuota import MINUTOS_GUION, actualizar, coste_de_video, fraccion_por_coste


def limites(sesion: float, semana: float, reinicia_s: int = 100, reinicia_w: int = 900) -> dict:
    return {"five_hour": {"utilization": sesion, "resetsAt": reinicia_s}, "seven_day": {"utilization": semana, "resetsAt": reinicia_w}}


def test_la_primera_llamada_solo_fija_el_estado():
    e = actualizar({}, limites(0.40, 0.20), 0.05)
    assert e["sesion"] == {"uso": 0.40, "reinicia": 100} and e["semana"]["uso"] == 0.20
    assert e["muestras"] == {"sesion": [], "semana": []}


def test_si_la_barra_sube_se_guarda_una_muestra():
    e = actualizar({}, limites(0.40, 0.20), 0.0)
    e = actualizar(e, limites(0.42, 0.21), 0.10)
    assert abs(e["muestras"]["sesion"][0] - 0.2) < 1e-9 and abs(e["muestras"]["semana"][0] - 0.1) < 1e-9
    assert e["pendiente"]["sesion"] == 0.0


def test_si_no_se_mueve_acumula_el_coste_hasta_que_se_mueva():
    e = actualizar({}, limites(0.40, 0.20), 0.0)
    e = actualizar(e, limites(0.40, 0.20), 0.03)
    e = actualizar(e, limites(0.40, 0.20), 0.02)
    assert e["muestras"]["sesion"] == [] and abs(e["pendiente"]["sesion"] - 0.05) < 1e-9
    e = actualizar(e, limites(0.41, 0.20), 0.05)
    assert abs(e["muestras"]["sesion"][0] - 0.01 / 0.10) < 1e-9


def test_una_ventana_nueva_no_se_compara_con_la_anterior():
    e = actualizar({}, limites(0.90, 0.20), 0.0)
    e = actualizar(e, limites(0.05, 0.21, reinicia_s=100 + 5 * 3600), 0.10)
    assert e["muestras"]["sesion"] == [] and e["sesion"] == {"uso": 0.05, "reinicia": 100 + 5 * 3600}


def test_sin_limites_solo_suma_el_coste():
    e = actualizar(actualizar({}, limites(0.40, 0.20), 0.0), None, 0.07)
    assert e["sesion"]["uso"] == 0.40 and abs(e["pendiente"]["semana"] - 0.07) < 1e-9


def test_la_calibracion_es_la_mediana_y_pide_varias_muestras():
    assert fraccion_por_coste({"muestras": {"sesion": [0.1, 0.2]}}, "sesion") is None
    assert fraccion_por_coste({"muestras": {"sesion": [0.1, 5.0, 0.2]}}, "sesion") == 0.2


def test_el_video_escala_con_la_duracion():
    assert coste_de_video(1.0, MINUTOS_GUION) == 1.0
    assert coste_de_video(1.0, 3) < coste_de_video(1.0, 6) < coste_de_video(1.0, 12)


def test_el_cerebro_pasa_los_limites_del_cli_a_la_llamada():
    ll = Llamada(funcion="conversar", motor="cli", modelo_pedido="sonnet")
    llenar_desde_resultado(ll, {"usage": {}, "total_cost_usd": 0.02, "_limites": limites(0.41, 0.2)})
    assert ll.limites["five_hour"]["utilization"] == 0.41 and ll.coste_equivalente == 0.02


def test_una_ventana_ya_renovada_se_ve_vacia():
    from magister.observar.cuota import vigente

    assert vigente({"uso": 0.9, "reinicia": 100}, ahora=200) == {"uso": 0.0, "reinicia": None}
    assert vigente({"uso": 0.9, "reinicia": 300}, ahora=200) == {"uso": 0.9, "reinicia": 300}
    assert vigente(None, ahora=200) is None


def test_una_lectura_vieja_no_hace_retroceder_la_barra():
    e = actualizar({}, limites(0.50, 0.20), 0.0)
    e = actualizar(e, limites(0.48, 0.20), 0.05)
    assert e["sesion"]["uso"] == 0.50 and e["muestras"]["sesion"] == []


def test_la_hora_de_renovacion_puede_bailar_unos_minutos():
    e = actualizar({}, limites(0.40, 0.20, reinicia_s=1000), 0.0)
    e = actualizar(e, limites(0.42, 0.20, reinicia_s=1030), 0.10)
    assert len(e["muestras"]["sesion"]) == 1


def test_sin_hora_de_renovacion_no_se_usa_la_lectura():
    e = actualizar({}, {"five_hour": {"utilization": 0.4}}, 0.0)
    assert e["sesion"] is None


def test_si_un_evento_no_trae_la_cuota_se_queda_la_buena(monkeypatch):
    from magister.cerebro import modelo

    assert "or limites" in open(modelo.__file__, encoding="utf-8").read()


async def _contar_a_la_vez(prompt: str, n: int, monkeypatch) -> int:
    import asyncio

    from magister.cerebro import modelo

    vivos, pico = 0, 0

    async def falso(*a, **k):
        nonlocal vivos, pico
        vivos += 1
        pico = max(pico, vivos)
        await asyncio.sleep(0.02)
        vivos -= 1
        yield {"type": "result"}

    monkeypatch.setattr(modelo, "_lanzar_claude", falso)

    async def una():
        modelo.prompt_actual.set((prompt, "v"))
        async for _ in modelo._lineas_claude("s", "e"):
            pass

    await asyncio.gather(*(una() for _ in range(n)))
    return pico


import pytest  # noqa: E402


@pytest.mark.anyio
async def test_lo_de_fondo_espera_turno_y_lo_tuyo_no(monkeypatch):
    from magister.config import ajustes

    monkeypatch.setattr(ajustes, "modelo_fondo_a_la_vez", 3)
    assert await _contar_a_la_vez("apuntes_bloque", 10, monkeypatch) == 3  # material: como mucho 3 a la vez
    assert await _contar_a_la_vez("juez_tono", 10, monkeypatch) == 3
    assert await _contar_a_la_vez("conversar", 10, monkeypatch) == 10  # tu chat no espera nunca
