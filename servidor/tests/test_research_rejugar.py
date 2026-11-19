"""Rejugar el research sin cuota: con las notas guardadas sale la misma elección, sin llamar al modelo."""

import pytest

from magister.cerebro.estructura import eco
from magister.config import ajustes
from magister.research.fijo import Consultas, Notas, research_fijo
from magister.research.herramientas import Herramientas

from tests.test_research import WebTresConsultas, consulta, nota

pytestmark = pytest.mark.anyio

LECCION = {"clave": "L2", "titulo": "Colas", "tema": "teoría de colas",
           "objetivos": ["Definir una cola", "Calcular la utilización", "Simular una cola"]}


@pytest.fixture(autouse=True)
def limpiar(monkeypatch, tmp_path):
    monkeypatch.setattr(ajustes, "crudo", str(tmp_path / "crudo"))
    eco.vaciar()
    yield
    eco.vaciar()


async def _tarea_sembrada() -> dict:
    eco.encolar(Consultas, [{"consultas": [consulta(1, "uno cola definición"), consulta(2, "dos utilización cola"),
                                           consulta(3, "tres simulación cola")]}])
    eco.encolar(Notas, [{"notas": [
        nota("https://uno0.example/", [1], "Texto propio de https://uno0.example/ sobre colas.", profundidad=2),
        nota("https://uno1.example/", [1, 2], "Texto propio de https://uno1.example/ sobre colas."),
        nota("https://dos0.example/", [2], "una cita que no está en la página"),
        nota("https://tres0.example/", [3], "Texto propio de https://tres0.example/ sobre colas.", tipo="portada"),
    ]}])
    r = await research_fijo(LECCION, Herramientas(WebTresConsultas(), 1, "L2"))
    return {"id": 1, "trayectoria": r["trayectoria"], "estado_agente": {}}


async def test_solo_elegir_no_llama_al_modelo_y_repite_la_eleccion(monkeypatch) -> None:
    from evals import research_rejugar as rj
    from magister.cerebro import estructura
    from magister.research import fijo

    tarea = await _tarea_sembrada()

    async def prohibido(*a, **k):
        raise AssertionError("rejugar --solo-elegir no puede llamar al modelo")

    monkeypatch.setattr(estructura, "estructurar", prohibido)
    monkeypatch.setattr(fijo, "estructurar", prohibido)
    m = rj.rejugar_elegir(tarea, 3)
    assert m["elegidas"] == m["guardadas"] == ["https://uno1.example/"]
    assert m["sin_cubrir"] == [3] and m["cubiertos"] == 2 and m["citas_descartadas"] == 1
    assert m["tipos"] == {"tutorial": 3, "portada": 1}
    # Con otros parámetros cambia la elección, no las notas.
    assert rj.rejugar_elegir(tarea, 3, max_propuestas=1)["propuestas"] == 1
    assert "Cobertura total: 2/3 (67%)" in rj.tabla([(1, "L2", m)])
    assert rj.rejugar_elegir({"trayectoria": [{"accion": "leer", "url": "x"}]}, 3) is None  # de antes del juez


async def test_si_falta_un_crudo_avisa_y_sigue(tmp_path) -> None:
    from pathlib import Path

    from evals import research_rejugar as rj

    tarea = await _tarea_sembrada()
    carpeta = Path(ajustes.crudo)
    leidas = [x for x in tarea["trayectoria"] if x["accion"] == "leer"]
    (carpeta / leidas[0]["crudo_sha"]).unlink()
    avisos: list[str] = []
    lecturas = rj.lecturas_desde_crudo(tarea["trayectoria"], carpeta, avisos.append)
    assert len(avisos) == 1 and "falta el crudo" in avisos[0]
    assert len(lecturas) >= 1 and all(x.crudo_sha for x in lecturas)
