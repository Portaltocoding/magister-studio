import pytest

from sse import eventos_sse

pytestmark = pytest.mark.anyio


async def _respuesta(cliente) -> tuple[int, int]:
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Fluidos"})).json()["id"]
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "qué es la viscosidad"})
    return cid, eventos_sse(r.text)[-1][1]["mensaje_id"]


async def test_guardar_respuesta_entera_y_trozo(cliente) -> None:
    cid, mid = await _respuesta(cliente)
    entera = await cliente.post("/api/notas", json={"texto": "Eco: qué es la viscosidad", "mensaje_id": mid, "completa": True})
    assert entera.status_code == 201
    assert entera.json()["conversacion_id"] == cid and entera.json()["origen"] == "Fluidos"
    # La misma respuesta entera otra vez no duplica.
    otra = await cliente.post("/api/notas", json={"texto": "Eco: qué es la viscosidad", "mensaje_id": mid, "completa": True})
    assert otra.json()["id"] == entera.json()["id"]
    trozo = await cliente.post("/api/notas", json={"texto": "  viscosidad  ", "mensaje_id": mid})
    assert trozo.json()["texto"] == "viscosidad" and trozo.json()["completa"] is False
    lista = (await cliente.get("/api/notas")).json()
    assert [n["id"] for n in lista] == [trozo.json()["id"], entera.json()["id"]]


async def test_comentar_borrar_y_sobrevivir_a_la_conversacion(cliente) -> None:
    cid, mid = await _respuesta(cliente)
    n = (await cliente.post("/api/notas", json={"texto": "algo", "mensaje_id": mid})).json()
    c = await cliente.patch(f"/api/notas/{n['id']}", json={"comentario": "repasar"})
    assert c.json()["comentario"] == "repasar"
    # Borras la conversación y la nota se queda, con su título de origen.
    await cliente.delete(f"/api/conversaciones/{cid}")
    queda = (await cliente.get("/api/notas")).json()[0]
    assert queda["conversacion_id"] is None and queda["mensaje_id"] is None and queda["origen"] == "Fluidos"
    assert (await cliente.delete(f"/api/notas/{n['id']}")).status_code == 204
    assert (await cliente.get("/api/notas")).json() == []
    assert (await cliente.delete(f"/api/notas/{n['id']}")).status_code == 404


async def test_nota_vacia_o_de_mensaje_inexistente(cliente) -> None:
    assert (await cliente.post("/api/notas", json={"texto": "   "})).status_code == 422
    assert (await cliente.post("/api/notas", json={"texto": "x", "mensaje_id": 999})).status_code == 404


# La frase real que no hizo nada: guardar y pedir el plan en el mismo mensaje.
ENTREVISTA = ("vale esto es importante guardemoslo como tal , ahora bien me gustaria que me hicieras un plan con fichas "
              "para cada tema y tmb tuviera ahi evaluaciones")


@pytest.mark.parametrize("frase", [ENTREVISTA, "guárdalo", "Guárdame esto", "apúntamelo en mis notas", "esto a mis notas",
                                   "vale, guarda esto", "anota la respuesta", "Guarda lo anterior, porfa",
                                   "guárdamelo para mañana", "apúntamelo en mis notas para el examen del lunes",
                                   "pásalo a mis notas", "añade esto a mis apuntes", "Añádelo a mis notas", "mételo en mis apuntes",
                                   "guarda esto en mis apuntes", "vale, eso a mis notas", "copia la respuesta en mis notas"])
def test_detecta_guardar(frase) -> None:
    from magister.flujo.intencion import pide_guardar

    assert pide_guardar(frase)


@pytest.mark.parametrize("frase", ["¿dónde se guarda la sesión?", "el navegador guarda la cookie", "localStorage guarda los datos",
                                   "cómo guarda React el estado", "explícame closures", "me gustaría entenderlo mejor",
                                   # Agenda, no «Mis notas».
                                   "Apúntalo para mañana a las 18:00", "apúntame el examen del jueves en el calendario",
                                   "guárdame un hueco el 12 para repasar", "anótalo en la agenda",
                                   # Hablar de los apuntes no es guardar en ellos (lo encontró un probador).
                                   "hazme un resumen de todo lo que pone en mis apuntes",
                                   "¿qué dicen mis notas sobre la meiosis?", "según lo que tengo en mis apuntes, ¿cuándo hay quiasmas?",
                                   "busca en mis apuntes la definición de diploteno", "lo que tengo guardado en mis notas",
                                   "explícame lo que he apuntado en mis apuntes", "¿qué pasa en mis apuntes con la meiosis II?"])
def test_no_confunde_guardar(frase) -> None:
    from magister.flujo.intencion import pide_guardar

    assert not pide_guardar(frase)


@pytest.mark.parametrize("frase", [ENTREVISTA, "me harías un roadmap de react", "me gustaría un plan de estudio para mañana",
                                   "quiero que me prepares un plan"])
def test_detecta_plan_en_condicional(frase) -> None:
    from magister.flujo.intencion import pide_plan

    assert pide_plan(frase)


async def test_guardalo_en_el_chat_guarda_la_respuesta_anterior(cliente) -> None:
    cid, mid = await _respuesta(cliente)
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "guárdalo"})
    ev = eventos_sse(r.text)
    notas = [d for e, d in ev if e == "nota"]
    assert notas and notas[0]["mensaje_id"] == mid
    guardada = (await cliente.get("/api/notas")).json()
    assert len(guardada) == 1 and guardada[0]["completa"] and guardada[0]["texto"].startswith("Eco:")
    # Otro «guárdalo» guarda la respuesta más reciente (la que contestó al primero), no la misma otra vez.
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "guárdalo"})
    assert len({n["mensaje_id"] for n in (await cliente.get("/api/notas")).json()}) == 2
