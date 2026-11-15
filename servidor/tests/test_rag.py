import pytest
from langgraph.checkpoint.memory import InMemorySaver

from magister.cerebro.citas import comprobar
from magister.cerebro.contratos import BuscadorFalso
from magister.flujo.grafo import construir_grafo
from magister.flujo.nodos.rag import necesita_reescritura

pytestmark = pytest.mark.anyio


async def correr(g, entrada, hilo="1"):
    nodos, textos, extra = [], [], {}
    async for modo, datos in g.astream(entrada, {"configurable": {"thread_id": hilo}}, stream_mode=["custom", "updates"]):
        if modo == "custom":
            if "fase" in datos:
                nodos.append(datos["fase"])
            elif "t" in datos:
                textos.append(datos["t"])
            elif "citas" in datos:
                extra = datos
    return nodos, "".join(textos), extra


def estudio(mensaje, turnos=None):
    turnos = turnos or [{"rol": "usuario", "contenido": mensaje}]
    return {"conversacion_id": None, "fase": "estudio", "hoy": "2026-11-09", "mensaje": mensaje, "turnos": turnos}


async def test_rama_de_estudio_recupera_y_responde() -> None:
    b = BuscadorFalso()
    nodos, texto, extra = await correr(construir_grafo(InMemorySaver(), b), estudio("qué es una clave primaria"))
    assert nodos == ["recuperar", "responder"]
    assert b.consultas == ["qué es una clave primaria"]
    assert texto == "Eco: qué es una clave primaria "
    assert extra["citas"] == [] and extra["sin_fuentes"] is False


async def test_sin_fuentes_lo_dice() -> None:
    nodos, texto, extra = await correr(construir_grafo(InMemorySaver(), BuscadorFalso(vacio=True)), estudio("qué es TCP"))
    assert texto.startswith("_No lo encuentro en tus fuentes")
    assert extra["sin_fuentes"] is True


async def test_mensaje_dependiente_sin_contexto_aclara() -> None:
    from magister.cerebro.estructura import eco
    from magister.flujo.nodos.rag import Reescritura

    eco.encolar(Reescritura, [{"autonoma": False, "consulta": None, "aclaracion": "¿Qué es «eso»?"}])
    nodos, texto, _ = await correr(construir_grafo(InMemorySaver(), BuscadorFalso()), estudio("¿y eso?"))
    assert nodos == ["reescribir", "aclarar"] and texto == "¿Qué es «eso»?"


async def test_reescritura_con_historial() -> None:
    from magister.cerebro.estructura import eco
    from magister.flujo.nodos.rag import Reescritura

    eco.encolar(Reescritura, [{"autonoma": False, "consulta": "índices parciales en Postgres", "aclaracion": None}])
    b = BuscadorFalso()
    turnos = [{"rol": "usuario", "contenido": "háblame de índices"}, {"rol": "tutor", "contenido": "Vale."},
              {"rol": "usuario", "contenido": "¿y los parciales?"}]
    nodos, _, _ = await correr(construir_grafo(InMemorySaver(), b), estudio("¿y los parciales?", turnos))
    assert nodos[:2] == ["reescribir", "recuperar"] and b.consultas == ["índices parciales en Postgres"]


def test_regla_barata_de_reescritura() -> None:
    assert necesita_reescritura("¿y los parciales?", True)
    assert necesita_reescritura("explícame eso", False)
    assert not necesita_reescritura("Qué es una clave primaria en una tabla relacional", True)


def test_citas_comprobadas() -> None:
    fragmentos = {101: "Una clave primaria identifica cada fila de una tabla. Además no admite nulos."}
    citas = comprobar("La clave primaria identifica cada fila [101]. El cielo es azul [999].", fragmentos)
    por_id = {c.fragmento_id: c for c in citas}
    assert not por_id[101].dudosa and "identifica cada fila" in por_id[101].cita_literal
    assert por_id[999].dudosa
    otra = comprobar("Los gatos maúllan por la noche [101].", fragmentos)
    assert otra[0].dudosa
