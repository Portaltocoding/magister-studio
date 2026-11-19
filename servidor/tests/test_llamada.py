"""La llamada de voz: sus reglas en el prompt, los pasos que se salta y un turno cada vez por conversación."""

import asyncio

import pytest

from magister.flujo.comun import LLAMADA, VOZ, sistema_de_estudio
from magister.flujo.nodos.rag import hacer_recuperar, reescribir

pytestmark = pytest.mark.anyio


async def test_en_la_llamada_mandan_sus_reglas_y_no_las_de_voz() -> None:
    sistema = await sistema_de_estudio("BASE", {"llamada": True, "voz": True})
    assert LLAMADA in sistema
    assert VOZ not in sistema  # «80 a 150 palabras» ganaba a «2 a 4 frases» y salían monólogos
    assert VOZ in await sistema_de_estudio("BASE", {"voz": True})


async def test_el_asesor_no_arrastra_el_modo_ni_la_longitud_del_chat(monkeypatch) -> None:
    from magister.flujo import comun as rc

    async def preferencias():
        return {"modo": "socratico", "longitud": "detallada", "nivel": "experto", "instrucciones": ["Pon los ejemplos en Python."],
                "aprendido": ["Menos rodeos."], "modos": []}

    async def nada(*_a, **_k):
        return []

    monkeypatch.setattr(rc, "preferencias_tutor", preferencias)
    for nombre in ("lecciones_del_alumno", "conceptos_flojos", "conceptos_dominados"):
        monkeypatch.setattr(rc, nombre, nada)
    asesor = await sistema_de_estudio("BASE", {"conversacion_id": 1, "asesor": True})
    assert "Socrático" not in asesor and "detallada" not in asesor
    assert "Python" in asesor and "Menos rodeos" in asesor and "nivel avanzado" in asesor
    assert "manda sobre cualquier modo o longitud" in rc.ASESOR
    # En el chat, el modo sigue valiendo.
    assert "Socrático" in await sistema_de_estudio("BASE", {"conversacion_id": 1})


async def test_el_asesor_contesta_corto_sobre_la_pantalla_y_sus_conversaciones_no_salen_en_el_historial(cliente, monkeypatch) -> None:
    from magister.flujo import comun as rc
    from magister.flujo.comun import ASESOR

    sistemas = []

    async def falso(sistema, historial, tarea=None):
        sistemas.append(sistema)
        yield "Pulsa «Detallar este nivel»."

    monkeypatch.setattr(rc, "generar", falso)
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Asesor · Proyectos", "tipo": "asesor"})).json()["id"]
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={
        "contenido": "¿qué hago ahora?", "asesor": True, "contexto": "Sección: Proyectos\n<pantalla>Nivel 2 esbozado</pantalla>"})
    assert ASESOR in sistemas[-1] and "Lo que tiene en pantalla ahora" in sistemas[-1] and "Nivel 2 esbozado" in sistemas[-1]
    assert "bloque `acciones`" in sistemas[-1]  # puede proponer botones (rutas o pasos que están en pantalla)
    assert cid not in [c["id"] for c in (await cliente.get("/api/conversaciones")).json()]
    assert (await cliente.get(f"/api/conversaciones/{cid}/mensajes")).json()[-1]["contenido"] == "Pulsa «Detallar este nivel»."


async def test_en_la_llamada_no_se_reescribe_ni_se_busca_en_una_leccion() -> None:
    estado = {"mensaje": "¿y eso?", "turnos": [{"rol": "usuario", "contenido": "a"}, {"rol": "tutor", "contenido": "b"}], "llamada": True}
    assert await reescribir(estado) == {"consulta": "¿y eso?", "aclaracion": None}

    class SinUsar:
        async def buscar(self, *a, **k):  # pragma: no cover
            raise AssertionError("no debía buscar")

    r = await hacer_recuperar(SinUsar())({"llamada": True, "leccion_clave": "L1", "mensaje": "hola"})
    assert r["recuperados"] == []


def test_la_llamada_tiene_su_tarea_y_corregir_la_suya() -> None:
    from magister.cerebro.enrutador import ruta
    from magister.flujo.comun import tarea_de

    assert tarea_de({}) is None
    assert tarea_de({"llamada": True}) == "llamada"
    assert tarea_de({"llamada": True, "corregir": True}) == "corregir"
    if ruta("llamada")[0] != "eco":  # con el motor de pruebas todo es eco
        assert ruta("corregir")[1] != "haiku"  # juzgar una respuesta, nunca con el pequeño


