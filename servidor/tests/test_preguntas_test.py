"""Una ficha de test sin exactamente una opción buena: se pide otra al modelo y, si aun así llega, no se sirve.

Pasó con Topografía · L1: «¿Qué razón te sirve directamente?» llegó con las cuatro opciones malas y quedó activa."""

import pytest

from magister.material import preguntas as mp
from magister.material.modelos import ConceptoMaterial, EntradaMaterial, ListaPreguntas, OpcionTest, PreguntaGen


def _p(opciones: list[OpcionTest], tipo: str = "test") -> PreguntaGen:
    return PreguntaGen(conceptos=["c1"], tipo=tipo, enunciado="¿Cuál?", fantasma="La tangente.", donde="b1", opciones=opciones)


ENTRADA = EntradaMaterial(plan_id=1, leccion_clave="L1", tema="t", titulo="t", objetivos=[],
                          conceptos=[ConceptoMaterial(id="c1", nombre="Seno", nucleo=True)])
NINGUNA = [OpcionTest(texto="La tangente"), OpcionTest(texto="El seno"), OpcionTest(texto="El coseno")]
UNA = [OpcionTest(texto="La tangente", buena=True), OpcionTest(texto="El seno"), OpcionTest(texto="El coseno")]


def test_las_reglas_piden_otra_si_no_hay_exactamente_una_buena() -> None:
    reglas = mp._reglas(ENTRADA, {"b1"})
    errores = reglas(ListaPreguntas(preguntas=[_p(NINGUNA), _p(UNA), _p([], tipo="conceptual")]))
    assert len(errores) == 1 and errores[0].startswith("pregunta 1: tipo test con 3 opciones y 0 buenas")


@pytest.mark.anyio
async def test_una_de_test_mala_se_guarda_en_borrador(base) -> None:
    from sqlalchemy import select

    from magister.datos.material import Pregunta
    from magister.datos.plan import ConceptoFila
    from magister.datos.sesion import nueva_sesion

    from tests.test_material import plan_aceptado

    plan_id = await plan_aceptado()
    entrada = ENTRADA.model_copy(update={"plan_id": plan_id, "conceptos": []})
    async with nueva_sesion() as s:
        cid = await s.scalar(select(ConceptoFila.id).where(ConceptoFila.plan_id == plan_id, ConceptoFila.leccion_clave == "L1"))
    mala, buena = _p(NINGUNA), _p(UNA)
    mala.conceptos = buena.conceptos = [cid]
    await mp.guardar_preguntas(entrada, None, [mala, buena])
    async with nueva_sesion() as s:
        estados = dict((await s.execute(select(Pregunta.id, Pregunta.estado).where(Pregunta.plan_id == plan_id))).all())
    assert estados == {f"p-{plan_id}-L1-01": "borrador", f"p-{plan_id}-L1-02": "activa"}
