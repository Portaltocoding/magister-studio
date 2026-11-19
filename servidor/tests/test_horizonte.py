"""El research automático (encargo 8; ADR-0021, nota del 19-11-2026): solo lo que empieza pronto, aún no tiene fuentes
y de verdad las necesita, y como mucho 2 por vuelta."""

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from magister.plan.horizonte import (cuando_empiezas, lecciones_a_investigar, lecciones_a_juzgar, motivo_automatico,
                                     objetivos_a_buscar, texto_automatico)

HOY = date(2026, 11, 19)  # jueves


def _plan_de_9(sin_material: bool = True, necesita: str | None = "imprescindible") -> list[dict]:
    # Topografía: 9 lecciones repartidas en 3 semanas, una cada dos o tres días.
    return [{"clave": f"L{i}", "primera_sesion": HOY + timedelta(days=round(i * 2.3)), "sin_material": sin_material,
             "necesita_fuentes": necesita} for i in range(1, 10)]


def test_solo_los_proximos_7_dias_y_como_mucho_2() -> None:
    lecciones = _plan_de_9()
    assert [x["clave"] for x in lecciones if x["primera_sesion"] <= HOY + timedelta(days=7)] == ["L1", "L2", "L3"]
    assert lecciones_a_investigar(lecciones, {}, HOY) == ["L1", "L2"]
    assert lecciones_a_investigar(lecciones, {}, HOY, max_por_vuelta=5) == ["L1", "L2", "L3"]


def test_que_tareas_se_relanzan() -> None:
    lecciones = _plan_de_9()
    tareas = {"L1": ("cortada", HOY - timedelta(days=1)), "L2": ("acabada", HOY - timedelta(days=1)),
              "L3": ("en_curso", HOY)}
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5) == ["L1"]
    # Una acabada de hace más de 14 días, y la lección sigue sin material: otra vez.
    tareas["L2"] = ("acabada", HOY - timedelta(days=15))
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5) == ["L1", "L2"]


def test_una_busqueda_que_fallo_se_repite_al_dia_siguiente_y_no_quema_14_dias() -> None:
    lecciones = _plan_de_9()
    ayer = HOY - timedelta(days=1)
    tareas = {"L1": ("cortada", HOY, "error: la búsqueda web no respondió"),
              "L2": ("cortada", HOY, "no se pudieron escribir consultas: el freno"),
              "L3": ("cortada", HOY, "la API se reinició")}
    # Fallaron hoy: no se gasta otra consulta en cada vuelta; la que cortó un reinicio, sí se relanza.
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5) == ["L3"]
    tareas = {"L1": ("cortada", ayer, "error: la búsqueda web no respondió"), "L2": ("cortada", ayer, "se pasó de 900 s"),
              "L3": ("acabada", ayer, "ninguna página legible")}
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5) == ["L1", "L2"]
    # Lo «viejo» entra como argumento (MAGISTER_RESEARCH_VIEJA_DIAS).
    assert lecciones_a_investigar(lecciones, tareas, HOY, max_por_vuelta=5, vieja_dias=0) == ["L1", "L2", "L3"]


def test_conviene_no_se_busca_solo_salvo_que_falte_informacion() -> None:
    lecciones = _plan_de_9(necesita="conviene")
    # «Conviene» sin más es una sugerencia: la lanzas tú.
    assert lecciones_a_investigar(lecciones, {}, HOY, max_por_vuelta=5) == []
    assert motivo_automatico(lecciones[0]) == "sugerencia"
    # Con la cobertura conocida y objetivos sin ninguna fuente, falta información: se busca, y solo lo que falta.
    lecciones[1]["sin_fuente"] = [3, 1]
    lecciones[2]["sin_fuente"] = []  # se sabe y no falta nada
    lecciones[0]["sin_fuente"] = None  # no se sabe: no es que falte
    assert lecciones_a_investigar(lecciones, {}, HOY, max_por_vuelta=5) == ["L2"]
    assert objetivos_a_buscar(lecciones[1]) == [1, 3]
    assert objetivos_a_buscar({**lecciones[1], "necesita_fuentes": "imprescindible"}) is None  # todos
    # Lo que ya tiene material no entra aunque se sepa que falta algo.
    lecciones[1]["sin_material"] = False
    assert lecciones_a_investigar(lecciones, {}, HOY, max_por_vuelta=5) == []


