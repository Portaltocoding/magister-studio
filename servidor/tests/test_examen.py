import random
import pytest

from magister.aprender import examen


def _banco(clave: str, n: int) -> list[dict]:
    return [{"pregunta_id": f"{clave}-{i}", "leccion_clave": clave} for i in range(n)]


def test_reparte_entre_lecciones():
    elegidas = examen.elegir({"L1": _banco("L1", 10), "L2": _banco("L2", 10)}, 6, random.Random(1))
    assert len(elegidas) == 6
    assert sum(p["leccion_clave"] == "L1" for p in elegidas) == 3
    assert len({p["pregunta_id"] for p in elegidas}) == 6


def test_si_faltan_preguntas_da_las_que_hay():
    elegidas = examen.elegir({"L1": _banco("L1", 2), "L2": _banco("L2", 1), "L3": []}, 10, random.Random(2))
    assert len(elegidas) == 3


def test_nota_sobre_diez_y_sin_responder_es_fallo():
    assert examen.nota(["perfecta", "bien", "parcial", None]) == round((10 + 8 + 5 + 0) / 4, 1)
    assert examen.nota([]) == 0.0


@pytest.mark.anyio
async def test_las_diapositivas_se_pueden_incrustar_y_lo_demas_no(cliente):
    otra = await cliente.get("/api/salud")
    assert "frame-ancestors 'none'" in otra.headers["content-security-policy"]
    diapos = await cliente.get("/api/materiales/999/fichero/html")
    assert "frame-ancestors 'self'" in diapos.headers["content-security-policy"]


def test_hitos_parciales_cada_tres_y_final():
    from datetime import date

    from magister.plan.examenes import hitos

    orden = [f"L{i}" for i in range(1, 8)]
    # Todas en la misma semana: parciales de tres en tres y la que sobra va al final.
    fechas = {c: date(2026, 11, 16 + i // 3) for i, c in enumerate(orden)}
    h = hitos(orden, fechas)
    assert [x["lecciones"] for x in h[:-1]] == [["L1", "L2", "L3"], ["L4", "L5", "L6"]]
    assert h[-1]["final"] and h[-1]["lecciones"] == orden and h[-1]["fecha"] == "2026-11-19"


def test_hitos_cierran_la_semana_y_plan_corto_solo_final():
    from datetime import date

    from magister.plan.examenes import con_estado, hitos

    fechas = {"L1": date(2026, 11, 20), "L2": date(2026, 11, 21), "L3": date(2026, 11, 23), "L4": date(2026, 11, 24)}
    h = hitos(["L1", "L2", "L3", "L4"], fechas)
    assert [x["lecciones"] for x in h[:-1]] == [["L1", "L2"], ["L3", "L4"]]
    assert [x["final"] for x in hitos(["L1", "L2"], fechas)] == [True]
    marcados = con_estado(h, [({"L1", "L2", "L3"}, 7.5)])
    assert marcados[0]["hecho"] and marcados[0]["nota"] == 7.5 and not marcados[1]["hecho"]
    # Suspendido o en blanco: no cierra el hito, pero se ve la nota.
    suspenso = con_estado(h, [({"L1", "L2"}, 0.0)])[0]
    assert not suspenso["hecho"] and suspenso["nota"] == 0.0


@pytest.mark.anyio
async def test_un_prompt_editado_pasa_a_ser_el_activo(base, monkeypatch):
    from sqlalchemy import select, update

    from magister.api import instalacion
    from magister.cerebro import prompts
    from magister.datos.produccion import PromptActivo
    from magister.datos.sesion import nueva_sesion

    v1 = prompts.Plantilla("prueba", "aaaaaaaaaaaa", "uno")
    v2 = prompts.Plantilla("prueba", "bbbbbbbbbbbb", "dos")
    monkeypatch.setattr(prompts, "ficheros", lambda: [v1])
    await instalacion.sincronizar_prompts()
    # Editas el fichero: la versión nueva manda.
    monkeypatch.setattr(prompts, "ficheros", lambda: [v2])
    await instalacion.sincronizar_prompts()
    assert prompts.ACTIVAS["prueba"].texto == "dos"
    # Vuelves atrás a mano: al rearrancar con el mismo fichero se respeta.
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(PromptActivo).where(PromptActivo.nombre == "prueba").values(version="aaaaaaaaaaaa"))
    await instalacion.sincronizar_prompts()
    async with nueva_sesion() as s:
        assert await s.scalar(select(PromptActivo.version).where(PromptActivo.nombre == "prueba")) == "aaaaaaaaaaaa"
    prompts.ACTIVAS.clear()


@pytest.mark.anyio
async def test_el_examen_se_corrige_en_una_llamada():
    from magister.aprender.corrector import CorreccionExamen, corregir_examen
    from magister.cerebro.estructura import eco

    eco.encolar(CorreccionExamen, [{"correcciones": [
        {"id": "p1", "nota": "bien", "explicacion": "Lo tienes."},
        {"id": "p2", "nota": "fallo", "ideas_ausentes": [], "errores": [], "tipo_error": "concepto", "explicacion": "No."},
    ]}])
    items = [{"id": "p1", "pregunta": "a", "referencia": "b", "respuesta": "c"}, {"id": "p2", "pregunta": "d", "referencia": "e", "respuesta": "f"}]
    hechas, version = await corregir_examen(items)
    assert hechas["p1"].nota == "bien" and version.startswith("corrector_examen@")
    # Un fallo sin decir qué falta pasa a parcial, como en el corrector de una en una.
    assert hechas["p2"].nota == "parcial"
