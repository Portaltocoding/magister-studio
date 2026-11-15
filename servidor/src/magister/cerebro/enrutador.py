"""El enrutador: las funciones del cerebro piden por tarea, nunca por modelo.

Prioridad: `MAGISTER_MOTOR=eco` (pruebas) > `MAGISTER_MODELO_<TAREA>=motor:modelo` >
`servidor/config/modelos.yaml` > `MAGISTER_MODELO`.
"""

import os
from functools import cache
from pathlib import Path

import yaml

from magister.config import RAIZ_SERVIDOR, ajustes

FICHERO = RAIZ_SERVIDOR / "config" / "modelos.yaml"


class RutaProhibida(Exception):
    pass


@cache
def tabla(ruta: str | None = None) -> dict:
    p = Path(ruta) if ruta else FICHERO
    return yaml.safe_load(p.read_text(encoding="utf-8")) if p.exists() else {"tareas": {}, "prompts": {}, "motores": {}}


def tarea_de_prompt(nombre: str | None) -> str:
    return tabla().get("prompts", {}).get(nombre or "", "conversar")


def ruta(tarea: str | None, prompt: str | None = None) -> tuple[str, str]:
    """(motor, modelo) para una tarea o, si no se dice, para la tarea de la plantilla en uso."""
    if ajustes.motor == "eco":
        return "eco", "eco"
    t = tarea or tarea_de_prompt(prompt)
    conf = tabla().get("tareas", {}).get(t, {})
    variable = os.environ.get(f"MAGISTER_MODELO_{t.upper()}")
    if variable:
        motor, _, modelo = variable.partition(":")
    else:
        motor, modelo = conf.get("motor", ajustes.motor), conf.get("modelo", "defecto")
    if modelo in ("defecto", ""):
        modelo = ajustes.modelo
    if conf.get("datos_personales") and tabla().get("motores", {}).get(motor, {}).get("externo_gratuito"):
        raise RutaProhibida(f"la tarea {t} lleva datos personales y no puede ir al motor externo gratuito {motor}")
    return motor, modelo


def comprobar_al_arrancar() -> None:
    """Falla al arrancar si alguna ruta está prohibida (también por variable de entorno)."""
    for t in tabla().get("tareas", {}):
        ruta(t)
