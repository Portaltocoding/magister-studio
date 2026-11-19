from datetime import date

import pytest
from sse import eventos_sse

pytestmark = pytest.mark.anyio

PETICION = (
    "Quiero preparar bases de datos para una entrevista de backend dentro de un mes. "
    "Sé SQL básico de la universidad. Tengo hora y media al día, entre semana, a partir de las seis de la tarde."
)


@pytest.fixture(autouse=True)
def hoy_fijo(monkeypatch):
    from magister.api import rutas_conversaciones

    monkeypatch.setattr(rutas_conversaciones, "hoy", lambda: date(2026, 11, 9))


async def test_v02_de_la_peticion_al_calendario(cliente) -> None:
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Plan BD", "tipo": "plan"})).json()["id"]
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": PETICION})
    ev = eventos_sse(r.text)
    nombres = [e for e, _ in ev]
    assert nombres[0] == "inicio" and nombres[-1] == "fin"
    fases = [d["nodo"] for e, d in ev if e == "fase"]
    assert fases == ["extraer", "planificar", "calendarizar"]
    plan = next(d for e, d in ev if e == "plan")
    assert plan["fin"] == "2026-11-18" and len(plan["lecciones"]) == 4

    pendiente = (await cliente.get(f"/api/conversaciones/{cid}/propuesta")).json()
    assert pendiente["total_horas"] == 12

    r = await cliente.post(f"/api/conversaciones/{cid}/plan/decision", json={"accion": "aceptar"})
    ev = eventos_sse(r.text)
    assert [d["nodo"] for e, d in ev if e == "fase"] == ["guardar"]
    assert ev[-1][0] == "fin"

    otra = await cliente.post(f"/api/conversaciones/{cid}/plan/decision", json={"accion": "aceptar"})
    assert otra.status_code == 409

    tema_id = (await cliente.get("/api/conversaciones")).json()[0]["tema_id"]
    assert tema_id is not None
    vista = (await cliente.get(f"/api/temas/{tema_id}/plan")).json()
    assert len(vista["lecciones"]) == 4
    assert sum(len(lec["conceptos"]) for lec in vista["lecciones"]) == 5
    sesiones = [x for s in vista["semanas"] for d in s["dias"] for x in d["sesiones"]]
    dias = {d["fecha"] for s in vista["semanas"] for d in s["dias"]}
    assert len(dias) == 8 and vista["fin"] == "2026-11-18"

    # Marcar la primera sesión como hecha y recalcular desde el 12-nov: no se toca lo hecho.
    await cliente.patch(f"/api/sesiones/{sesiones[0]['id']}", json={"estado": "hecha"})
    nueva = (await cliente.post(f"/api/temas/{tema_id}/plan/recalcular", json={"desde": "2026-11-12"})).json()
    estados = [x["estado"] for s in nueva["semanas"] for d in s["dias"] for x in d["sesiones"]]
    assert estados.count("hecha") == 1
    assert nueva["fin"] == "2026-11-20"

    planes = (await cliente.get("/api/planes")).json()
    assert planes[0]["tema"] == "bases de datos"

    # Cambiar el horario recoloca lo pendiente con las horas y la hora de inicio nuevas.
    horario = {"horas_por_dia": [2, 2, 2, 2, 2, 0, 0], "inicio_por_dia": ["09:00"] * 5 + [None, None]}
    r = await cliente.put(f"/api/temas/{tema_id}/plan/horario", json=horario)
    assert r.status_code == 200, r.text
    pendientes = [x for s in r.json()["semanas"] for d in s["dias"] for x in d["sesiones"] if x["estado"] == "pendiente"]
    assert pendientes and all(x["inicio"] >= "09:00" and x["horas"] <= 2 for x in pendientes)
    mal = await cliente.put(f"/api/temas/{tema_id}/plan/horario", json={**horario, "horas_por_dia": [0] * 7})
    assert mal.status_code == 422

    # Borrar el plan se lleva lecciones, calendario y lo demás; la conversación se queda.
    r = await cliente.delete(f"/api/temas/{tema_id}/plan")
    assert r.status_code == 200 and r.json()["planes"] >= 1
    assert (await cliente.get("/api/planes")).json() == []
    assert (await cliente.get(f"/api/temas/{tema_id}/plan")).status_code == 404
    assert (await cliente.delete(f"/api/temas/{tema_id}/plan")).status_code == 404
    assert len((await cliente.get("/api/conversaciones")).json()) == 1
    assert (await cliente.delete("/api/examenes/999")).status_code == 404


async def test_mensaje_con_plan_pendiente_es_un_cambio(cliente) -> None:
    from magister.cerebro.estructura import eco
    from magister.plan.esquemas import Plan

    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Plan", "tipo": "plan"})).json()["id"]
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": PETICION})
    eco.encolar(Plan, ["plan_ok.json"])
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "menos horas"})
    fases = [d["nodo"] for e, d in eventos_sse(r.text) if e == "fase"]
    assert fases[0] == "extraer" and "calendarizar" in fases


async def test_ahora_no_descarta_el_plan_propuesto(cliente) -> None:
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Plan", "tipo": "plan"})).json()["id"]
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": PETICION})
    assert (await cliente.get(f"/api/conversaciones/{cid}/propuesta")).json() is not None
    r = await cliente.post(f"/api/conversaciones/{cid}/plan/decision", json={"accion": "descartar"})
    ev = eventos_sse(r.text)
    assert ev[-1][0] == "fin" and "Vale, sin plan" in "".join(d.get("t", "") for e, d in ev if e == "delta")
    assert (await cliente.get(f"/api/conversaciones/{cid}/propuesta")).json() is None
    # Por escrito también: «déjalo» con un plan propuesto lo descarta en vez de rehacerlo.
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "hazme un plan de bases de datos"})
    assert (await cliente.get(f"/api/conversaciones/{cid}/propuesta")).json() is not None
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "déjalo, sin plan"})
    assert "extraer" not in [d["nodo"] for e, d in eventos_sse(r.text) if e == "fase"]
    assert (await cliente.get(f"/api/conversaciones/{cid}/propuesta")).json() is None


async def test_tema_sin_plan_da_404(cliente) -> None:
    t = (await cliente.post("/api/temas", json={"nombre": "Redes"})).json()
    assert (await cliente.get(f"/api/temas/{t['id']}/plan")).status_code == 404
