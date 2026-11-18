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
    e = actualizar(e, limites(0.05, 0.21, reinicia_s=200), 0.10)
    assert e["muestras"]["sesion"] == [] and e["sesion"] == {"uso": 0.05, "reinicia": 200}


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
