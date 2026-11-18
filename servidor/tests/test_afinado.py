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
