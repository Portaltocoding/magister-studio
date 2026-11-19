import pytest

from sse import eventos_sse

pytestmark = pytest.mark.anyio


async def test_temas_y_conversaciones(cliente) -> None:
    t = await cliente.post("/api/temas", json={"nombre": "Bases de datos"})
    assert t.status_code == 201
    repe = await cliente.post("/api/temas", json={"nombre": "Bases de datos"})
    assert repe.status_code == 409
    c = await cliente.post("/api/conversaciones", json={"titulo": "Claves", "tema_id": t.json()["id"]})
    assert c.status_code == 201
    assert c.json()["tema_id"] == t.json()["id"]
    lista = await cliente.get("/api/conversaciones")
    assert [x["titulo"] for x in lista.json()] == ["Claves"]


async def test_conversacion_inexistente_da_404(cliente) -> None:
    r = await cliente.get("/api/conversaciones/999/mensajes")
    assert r.status_code == 404
    assert r.json() == {"detail": "conversación no encontrada"}
    r = await cliente.post("/api/conversaciones/999/mensajes", json={"contenido": "hola"})
    assert r.status_code == 404


async def test_mensaje_en_flujo_con_eco_y_guardado(cliente) -> None:
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Prueba"})).json()["id"]
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "hola tutor"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    ev = eventos_sse(r.text)
    nombres = [e for e, _ in ev]
    assert nombres[0] == "inicio" and nombres[-1] == "fin"
    # Entre inicio y fin: el texto y, al final, los botones del arnés (acciones).
    assert set(nombres[1:-1]) <= {"delta", "acciones"} and "delta" in nombres
    assert ev[0][1] == {"conversacion_id": cid}
    assert "".join(d["t"] for e, d in ev if e == "delta") == "Eco: hola tutor "
    fin = ev[-1][1]
    assert isinstance(fin["mensaje_id"], int) and fin["ms_total"] >= 0

    m = (await cliente.get(f"/api/conversaciones/{cid}/mensajes")).json()
    assert [(x["rol"], x["estado"]) for x in m] == [("usuario", "completo"), ("tutor", "completo")]
    assert m[1]["contenido"] == "Eco: hola tutor "


async def test_mensaje_vacio_da_422(cliente) -> None:
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Prueba"})).json()["id"]
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": ""})
    assert r.status_code == 422


async def test_el_historial_llega_al_cerebro(cliente, monkeypatch) -> None:
    from magister.flujo import comun as rc

    vistos = []

    async def falso(sistema, historial):
        vistos.append([(t.rol, t.contenido) for t in historial])
        yield "vale"

    monkeypatch.setattr(rc, "generar", falso)
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Prueba"})).json()["id"]
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "uno"})
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "dos"})
    assert vistos[-1] == [("usuario", "uno"), ("tutor", "vale"), ("usuario", "dos")]


async def test_error_del_modelo_es_evento_y_fila(cliente, monkeypatch) -> None:
    from magister.flujo import comun as rc
    from magister.cerebro.modelo import ErrorModelo

    async def roto(sistema, historial):
        raise ErrorModelo("modelo inexistente")
        yield  # pragma: no cover

    monkeypatch.setattr(rc, "generar", roto)
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Prueba"})).json()["id"]
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "hola"})
    ev = eventos_sse(r.text)
    assert ev[-1] == ("error", {"detalle": "modelo inexistente"})
    m = (await cliente.get(f"/api/conversaciones/{cid}/mensajes")).json()
    assert m[-1]["estado"] == "error"


async def test_la_llamada_llega_al_cerebro(cliente, monkeypatch) -> None:
    """Llamada, modo, contexto: llegan al prompt de ese mensaje y no se heredan en el siguiente."""
    from magister.flujo import comun as rc

    sistemas = []
    tareas = []

    async def falso(sistema, historial, tarea=None):
        sistemas.append(sistema)
        tareas.append(tarea)
        yield "vale"

    monkeypatch.setattr(rc, "generar", falso)
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Prueba"})).json()["id"]
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={
        "contenido": "Empecemos", "voz": True, "llamada": True, "modo": "entrevista", "contexto": "Entrevista sobre la lección L2."})
    assert "llamada de voz" in sistemas[-1] and "Entrevista sobre la lección L2." in sistemas[-1] and "Entrevista técnica" in sistemas[-1]
    assert tareas[-1] == "llamada"  # la llamada va por su tarea (Haiku), con el mismo prompt
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "otra cosa"})
    assert "llamada de voz" not in sistemas[-1] and "Entrevista sobre" not in sistemas[-1]
    assert tareas[-1] is None


async def test_borrar_la_conversacion_borra_su_hilo_del_grafo(cliente) -> None:
    from magister.flujo import ejecutar

    cid = (await cliente.post("/api/conversaciones", json={"titulo": "para borrar"})).json()["id"]
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "algo privado"})
    assert await ejecutar.fase_actual(cid) is not None
    assert (await cliente.delete(f"/api/conversaciones/{cid}")).status_code == 204
    assert await ejecutar.fase_actual(cid) is None


