from magister.observar.cuota import GASTO_MINIMO_COTA, cota_prudente, extra_creible


def test_instalacion_nueva_no_dispara_la_estimacion() -> None:
    """La barra al 29 % por el uso de Claude fuera de Magister y Magister con céntimos: antes salía «+111634 %»."""
    assert cota_prudente(0.29, 0.0003) is None


def test_con_gasto_apreciable_la_cota_vale() -> None:
    assert cota_prudente(0.3, GASTO_MINIMO_COTA * 2) == 0.3 / (GASTO_MINIMO_COTA * 2)


def test_sin_calibrar_mas_de_una_ventana_es_sin_datos() -> None:
    assert extra_creible(0.05, 40.0, calibrada=False) is None  # el 200 % de una ventana: no creíble
    assert extra_creible(0.05, 4.0, calibrada=False) == 0.2


def test_calibrada_se_respeta_aunque_pase_de_una_ventana() -> None:
    """Con muestras de verdad, una tanda grande puede no caber: eso sí hay que avisarlo."""
    assert extra_creible(0.5, 4.0, calibrada=True) == 2.0


def test_sin_coste_o_sin_factor_no_hay_cifra() -> None:
    assert extra_creible(0.0, 4.0, calibrada=True) is None
    assert extra_creible(0.1, None, calibrada=False) is None
