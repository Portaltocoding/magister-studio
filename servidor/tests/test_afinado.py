"""El círculo entero: valoras con motivos, Magister aprende la regla, la regla entra en la generación y se puede quitar."""

import pytest

from magister.flujo.comun import preferencias_tutor, texto_preferencias
from magister.tono.confianza import MOTIVOS


@pytest.mark.anyio
async def test_valorar_con_motivos_ensena_una_regla_que_llega_a_la_generacion(cliente) -> None:
    inicial = (await cliente.get("/api/afinado")).json()
    assert inicial["reglas"] == [] and inicial["revisa"] > 0.75
    assert {m["id"] for m in inicial["motivos"]} == set(MOTIVOS)

    for i in range(3):
        r = await cliente.post(f"/api/trazas/t{i}/feedback", json={"bien": False, "motivos": ["sin_ejemplo"]})
        assert r.status_code == 200

    afinado = (await cliente.get("/api/afinado")).json()
    regla = MOTIVOS["sin_ejemplo"][2]
    assert afinado["reglas"] == [{"motivo": "sin_ejemplo", "texto": regla}]
    razonamiento = next(d for d in afinado["dimensiones"] if d["id"] == "razonamiento")
    economia = next(d for d in afinado["dimensiones"] if d["id"] == "economia")
    assert razonamiento["confianza"] <= economia["confianza"]

    # La regla aprendida entra en el prompt del tutor.
    assert regla in texto_preferencias(await preferencias_tutor())

    # Quitarla la saca y no vuelve aunque se repita el motivo.
    afinado = (await cliente.post("/api/afinado/reglas/sin_ejemplo/quitar")).json()
    assert afinado["reglas"] == []
    await cliente.post("/api/trazas/t9/feedback", json={"bien": False, "motivos": ["sin_ejemplo"]})
    assert (await cliente.get("/api/afinado")).json()["reglas"] == []


@pytest.mark.anyio
async def test_los_motivos_desconocidos_no_rompen_la_valoracion(cliente) -> None:
    r = await cliente.post("/api/trazas/tx/feedback", json={"bien": False, "motivos": ["inventado"]})
    assert r.status_code == 200


def test_el_asesor_contesta_con_el_modelo_rapido() -> None:
    from magister.cerebro.enrutador import ruta, tabla
    from magister.flujo.comun import tarea_de

    tabla.cache_clear()
    assert tarea_de({"asesor": True}) == "asesor"
    assert tarea_de({"asesor": True, "llamada": True}) == "asesor"
    assert tarea_de({}) is None
    assert tabla()["tareas"]["asesor"]["modelo"] == "haiku"
    motor, _ = ruta("asesor")
    assert motor in ("cli", "eco")


@pytest.mark.anyio
async def test_votar_dos_veces_lo_mismo_no_cuenta_doble(cliente) -> None:
    for _ in range(3):
        await cliente.post("/api/trazas/misma/feedback", json={"bien": False, "motivos": ["largo"]})
    # Tres votos iguales a la misma respuesta son uno: no basta para aprender una regla (hacen falta dos).
    assert (await cliente.get("/api/afinado")).json()["reglas"] == []


@pytest.mark.anyio
async def test_quitar_una_regla_que_no_existe_es_un_error(cliente) -> None:
    r = await cliente.post("/api/afinado/reglas/inventado/quitar")
    assert r.status_code == 422


@pytest.mark.anyio
async def test_sin_coste_conocido_no_se_estima(cliente) -> None:
    r = (await cliente.get("/api/cuota/estimar", params={"accion": "diapositivas"})).json()
    assert r["sesion"]["extra"] is None and r["semana"]["extra"] is None


@pytest.mark.anyio
async def test_juez_muestra_cero_apaga_el_juez_online(monkeypatch) -> None:
    from magister.cerebro.modelo import Llamada
    from magister.config import ajustes
    from magister.observar import registro
    from magister.trabajos import cola

    encolados = []

    async def encolar(tipo, *a, **k):
        encolados.append(tipo)

    monkeypatch.setattr(cola, "encolar", encolar)
    monkeypatch.setattr(ajustes, "juez_muestra", 0.0)
    await registro.encolar_juez(Llamada(funcion="conversar", motor="cli", modelo_pedido="m", sistema="s", prompt_nombre="conversar",
                                        prompt_version="v", traza_id="t-cero"))
    assert encolados == []
