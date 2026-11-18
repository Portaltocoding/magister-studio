"""«Tengo examen de X el día tal»: eso pide un plan (el plazo es el examen), aunque no diga «plan». Y un concepto suelto
(«explícame a dividir») sigue siendo una explicación, no un roadmap."""

import pytest

from magister.cerebro.prompts import cargar
from magister.flujo.intencion import pide_plan


@pytest.mark.parametrize("frase", [
    "tengo un examen de estadística el 12 de diciembre",
    "tengo examen de derecho civil el día 20, prepárame",
    "el lunes tengo examen de topografía, ayúdame a prepararlo",
    "quiero preparar el examen de filosofía del 15 de enero",
    "me examino de bases de datos en tres semanas",
    "tengo examen mañana de historia",
])
def test_un_examen_con_fecha_pide_plan(frase: str) -> None:
    assert pide_plan(frase), frase


@pytest.mark.parametrize("frase", [
    "explícame a dividir",
    "quiero aprender a dividir",
    "¿cómo es un examen tipo test?",
    "tengo examen mañana, explícame las derivadas",  # pide una explicación ya: se contesta, no se planifica
    "en el examen de ayer me cayó la usucapión",
])
def test_lo_demas_no(frase: str) -> None:
    assert not pide_plan(frase), frase


def test_el_planificador_ajusta_el_tamano_y_sabe_de_examenes() -> None:
    texto = cargar("planificar").texto
    assert "no el presupuesto" in texto and "nunca lo que tiene libre" in texto and "simulacro" in texto
    assert "víspera del examen" in cargar("extraer_perfil").texto
