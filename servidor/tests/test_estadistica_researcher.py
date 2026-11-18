"""Las métricas del researcher son funciones puras: ningún número lo calcula el modelo."""

from evals.estadistica import cobertura, coste_por_util, media, precision


def test_precision() -> None:
    assert precision(2, 4) == 0.5
    assert precision(0, 0) == 0.0  # sin propuestas, 0, no divide por cero


def test_cobertura() -> None:
    assert cobertura(2, 2) == 1.0
    assert cobertura(1, 4) == 0.25
    assert cobertura(0, 0) == 0.0


def test_coste_por_util() -> None:
    assert coste_por_util(0.04, 2) == 0.02
    assert coste_por_util(0.03, 0) == 0.03  # sin útiles, el coste entero


def test_media() -> None:
    assert media([1.0, 2.0, 3.0]) == 2.0
    assert media([]) == 0.0