def test_sin_etiqueta_no_se_busca_por_si_acaso_primero_se_juzga() -> None:
    lecciones = _plan_de_9(necesita=None)
    lecciones[3]["necesita_fuentes"] = "rara"  # un valor que no se entiende tampoco cuenta como juzgado
    assert lecciones_a_investigar(lecciones, {}, HOY, max_por_vuelta=5) == []
    assert motivo_automatico(lecciones[0]) == "sin_juzgar"
    # Se juzgan las que se investigarían si la tuvieran: en el horizonte, sin material y sin búsqueda reciente.
    assert lecciones_a_juzgar(lecciones, {}, HOY) == ["L1", "L2", "L3"]
    assert lecciones_a_juzgar(lecciones, {}, HOY, horizonte_dias=10) == ["L1", "L2", "L3", "L4"]
    assert lecciones_a_juzgar(lecciones, {"L1": ("acabada", HOY - timedelta(days=1))}, HOY) == ["L2", "L3"]
    assert lecciones_a_juzgar(lecciones, {}, HOY, maximo=1) == ["L1"]
    assert lecciones_a_juzgar(_plan_de_9(sin_material=False, necesita=None), {}, HOY) == []
    assert lecciones_a_juzgar(_plan_de_9(), {}, HOY) == []  # ya juzgadas


def test_con_material_tuyo_el_no_no_manda_pero_tampoco_se_busca_solo() -> None:
    lecciones = _plan_de_9()
    lecciones[0]["necesita_fuentes"] = "no"
    assert lecciones_a_investigar(lecciones, {}, HOY) == ["L2", "L3"]
    # Con material tuyo, el «no» se lee «conviene»: se busca a mano, no solo.
    assert lecciones_a_investigar(lecciones, {}, HOY, material_propio=True) == ["L2", "L3"]
    assert motivo_automatico(lecciones[0], material_propio=True) == "sugerencia"


def test_lo_que_se_dice_en_el_roadmap() -> None:
    lec = {"clave": "L1", "sin_material": False, "necesita_fuentes": "imprescindible"}
    assert texto_automatico(lec) == "Tu material ya la cubre: no se busca sola. Si quieres más, «Buscar fuentes»."
    # Con material tuyo y un «no» guardado, el chip dice que tu material manda: la frase no le lleva la contraria.
    assert "No hace falta" not in texto_automatico({**lec, "necesita_fuentes": "no"}, material_propio=True)
    lec["sin_material"] = True
    assert texto_automatico(lec).startswith("Hacen falta: se buscan solas")
    assert texto_automatico({**lec, "necesita_fuentes": "conviene"}) == "Te vendría bien: búscalas cuando quieras."
    assert texto_automatico({**lec, "necesita_fuentes": "no"}) == "No hace falta: se explica bien sin fuentes."
    assert "modelo barato" in texto_automatico({**lec, "necesita_fuentes": None})
    assert texto_automatico({**lec, "necesita_fuentes": "conviene", "sin_fuente": [2]}).startswith("Faltan fuentes")
    assert "apagado" in texto_automatico(lec, automatico=False)


def test_lo_que_tiene_material_o_esta_marcado_no_se_salta_y_lo_atrasado_va_primero() -> None:
    assert lecciones_a_investigar(_plan_de_9(sin_material=False), {}, HOY) == []
    lecciones = _plan_de_9()
    lecciones[0]["necesita_fuentes"] = "no"
    assert lecciones_a_investigar(lecciones, {}, HOY) == ["L2", "L3"]
    # La llevas atrasada (su sesión pendiente era ayer): sigue por estudiar y va la primera.
    lecciones[2]["primera_sesion"] = HOY - timedelta(days=1)
    assert lecciones_a_investigar(lecciones, {}, HOY) == ["L3", "L2"]
    lecciones[1]["primera_sesion"] = lecciones[2]["primera_sesion"] = None  # sin sesiones pendientes: ya estudiada
    assert lecciones_a_investigar(lecciones, {}, HOY) == []