async def test_los_turnos_de_la_llamada_no_pasan_por_el_juez_de_explicaciones(monkeypatch) -> None:
    from magister.cerebro.modelo import Llamada
    from magister.config import ajustes
    from magister.observar import registro
    from magister.trabajos import cola

    encolados = []

    async def encolar(tipo, *a, **k):
        encolados.append(tipo)

    monkeypatch.setattr(cola, "encolar", encolar)
    monkeypatch.setattr(ajustes, "juez_muestra", 1.0)
    comun = dict(motor="cli", modelo_pedido="haiku", sistema="s", prompt_nombre="conversar", prompt_version="v", traza_id="t1",
                 respuesta="Un índice guarda las claves ordenadas para no leer la tabla entera. " * 12)
    await registro.encolar_juez(Llamada(funcion="llamada", **comun))
    assert encolados == []
    await registro.encolar_juez(Llamada(funcion="conversar", **comun))
    assert encolados == ["juez_online"]


@pytest.mark.anyio
async def test_dos_turnos_a_la_vez_no_razonan_a_la_vez(cliente, monkeypatch) -> None:
    from magister.flujo import comun as rc

    vistos = []
    a_la_vez = {"ahora": 0, "maximo": 0}

    async def lento(sistema, historial, tarea=None):
        vistos.append([(t.rol, t.contenido) for t in historial])
        a_la_vez["ahora"] += 1
        a_la_vez["maximo"] = max(a_la_vez["maximo"], a_la_vez["ahora"])
        try:
            await asyncio.sleep(0.3)
            yield f"respuesta {len(vistos)}"
        finally:
            a_la_vez["ahora"] -= 1

    monkeypatch.setattr(rc, "generar", lento)
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Prueba"})).json()["id"]
    await asyncio.gather(
        cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "uno"}),
        cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "dos"}),
    )
    # El que llega después corta al anterior: nunca hay dos razonando a la vez, y su pregunta va al final.
    # (Si el grafo de esa conversación trae un diagnóstico a medias, contesta sin pasar por `generar`: por eso «<=».)
    assert a_la_vez["maximo"] <= 1
    assert all(v[-1][0] == "usuario" for v in vistos)
    m = (await cliente.get(f"/api/conversaciones/{cid}/mensajes")).json()
    assert sorted(x["contenido"] for x in m if x["rol"] == "usuario") == ["dos", "uno"]
    assert sum(1 for x in m if x["rol"] == "tutor" and x["estado"] == "completo") <= 1


@pytest.mark.anyio
async def test_en_la_llamada_la_pregunta_ampliada_sustituye_a_la_cortada(cliente, monkeypatch) -> None:
    from magister.flujo import comun as rc

    vistos = []

    async def mudo(sistema, historial, tarea=None):
        vistos.append([(t.rol, t.contenido) for t in historial])
        if len(vistos) == 1:
            return  # cortada antes de decir nada: no queda respuesta
        yield "vale"

    monkeypatch.setattr(rc, "generar", mudo)
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Prueba"})).json()["id"]
    base = {"llamada": True, "voz": True, "leccion_clave": None}
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "qué es una clave", **base})
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "qué es una clave de idempotencia", **base})
    assert vistos[-1] == [("usuario", "qué es una clave de idempotencia")]
    mensajes = (await cliente.get(f"/api/conversaciones/{cid}/mensajes")).json()
    assert [m["contenido"] for m in mensajes] == ["qué es una clave de idempotencia", "vale"]


@pytest.mark.anyio
async def test_lo_que_no_cuenta_se_ve_en_los_mensajes(cliente, monkeypatch) -> None:
    from magister.flujo import comun as rc

    async def falso(sistema, historial, tarea=None):
        yield "vale"

    monkeypatch.setattr(rc, "generar", falso)
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Prueba"})).json()["id"]
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "probando", "cuenta": False})
    assert {m["cuenta"] for m in (await cliente.get(f"/api/conversaciones/{cid}/mensajes")).json()} == {False}
    assert (await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "   "})).status_code == 422


def test_solo_se_juzgan_las_explicaciones() -> None:
    from magister.observar.registro import es_explicacion

    # Turnos del chat que no explican nada: el saludo de un simulacro, una nota, un «sí, eso es».
    assert not es_explicacion("Hola, soy tu entrevistador y vamos a repasar HTTP. Primera pregunta: ¿qué es un verbo?")
    assert not es_explicacion("Te pongo un 5 sobre 10. " * 10)
    assert not es_explicacion(None)
    # Mayoría de preguntas: es un examen, no una explicación.
    assert not es_explicacion("¿Qué devuelve un GET? ¿Y un POST? ¿Por qué? " * 20)
    explicacion = "Leer la tabla entera cuesta lo mismo encuentres o no la fila. Para no pagarlo, el índice guarda las claves ordenadas. " * 6
    assert es_explicacion(explicacion) and es_explicacion(explicacion + "¿Lo vemos con un ejemplo?")
