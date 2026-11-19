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


@pytest.mark.anyio
async def test_regenerar_no_borra_las_de_test_y_retira_las_sobrantes(base) -> None:
    from sqlalchemy import select

    from magister.datos.material import Pregunta, PreguntaConcepto
    from magister.datos.plan import ConceptoFila
    from magister.datos.sesion import nueva_sesion

    from tests.test_material import plan_aceptado

    plan_id = await plan_aceptado()
    entrada = ENTRADA.model_copy(update={"plan_id": plan_id, "conceptos": []})
    async with nueva_sesion() as s:
        cids = (await s.scalars(select(ConceptoFila.id).where(ConceptoFila.plan_id == plan_id))).all()
    cid, otro = cids[0], cids[-1]
    assert cid != otro
    tres = [_p(UNA) for _ in range(3)]
    for p in tres:
        p.conceptos = [cid]
    await mp.guardar_preguntas(entrada, None, tres)
    test_id = f"p-{plan_id}-L1-t01"
    async with nueva_sesion() as s, s.begin():
        s.add(Pregunta(id=test_id, plan_id=plan_id, leccion_clave="L1", tipo="test", enunciado="¿Test?", fantasma="x",
                       donde="b1", opciones=[o.model_dump() for o in UNA], estado="activa"))
        await s.flush()
        s.add(PreguntaConcepto(pregunta_id=test_id, plan_id=plan_id, concepto_id=cid))
    nueva = _p(UNA)
    nueva.enunciado, nueva.conceptos = "¿Otra?", [otro]
    await mp.guardar_preguntas(entrada, None, [nueva])
    async with nueva_sesion() as s:
        filas = {p.id: p for p in (await s.scalars(select(Pregunta).where(Pregunta.plan_id == plan_id))).all()}
        rel = set((await s.execute(select(PreguntaConcepto.pregunta_id, PreguntaConcepto.concepto_id))).all())
    base_id = f"p-{plan_id}-L1"
    assert {i: p.estado for i, p in filas.items()} == {
        f"{base_id}-01": "activa", f"{base_id}-02": "retirada", f"{base_id}-03": "retirada", test_id: "activa"}
    assert filas[f"{base_id}-01"].enunciado == "¿Otra?"
    assert (f"{base_id}-01", otro) in rel and (f"{base_id}-01", cid) not in rel
    assert (test_id, cid) in rel