def test_cuando_empiezas() -> None:
    assert cuando_empiezas(HOY, HOY) == "hoy"
    assert cuando_empiezas(HOY + timedelta(days=1), HOY) == "mañana"
    assert cuando_empiezas(HOY + timedelta(days=4), HOY) == "el lunes"
    assert cuando_empiezas(HOY + timedelta(days=7), HOY) == "el jueves 26"


@pytest.mark.anyio
async def test_la_vuelta_lanza_lo_que_toca_y_lo_anota(base, monkeypatch) -> None:
    from magister.api import app as aplicacion
    from magister.datos.fuentes import TareaResearch
    from magister.datos.plan import guardar_plan
    from magister.datos.sesion import nueva_sesion
    from magister.research import tareas
    from magister.trabajos import automatizar

    fijos = Path(__file__).parent / "fijos"
    plan = json.loads((fijos / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((fijos / "Perfil.json").read_text(encoding="utf-8"))
    for lec, valor in zip(plan["lecciones"], ["imprescindible", "no", "imprescindible", "imprescindible"]):
        lec["necesita_fuentes"] = valor
    sesiones = [{"clave": lec["clave"], "fecha": (HOY + timedelta(days=i * 3)).isoformat(), "inicio": None, "horas": 1}
                for i, lec in enumerate(plan["lecciones"])]
    _, plan_id = await guardar_plan("Topografía", None, perfil, plan, sesiones, "x", "eco")

    lanzadas: list[int] = []
    monkeypatch.setattr(tareas, "lanzar_en_fondo", lambda ids: lanzadas.extend(ids))
    hecho = await aplicacion.investigar_horizonte(None, HOY)
    # L1 (hoy) y L3 (dentro de 6 días): L2 es «no» y L4 cae fuera de los 7 días.
    async with nueva_sesion() as s:
        from sqlalchemy import select

        filas = (await s.scalars(select(TareaResearch).order_by(TareaResearch.id))).all()
    assert [(t.plan_id, t.leccion_clave) for t in filas] == [(plan_id, "L1"), (plan_id, "L3")]
    assert lanzadas == [t.id for t in filas]
    assert hecho == ["Buscando fuentes para L1 y L3 de Topografía (empiezas hoy)"]
    assert (await automatizar.ver_registro())[0]["texto"] == hecho[0]

    # Con una búsqueda del plan en curso, no se lanza nada más.
    async with nueva_sesion() as s, s.begin():
        s.add(TareaResearch(plan_id=plan_id, leccion_clave="L4", sistema="fijo",
                            creada_en=datetime.now(timezone.utc)))
    assert await aplicacion.investigar_horizonte(None, HOY) == []


@pytest.mark.anyio
async def test_con_el_freno_echado_no_se_lanza_nada(base, monkeypatch) -> None:
    from magister.api import app as aplicacion
    from magister.cerebro import freno

    monkeypatch.setattr(freno, "estado", lambda: {"parados": {"*": 300}, "llamadas_en_ventana": 99})
    assert await aplicacion.investigar_horizonte(None, HOY) == []


async def _plan_topografia(necesita: str | None = "imprescindible") -> int:
    from magister.datos.plan import guardar_plan

    fijos = Path(__file__).parent / "fijos"
    plan = json.loads((fijos / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((fijos / "Perfil.json").read_text(encoding="utf-8"))
    for lec in plan["lecciones"]:
        lec["necesita_fuentes"] = necesita
    sesiones = [{"clave": lec["clave"], "fecha": (HOY + timedelta(days=i * 3)).isoformat(), "inicio": None, "horas": 1}
                for i, lec in enumerate(plan["lecciones"])]
    _, plan_id = await guardar_plan("Topografía", None, perfil, plan, sesiones, "x", "eco")
    return plan_id


@pytest.mark.anyio
async def test_sin_red_la_vuelta_no_lanza_nada(base, monkeypatch) -> None:
    from magister.api import app as aplicacion
    from magister.research import tareas

    await _plan_topografia()
    lanzadas: list[int] = []
    monkeypatch.setattr(tareas, "lanzar_en_fondo", lambda ids: lanzadas.extend(ids))
    comprobaciones: list[bool] = []

    async def sin_red() -> bool:
        comprobaciones.append(False)
        return False

    assert await aplicacion.investigar_horizonte(None, HOY, sin_red) == []
    assert lanzadas == [] and comprobaciones == [False]

    async def con_red() -> bool:
        return True

    assert len(await aplicacion.investigar_horizonte(None, HOY, con_red)) == 1 and len(lanzadas) == 2


@pytest.mark.anyio
async def test_los_apuntes_automaticos_esperan_a_lo_que_el_horizonte_va_a_buscar(base, monkeypatch) -> None:
    from magister.api import app as aplicacion
    from magister.trabajos import automatizar

    plan_id = await _plan_topografia()
    # Lo que el research automático lanzaría ahora: L1 (hoy), L2 y L3, todas «imprescindible» aquí.
    assert {c for p, c in await aplicacion.por_investigar(HOY) if p == plan_id} >= {"L1"}

    async def leer():
        return {**automatizar.PREDETERMINADAS, "preparar_siguiente": {"activa": True, "dias_antes": 1}}

    monkeypatch.setattr(automatizar, "leer", leer)
    ahora = datetime(HOY.year, HOY.month, HOY.day, 10, 0)
    automatizar.registrar_por_investigar(aplicacion.por_investigar)
    try:
        # L1 empieza hoy y no tiene apuntes, pero su búsqueda va a salir: espera, y se dice hasta cuándo.
        assert await automatizar.una_vuelta(ahora) is None
        assert (await automatizar.ver_registro())[0]["texto"].startswith("Espero a las fuentes de L1")
    finally:
        automatizar.registrar_por_investigar(None)
    # Sin el gancho (como antes), se preparan ya.
    assert (await automatizar.una_vuelta(ahora)).startswith("Puesto en cola: preparar L1")


@pytest.mark.anyio
async def test_sin_etiqueta_la_vuelta_juzga_con_el_modelo_barato_y_luego_busca_solo_lo_necesario(base, monkeypatch) -> None:
    from sqlalchemy import select

    from magister.api import app as aplicacion
    from magister.datos import plan as dp
    from magister.datos.fuentes import TareaResearch
    from magister.datos.sesion import nueva_sesion
    from magister.research import necesidad, tareas
    from magister.research.necesidad import EtiquetaLeccion

    plan_id = await _plan_topografia(necesita=None)
    vistas: list[list[dict]] = []

    async def juzgar(lecciones: list[dict]) -> dict[int, EtiquetaLeccion]:
        vistas.append(lecciones)
        valores = ["imprescindible", "conviene", "no"]
        return {n: EtiquetaLeccion(n=n, necesita_fuentes=valores[n - 1], fuentes_por_que=f"Motivo {n}.")
                for n in range(1, len(lecciones) + 1)}

    monkeypatch.setattr(necesidad, "juzgar", juzgar)
    lanzadas: list[int] = []
    monkeypatch.setattr(tareas, "lanzar_en_fondo", lambda ids: lanzadas.extend(ids))
    # Antes de juzgar, los apuntes automáticos de L1 también esperan.
    assert {c for p, c in await aplicacion.por_investigar(HOY) if p == plan_id} == {"L1", "L2", "L3"}
    hecho = await aplicacion.investigar_horizonte(None, HOY)
    # Una sola llamada con las 3 del horizonte (L1, L2, L3; L4 cae fuera), con su tema, título y objetivos.
    assert [x["titulo"] for x in vistas[0]] and len(vistas) == 1 and len(vistas[0]) == 3
    assert vistas[0][0]["tema"] == "Topografía" and vistas[0][0]["objetivos"]
    async with nueva_sesion() as s:
        etiquetas = {x.clave: (x.necesita_fuentes, x.fuentes_por_que) for x in await dp.lecciones(s, plan_id)}
        filas = (await s.scalars(select(TareaResearch).order_by(TareaResearch.id))).all()
    assert etiquetas["L4"][0] is None and {k: v for k, v in etiquetas.items() if k != "L4"} == {
        "L1": ("imprescindible", "Motivo 1."), "L2": ("conviene", "Motivo 2."), "L3": ("no", "Motivo 3.")}
    # Solo se busca la «imprescindible»: la «conviene» queda como sugerencia y la «no», fuera.
    assert [t.leccion_clave for t in filas] == ["L1"] and lanzadas == [filas[0].id]
    assert hecho == ["Decidido con el modelo barato si L1, L2 y L3 de Topografía necesitan fuentes: 1 de 3 sí",
                     "Buscando fuentes para L1 de Topografía (empiezas hoy)"]


@pytest.mark.anyio
async def test_si_el_juicio_falla_no_se_busca_por_si_acaso_ni_se_reintenta_cada_vuelta(base, monkeypatch) -> None:
    from magister.api import app as aplicacion
    from magister.research import necesidad, tareas

    plan_id = await _plan_topografia(necesita=None)
    llamadas: list[int] = []

    async def juzgar(lecciones: list[dict]):
        llamadas.append(len(lecciones))
        raise RuntimeError("el modelo no responde")

    monkeypatch.setattr(necesidad, "juzgar", juzgar)
    monkeypatch.setattr(aplicacion, "_juicio_fallido", {})
    lanzadas: list[int] = []
    monkeypatch.setattr(tareas, "lanzar_en_fondo", lambda ids: lanzadas.extend(ids))
    assert await aplicacion.investigar_horizonte(None, HOY) == []
    assert await aplicacion.investigar_horizonte(None, HOY) == []
    assert llamadas == [3] and lanzadas == []
    # Al día siguiente, se vuelve a intentar.
    await aplicacion.investigar_horizonte(None, HOY + timedelta(days=1))
    assert len(llamadas) == 2 and aplicacion._juicio_fallido == {plan_id: HOY + timedelta(days=1)}


@pytest.mark.anyio
async def test_una_conviene_con_objetivos_sin_fuente_busca_solo_esos(base, monkeypatch) -> None:
    from sqlalchemy import select

    from magister.api import app as aplicacion
    from magister.datos.fuentes import TareaResearch
    from magister.datos.sesion import nueva_sesion
    from magister.flujo import planes
    from magister.research import tareas

    plan_id = await _plan_topografia(necesita="conviene")

    async def cobertura(s, pid):
        return {"L1": [1], "L2": None, "L3": []} if pid == plan_id else {}

    monkeypatch.setattr(planes, "cobertura_de_plan", cobertura)
    monkeypatch.setattr(tareas, "lanzar_en_fondo", lambda ids: None)
    assert await aplicacion.investigar_horizonte(None, HOY) == ["Buscando fuentes para L1 de Topografía (empiezas hoy)"]
    async with nueva_sesion() as s:
        filas = (await s.scalars(select(TareaResearch))).all()
    assert [(t.leccion_clave, t.estado_agente) for t in filas] == [("L1", {"objetivos": [1]})]


@pytest.mark.anyio
async def test_el_roadmap_dice_por_que_no_se_ha_buscado_sola(cliente) -> None:
    from magister.datos.plan import LeccionFila
    from magister.datos.sesion import nueva_sesion

    plan_id = await _plan_topografia(necesita="conviene")
    async with nueva_sesion() as s, s.begin():
        (await s.get(LeccionFila, (plan_id, "L2"))).necesita_fuentes = "imprescindible"
        (await s.get(LeccionFila, (plan_id, "L3"))).necesita_fuentes = None
    vista = (await cliente.get(f"/api/temas/{(await _tema_de(plan_id))}/plan")).json()
    auto = {x["clave"]: x["research_auto"] for x in vista["lecciones"]}
    assert auto["L1"] == {"motivo": "sugerencia", "texto": "Te vendría bien: búscalas cuando quieras."}
    assert auto["L2"]["motivo"] == "imprescindible" and auto["L3"]["motivo"] == "sin_juzgar"


async def _tema_de(plan_id: int) -> int:
    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        return (await dp.plan_por_id(s, plan_id)).tema_id


def test_el_juicio_de_necesidad_va_al_modelo_barato_por_configuracion() -> None:
    from magister.cerebro.enrutador import tabla, tarea_de_prompt

    tarea = tarea_de_prompt("cuando_research")
    assert tarea == "extraer" and tabla()["tareas"][tarea]["modelo"] == "haiku"
