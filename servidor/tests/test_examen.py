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


def test_los_diagramas_de_los_apuntes_pasan_limpios_al_pdf():
    from magister.material.render import limpiar_svg, svg_en_linea

    md = "Antes.\n\n```svg\n<svg viewBox=\"0 0 10 10\">\n  <script>alert(1)</script>\n  <rect onclick=\"x()\" width=\"5\" height=\"5\"/>\n" \
         "  <image href=\"http://x/y.png\"/>\n  <path marker-end=\"url(#a)\"/>\n</svg>\n```\n\nDespués."
    salida = svg_en_linea(md)
    assert '<figure class="diagrama"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' in salida
    assert "script" not in salida and "onclick" not in salida and "image" not in salida
    assert 'url(#a)' in salida and "\n" not in salida.split("<figure")[1].split("</figure>")[0]
    assert limpiar_svg("no es un svg") is None


@pytest.mark.anyio
async def test_borrar_una_fuente(cliente):
    f = (await cliente.post("/api/fuentes", json={"nombre": "Para borrar", "tipo": "pdf", "confianza": 3})).json()
    assert (await cliente.delete(f"/api/fuentes/{f['id']}")).status_code == 204
    assert all(x["id"] != f["id"] for x in (await cliente.get("/api/fuentes")).json())
    assert (await cliente.delete(f"/api/fuentes/{f['id']}")).status_code == 404


@pytest.mark.anyio
async def test_afinar_el_tutor(cliente):
    from magister.flujo.comun import texto_preferencias

    assert (await cliente.get("/api/preferencias")).json()["longitud"] == "normal"
    r = await cliente.put("/api/preferencias", json={"longitud": "breve", "nivel": "experto", "estilo": "analogias",
                                                     "diagramas": False, "tests": True, "opciones": True})
    assert r.status_code == 200
    p = (await cliente.get("/api/preferencias")).json()
    texto = texto_preferencias(p)
    assert "150 palabras" in texto and "avanzado" in texto and "analogía" in texto and "No dibujes" in texto
    assert "test" not in texto



def test_automatizaciones_eligen_lo_que_toca():
    from datetime import date

    from magister.trabajos.automatizar import PREDETERMINADAS, elegir_tarea, es_de_noche

    hoy = date(2026, 11, 16)
    lecciones = [
        {"plan_id": 1, "clave": "L1", "titulo": "a", "fecha": None, "tipos": {"apuntes", "preguntas"}},
        {"plan_id": 1, "clave": "L2", "titulo": "b", "fecha": date(2026, 11, 17), "tipos": set()},
        {"plan_id": 1, "clave": "L3", "titulo": "c", "fecha": date(2026, 11, 25), "tipos": set()},
    ]
    apagadas = {**PREDETERMINADAS}
    assert elegir_tarea(apagadas, lecciones, hoy) is None
    preparar = {**PREDETERMINADAS, "preparar_siguiente": {"activa": True, "dias_antes": 1}}
    lec, tipos, _ = elegir_tarea(preparar, lecciones, hoy)
    assert lec["clave"] == "L2" and tipos == ["apuntes", "preguntas"]  # L3 queda lejos todavía
    video = {**PREDETERMINADAS, "video_al_preparar": {"activa": True, "estilo": "resumen", "minutos": 3}}
    lec, tipos, pref = elegir_tarea(video, lecciones, hoy)
    assert lec["clave"] == "L1" and tipos == ["guion"] and pref["video"]["estilo"] == "resumen"
    from datetime import datetime

    assert es_de_noche(datetime(2026, 11, 16, 3)) and not es_de_noche(datetime(2026, 11, 16, 15))


@pytest.mark.anyio
async def test_automatizaciones_se_guardan(cliente):
    r = (await cliente.get("/api/automatizaciones")).json()
    assert r["reglas"]["preparar_siguiente"]["activa"] is False
    r = await cliente.put("/api/automatizaciones", json={"preparar_siguiente": {"activa": True, "dias_antes": 2}, "solo_de_noche": True})
    assert r.json()["reglas"]["preparar_siguiente"] == {"activa": True, "dias_antes": 2} and r.json()["reglas"]["solo_de_noche"] is True



