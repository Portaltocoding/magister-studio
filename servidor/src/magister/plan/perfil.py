"""Qué falta preguntar en el diagnóstico. Determinista: lo decide el código, no el modelo."""

from magister.plan.esquemas import Perfil

# Primero el hueco que más cambia el plan: qué, para qué, desde dónde, cuánto y hasta cuándo.
ORDEN = ["tema", "objetivo", "nivel", "horas_por_dia", "plazo"]


def huecos(perfil: Perfil) -> list[str]:
    faltan: list[str] = []
    for campo in ORDEN:
        valor = getattr(perfil, campo)
        if campo == "horas_por_dia":
            if not valor or sum(valor) <= 0:
                faltan.append(campo)
        elif campo == "plazo":
            if valor is None and not perfil.sin_plazo:
                faltan.append(campo)
        elif valor is None or (isinstance(valor, str) and not valor.strip()):
            faltan.append(campo)
    return faltan