def _tutor_lento(monkeypatch, segundos: float = 30):
    """Un tutor que a «lenta» dice dos palabras y se queda razonando (como claude); a lo demás contesta «vale»."""
    import asyncio

    from magister.flujo import comun as rc

    estado = {"empezo": asyncio.Event(), "cortado": False, "vistos": []}

    async def falso(sistema, historial, tarea=None):
        estado["vistos"].append([(t.rol, t.contenido) for t in historial])
        if historial[-1].contenido != "lenta":
            yield "vale"
            return
        yield "a medias "
        estado["empezo"].set()
        try:
            await asyncio.sleep(segundos)
        except asyncio.CancelledError:
            estado["cortado"] = True  # aquí, en el de verdad, cerebro/modelo.py mata a claude
            raise
        yield "y acabada"

    monkeypatch.setattr(rc, "generar", falso)
    return estado


async def test_un_turno_nuevo_corta_el_anterior_de_verdad(cliente, monkeypatch) -> None:
    """Reenvías con una respuesta en marcha: la anterior no sigue razonando a la vez; se corta, se guarda una vez
    como interrumpida y entonces corre la nueva."""
    import asyncio

    estado = _tutor_lento(monkeypatch)
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Prueba"})).json()["id"]
    url = f"/api/conversaciones/{cid}/mensajes"
    primera = asyncio.create_task(cliente.post(url, json={"contenido": "lenta"}))
    await asyncio.wait_for(estado["empezo"].wait(), 10)
    segunda = await asyncio.wait_for(cliente.post(url, json={"contenido": "otra"}), 10)
    primera = await asyncio.wait_for(primera, 10)
    assert estado["cortado"]
    ev = eventos_sse(primera.text)
    assert ev[-1][0] == "cortado" and isinstance(ev[-1][1]["mensaje_id"], int)
    assert eventos_sse(segunda.text)[-1][0] == "fin"
    # La nueva corre cuando la anterior ya está cerrada (lo interrumpido no entra en el historial, como siempre).
    assert estado["vistos"][-1] == [("usuario", "lenta"), ("usuario", "otra")]
    m = (await cliente.get(url)).json()
    assert sorted((x["rol"], x["contenido"], x["estado"]) for x in m) == [
        ("tutor", "a medias ", "interrumpido"), ("tutor", "vale", "completo"),
        ("usuario", "lenta", "completo"), ("usuario", "otra", "completo")]


async def test_otra_conversacion_no_corta_la_respuesta_en_curso(cliente, monkeypatch) -> None:
    """Al cambiar de conversación, la web sigue leyendo la primera a propósito: esa respuesta acaba y se guarda entera."""
    import asyncio

    estado = _tutor_lento(monkeypatch, segundos=0.5)
    uno = (await cliente.post("/api/conversaciones", json={"titulo": "Una"})).json()["id"]
    dos = (await cliente.post("/api/conversaciones", json={"titulo": "Otra"})).json()["id"]
    primera = asyncio.create_task(cliente.post(f"/api/conversaciones/{uno}/mensajes", json={"contenido": "lenta"}))
    await asyncio.wait_for(estado["empezo"].wait(), 10)
    await cliente.post(f"/api/conversaciones/{dos}/mensajes", json={"contenido": "otra"})
    ev = eventos_sse((await asyncio.wait_for(primera, 10)).text)
    assert not estado["cortado"] and ev[-1][0] == "fin"
    tutor = [x for x in (await cliente.get(f"/api/conversaciones/{uno}/mensajes")).json() if x["rol"] == "tutor"]
    assert [(x["contenido"], x["estado"]) for x in tutor] == [("a medias y acabada", "completo")]


async def test_si_te_vas_a_medias_el_turno_se_cancela_entero() -> None:
    """Cierras la pestaña o pulsas Parar: la respuesta SSE se cancela (un cancel scope de anyio) y la tarea del turno,
    con el grafo y su claude, también; no se queda corriendo sola."""
    import asyncio

    import anyio

    from magister.api.flujo import Turno

    cerrado = asyncio.Event()

    async def grafo():
        try:
            yield {"tipo": "delta", "t": "hola"}
            await asyncio.sleep(30)
        finally:
            cerrado.set()

    turno = Turno()
    with anyio.move_on_after(5) as alcance:
        async for _ev in turno.eventos(grafo()):
            alcance.cancel()
    assert cerrado.is_set() and turno._tarea is not None and turno._tarea.done()


async def test_la_respuesta_guarda_su_traza(cliente) -> None:
    """Sin X-Request-Id también: la traza que abre la petición llega al guardado y se cruza con sus llamadas."""
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "traza"})).json()["id"]
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "hola"})
    [tutor] = [m for m in (await cliente.get(f"/api/conversaciones/{cid}/mensajes")).json() if m["rol"] == "tutor"]
    assert tutor["traza_id"] and tutor["traza_id"] == r.headers["x-request-id"]
