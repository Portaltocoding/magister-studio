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
    assert set(nombres[1:-1]) == {"delta"}
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
    from magister.api import rutas_conversaciones as rc

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
    from magister.api import rutas_conversaciones as rc
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
