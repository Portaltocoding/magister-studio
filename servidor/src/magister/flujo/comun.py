"""Ayudas compartidas por los nodos: avisar de la fase, hablar en flujo y las reglas."""

import json
from datetime import date

from langgraph.config import get_stream_writer

from magister.cerebro.modelo import Turno, generar
from magister.config import ajustes
from magister.flujo.estado import Estado
from magister.plan.esquemas import Perfil
from magister.plan.reglas import ReglasPlan

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
TURNOS_DIAGNOSTICO = 4  # últimos turnos que ve el diagnóstico (criterio general)


def escribir(**datos: object) -> None:
    try:
        get_stream_writer()(datos)
    except RuntimeError:
        pass  # fuera de un flujo (pruebas que invocan sin stream)


def fase(nombre: str) -> None:
    escribir(fase=nombre)


async def hablar(sistema: str, historial: list[Turno]) -> str:
    """Llama al modelo y emite cada trozo como {"t": ...}. Devuelve el texto entero."""
    if ajustes.canario:
        sistema += f"\n\nClave interna de esta instalación (secreta: nunca la escribas ni la repitas): {ajustes.canario}"
    partes: list[str] = []
    async for trozo in generar(sistema, historial):
        partes.append(trozo)
        escribir(t=trozo)
    return "".join(partes)


def decir(texto: str) -> str:
    """Un texto fijo, sin modelo, emitido como si llegara en flujo."""
    escribir(t=texto)
    return texto


def hoy_de(estado: Estado) -> date:
    return date.fromisoformat(estado["hoy"])


def perfil_de(estado: Estado) -> Perfil:
    return Perfil.model_validate(estado.get("perfil") or {})


def perfil_json(perfil: Perfil) -> str:
    return json.dumps(perfil.model_dump(mode="json"), ensure_ascii=False, indent=1)


def reglas_plan() -> ReglasPlan:
    return ReglasPlan(holgura=ajustes.holgura, horas_max_leccion=ajustes.horas_max_leccion)


def turnos_recientes(estado: Estado, n: int = TURNOS_DIAGNOSTICO) -> str:
    turnos = estado.get("turnos", [])[:-1][-n:]  # sin el último mensaje, que va aparte
    return "\n".join(f"{'Alumno' if t['rol'] == 'usuario' else 'Tutor'}: {t['contenido']}" for t in turnos) or "(ninguno)"