@pytest.mark.anyio
async def test_instrucciones_y_modos_del_tutor(cliente):
    from magister.flujo.comun import texto_preferencias

    r = await cliente.put("/api/preferencias", json={"instrucciones": ["Pon los ejemplos en Python."],
                                                     "modos": [{"id": "metro", "nombre": "Metro", "para": "Ratos cortos",
                                                                "reglas": ["Como mucho 80 palabras."]}],
                                                     "modo": "metro"})
    assert r.status_code == 200
    # Cambiar solo la longitud no borra lo anterior.
    p = (await cliente.put("/api/preferencias", json={"longitud": "breve"})).json()
    assert p["instrucciones"] == ["Pon los ejemplos en Python."] and p["modo"] == "metro" and p["modos_de_serie"]
    texto = texto_preferencias(p)
    assert "Python" in texto and "«Metro»" in texto and "80 palabras" in texto
    p = (await cliente.put("/api/preferencias", json={"modo": "socratico"})).json()
    assert "Socrático" in texto_preferencias(p)


def test_modo_no_es_plan():
    from magister.flujo.intencion import pide_plan

    assert not pide_plan("crea un modo de aprendizaje para repasar con un plan rápido")
    assert not pide_plan("a partir de ahora hazme el plan de cada respuesta en tres pasos")
    assert pide_plan("hazme un plan de estudio para 3 semanas")


def test_el_nivel_llega_al_material():
    from magister.material.preferencias import texto

    assert "cero" in texto({"nivel": "nada"}) and "avanzado" in texto({"nivel": "avanzado"})


@pytest.mark.anyio
async def test_rehacer_bloque_rechaza_lo_que_no_existe(cliente):
    r = await cliente.post("/api/materiales/999999/bloques/b1/rehacer", json={"como": "sencillo"})
    assert r.status_code == 400



def test_el_indice_reparte_todas_las_lecciones():
    from magister.material.libro import Indice, _reglas

    ix = Indice.model_validate({"temas": [{"nombre": "Conexiones", "lecciones": ["L1"], "trata": ["cómo viaja una petición"]}],
                                "titulos": [{"clave": "L1", "titulo": "Cómo viaja una petición"}]})
    assert _reglas(["L1"])(ix) == []
    assert _reglas(["L1", "L2"])(ix)  # falta L2: se pide otra vez



@pytest.mark.anyio
async def test_estilo_de_examen_y_repasos_de_tema(cliente):
    r = await cliente.put("/api/planes/1/estilo-examen", json={"estilo": "oral"})
    assert r.json()["estilo"] == "oral"
    assert (await cliente.get("/api/planes/1/estilo-examen")).json()["estilo"] == "oral"
    assert (await cliente.put("/api/planes/1/estilo-examen", json={"estilo": "otro"})).status_code == 422
    assert isinstance((await cliente.get("/api/estudio/repasos-de-tema")).json(), list)



@pytest.mark.anyio
async def test_tu_mapa_se_guarda(cliente):
    mapa = {"nodos": [{"id": "a", "texto": "índice", "x": 10, "y": 20}, {"id": "b", "texto": "B-tree", "x": 120, "y": 20}],
            "flechas": [{"de": "a", "a": "b"}, {"de": "b", "a": "a", "etiqueta": "ordena"}]}
    assert (await cliente.put("/api/estudio/77/mapa", json=mapa)).status_code == 200
    assert (await cliente.get("/api/estudio/77/mapa")).json()["flechas"] == [
        {"de": "a", "a": "b", "etiqueta": ""}, {"de": "b", "a": "a", "etiqueta": "ordena"}]
    assert (await cliente.get("/api/estudio/78/mapa")).json() == {"nodos": [], "flechas": []}
