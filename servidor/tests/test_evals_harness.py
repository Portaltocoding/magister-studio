"""La lógica de los harness ampliados: puntuar por código, medir y cortar en el tope. Con el motor eco y sin base,
sin red y sin claude.

    uv run pytest --noconftest tests/test_evals_harness.py
"""

import asyncio
from datetime import date
from pathlib import Path

import pytest
import yaml

from evals import asesor as ea
from evals import cuando_research as cr
from evals import regresion as rg
from evals import research_base as rb
from evals import rubrica_plan as rp
from evals import tope
from magister.asesor.agente import Paso
from magister.cerebro import estructura
from magister.config import ajustes


@pytest.fixture
def eco(monkeypatch, tmp_path):
    monkeypatch.setattr(ajustes, "motor", "eco")
    monkeypatch.setattr(ajustes, "crudo", str(tmp_path / "crudo"))
    monkeypatch.setattr(ajustes, "embeddings", "falso")
    estructura.eco.vaciar()
    yield estructura.eco
    estructura.eco.vaciar()


# --- cuando_research ------------------------------------------------------------------------------------------------


def test_el_nivel_corto_de_cuando_research_tiene_tres_de_cada():
    casos = tope.del_nivel(cr.cargar_banco(), "corto", cr.CORTO)
    assert len(casos) == 9 and cr.llamadas_previstas(len(casos)) == 1
    assert sorted(c["espera"] for c in casos) == sorted(["no", "conviene", "imprescindible"] * 3)


def test_metricas_de_cuando_research():
    casos = [{"id": "a", "espera": "no"}, {"id": "b", "espera": "imprescindible"}, {"id": "c", "espera": "imprescindible"}]
    m = cr.metricas(casos, {"a": "no", "b": "no", "c": "imprescindible"})
    assert rg.resumir(m["aciertos"])["k"] == 2
    assert m["fallos_caros"]["por_caso"] == {"b": [1, 1], "c": [0, 1]} and m["fallos_caros"]["mejor"] == "bajo"


def test_cuando_research_se_para_en_el_tope(eco):
    # Cada lote: una salida que no vale y un reintento. Con tope 1, el primer lote se corta y el segundo no empieza.
    casos = cr.cargar_banco()[:4]
    eco.encolar(cr.Etiquetas, [{"etiquetas": []}])
    t = tope.Tope(1)
    with tope.contar(t):
        predichas = asyncio.run(cr.etiquetar(casos, 2, t))
    assert predichas == {} and t.hechas == 1 and t.cortado


# --- asesor plan ----------------------------------------------------------------------------------------------------


def _escenario(id_: str) -> ea.EscenarioPlan:
    return next(e for e in ea.ESCENARIOS_PLAN if e.id == id_)


def test_puntuar_un_escenario_bien_y_mal():
    e = _escenario("marcar")
    bien = {"salida": "cambios", "acciones": [{"tipo": "marcar_leccion", "clave": "l1", "hecho": True, "motivo": "x"}]}
    assert ea.puntuar_escenario(e, bien)["accion_correcta"]
    de_propina = {**bien, "acciones": bien["acciones"] + [{"tipo": "preparar_leccion", "clave": "L2"}]}
    p = ea.puntuar_escenario(e, de_propina)
    assert not p["accion_correcta"] and "preparar_leccion" in p["sobran"]
    otra = {"salida": "cambios", "acciones": [{"tipo": "marcar_leccion", "clave": "L2", "hecho": True}]}
    assert ea.puntuar_escenario(e, otra)["faltan"]


def test_no_actuar_es_no_proponer_nada():
    e = _escenario("fuera")
    assert ea.puntuar_escenario(e, {"salida": "no_se_puede"})["accion_correcta"]
    assert not ea.puntuar_escenario(e, {"salida": "cambios", "acciones": [{"tipo": "guardar_nota"}]})["accion_correcta"]
    assert not ea.puntuar_escenario(e, {"salida": "fallo"})["salida_correcta"]


def test_lee_cuando_toca():
    e = _escenario("lejos")
    r = {"salida": "cambios", "acciones": [{"tipo": "mover_sesion", "sesion_id": 4, "fecha": "2026-12-10"}], "lecturas": []}
    assert not ea.puntuar_escenario(e, r)["lee_cuando_toca"]
    r["lecturas"] = [{"herramienta": "ver_calendario", "desde": "2026-12-09"}]
    assert ea.puntuar_escenario(e, r)["lee_cuando_toca"]


def test_fuera_de_lista_se_reconoce_en_los_errores_del_esquema():
    assert ea._fuera_de_lista(["cambios.acciones.0.tipo: Input should be 'anadir_pasos', ..."])
    assert not ea._fuera_de_lista(["cambios.acciones.0.fecha: Input should be a valid date"])


def test_puntuar_mensaje():
    m = next(x for x in ea.MENSAJES_PLAN if x.id == "que_sesion")
    assert ea.puntuar_mensaje(m, "¿Cuál quieres mover y a qué día?")["decide_bien"]
    assert not ea.puntuar_mensaje(m, "Hecho.\n```cambio\nMover la sesión de L3 al lunes\n```")["decide_bien"]
    assert ea.puntuar_mensaje(m, None) == {}


def test_calendario_en_memoria_como_la_herramienta():
    texto = ea.calendario_de(ea.plan_fijo(), date(2026, 12, 8), date(2026, 12, 10))
    assert "sesión 4: L4 «Aplicaciones de la integral» a las 17:00, 2 h (pendiente)" in texto
    assert "nada entre" in ea.calendario_de(ea.plan_fijo(), date(2026, 12, 1), date(2026, 12, 2))


def test_los_casos_del_plan_son_coherentes_con_la_lista_cerrada():
    from typing import get_args

    from magister.asesor.cambios import TipoAccion

    tipos = set(get_args(TipoAccion))
    assert all(a["tipo"] in tipos for e in ea.ESCENARIOS_PLAN for a in e.acciones)
    assert {e.id for e in ea.ESCENARIOS_PLAN} >= set(ea.CORTO_ESCENARIOS)
    assert {m.id for m in ea.MENSAJES_PLAN} >= set(ea.CORTO_MENSAJES)
    # Cada acción del plan de la lista cerrada sale en algún escenario.
    assert {"mover_sesion", "marcar_leccion", "preparar_leccion", "apuntar_evento"} <= {a["tipo"] for e in ea.ESCENARIOS_PLAN for a in e.acciones}


def _paso_cambios(*acciones: dict) -> dict:
    return {"falta": "ya puedo", "cambios": {"resumen": "x", "acciones": [{"motivo": "porque sí", **a} for a in acciones]}}


def test_el_agente_de_verdad_sobre_el_plan_en_memoria(eco):
    # Primero lee el calendario (la sesión de L4 no está en las dos semanas que ve) y luego la mueve: sin base.
    eco.encolar(Paso, [{"falta": "el id de la sesión", "leer": [{"herramienta": "ver_calendario", "desde": "2026-12-09",
                                                               "hasta": "2026-12-10"}]},
                       _paso_cambios({"tipo": "mover_sesion", "sesion_id": 4, "fecha": "2026-12-10"})])
    e = _escenario("lejos")
    r = asyncio.run(ea.correr_escenario_plan(e, ea.plan_fijo()))
    p = ea.puntuar_escenario(e, r)
    assert r["salida"] == "cambios" and p["accion_correcta"] and p["lee_cuando_toca"] and p["sin_fuera_de_lista"]


def test_el_agente_que_intenta_algo_fuera_de_la_lista(eco):
    eco.encolar(Paso, [_paso_cambios({"tipo": "borrar_plan"}), {"falta": "no cabe", "no_se_puede": "Eso se hace en Roadmap."}])
    e = _escenario("fuera")
    r = asyncio.run(ea.correr_escenario_plan(e, ea.plan_fijo()))
    assert r["salida"] == "no_se_puede" and r["fuera_de_lista"] == 1
    p = ea.puntuar_escenario(e, r)
    assert p["accion_correcta"] and not p["sin_fuera_de_lista"]


def test_el_simulador_rechaza_el_sabado_y_eso_cuesta_un_reintento(eco):
    eco.encolar(Paso, [_paso_cambios({"tipo": "mover_sesion", "sesion_id": 2, "fecha": "2026-11-21"}),
                       {"falta": "no cabe", "no_se_puede": "El sábado no estudias."}])
    t = tope.Tope(10)
    with tope.contar(t):
        r = asyncio.run(ea.correr_escenario_plan(_escenario("sabado"), ea.plan_fijo()))
    assert r["salida"] == "no_se_puede" and t.hechas == 2


def test_correr_plan_entero_con_eco_y_tope(eco):
    t = tope.Tope(4)
    with tope.contar(t):
        puntos = asyncio.run(ea.correr_plan("corto", t))
    assert t.hechas <= 4 and t.cortado
    assert set(puntos) >= {f"decidir/{x}" for x in ea.CORTO_MENSAJES}
    m = ea.metricas_plan(puntos)
    assert rg.resumir(m["decide_bien"])["n"] == 3


# --- research_base --------------------------------------------------------------------------------------------------


def test_el_banco_de_research_base_es_coherente():
    casos = rb.cargar_banco()
    assert {c["id"] for c in casos} >= set(rb.CORTO)
    for c in casos:
        cubiertos = {o for p in c["paginas"] for o in p.get("cubre") or []}
        assert cubiertos == set(range(1, len(c["objetivos"]) + 1)), c["id"]  # cada objetivo tiene alguna página


def test_banco_con_autoridad_fuera_de_escala(tmp_path):
    ruta = tmp_path / "b.yaml"
    ruta.write_text(yaml.safe_dump([{"id": "x", "tema": "t", "titulo": "t", "objetivos": ["a"], "espera": "no",
                                     "paginas": [{"url": "u", "autoridad": 5, "cubre": [1]}]}]), encoding="utf-8")
    with pytest.raises(ValueError):
        rb.cargar_banco(ruta)


def test_medir_una_leccion():
    caso = next(c for c in rb.cargar_banco() if c["id"] == "http-json")
    propuestas = [{"url": "https://blogdeprogramar.example/http-y-json-en-5-minutos", "ficha": {"objetivos": [1, 2], "autoridad": 3}},
                  {"url": "https://cursos-premium.example/oferta-desarrollo-web", "ficha": {"objetivos": [1], "autoridad": 2}}]
    tray = [{"accion": "puntuar", "notas": [{}, {}, {}]}, {"accion": "descartada", "por": "cita"}]
    x = rb.medir(caso, propuestas, tray)
    assert (x["cubiertos_juez"], x["cubiertos_reales"]) == (2, 2)
    assert x["autoridad_banco"] == [1, 0] and x["autoridad_juez"] == [3, 2]
    assert (x["citas_ok"], x["notas"]) == (2, 3)
    assert x["malas"] == ["https://cursos-premium.example/oferta-desarrollo-web"]
    m = rb.metricas([caso], {"http-json": x}, {"http-json": "conviene"})
    assert rg.resumir(m["malas_elegidas"])["k"] == 1 and rg.resumir(m["necesita_acierta"])["k"] == 1
    assert "necesita_fallo_caro" not in m  # http-json no es imprescindible


def test_research_base_con_eco_de_punta_a_punta(eco):
    casos = tope.del_nivel(rb.cargar_banco(), "corto", rb.CORTO)
    t = tope.Tope(rb.TOPES["corto"])
    with tope.contar(t):
        medidas, predichas = asyncio.run(rb.correr(casos, t))
    assert set(medidas) == set(rb.CORTO) and t.hechas == 5 and not t.cortado
    # Con eco el juez es el banco: elige las páginas que cubren, ninguna mala, y todas las citas están.
    assert all(x["cubiertos_reales"] == x["objetivos"] and not x["malas"] and x["citas_ok"] == x["notas"] for x in medidas.values())
    assert set(predichas) == set(rb.CORTO)


def test_research_base_no_empieza_una_leccion_que_no_cabe(eco):
    casos = rb.cargar_banco()
    t = tope.Tope(3)
    with tope.contar(t):
        medidas, predichas = asyncio.run(rb.correr(casos, t))
    assert len(medidas) == 1 and predichas == {} and t.cortado and t.hechas == 2


# --- rubrica_plan ---------------------------------------------------------------------------------------------------


def test_cobertura_de_terminos():
    k, n, faltan = rp.cobertura_terminos(["límite", "regla de la cadena|cadena", "aprob", "integral"],
                                         "L1. Límites y continuidad. Aplicar la cadena; tras la aprobación del plan")
    assert (k, n, faltan) == (3, 4, ["integral"])
    assert rp.cobertura_terminos(["sql"], "nosql")[0] == 0  # inicio de palabra, no dentro


def _juicio(citas: dict[str, str], cumple: bool = True) -> rp.JuicioPlan:
    return rp.JuicioPlan(criterios=[rp.Criterio(criterio=k, razon="r", cumple=cumple, cita=v) for k, v in citas.items()])


def test_validar_juicio_da_fallo_juez_y_nunca_suspenso():
    from magister.tono.juez import FalloJuez

    texto = "L1. Límites (2 h; depende de: ninguna)\n  - Calcular el límite de una función en un punto"
    bien = {"cobertura": "Calcular el límite de", "orden": "depende de: ninguna", "accionable": "Calcular el límite de una función"}
    assert isinstance(rp.validar_juicio(_juicio(bien, cumple=False), texto), rp.JuicioPlan)
    inventada = {**bien, "orden": "primero las integrales dobles"}
    assert isinstance(rp.validar_juicio(_juicio(inventada), texto), FalloJuez)
    corta = {**bien, "orden": "Límites"}
    assert isinstance(rp.validar_juicio(_juicio(corta), texto), FalloJuez)
    repetido = rp.JuicioPlan(criterios=[rp.Criterio(criterio="orden", razon="r", cumple=True, cita=bien["orden"])] * 3)
    assert isinstance(rp.validar_juicio(repetido, texto), FalloJuez)


def test_juez_sin_salida_valida_es_fallo_juez(eco):
    from magister.tono.juez import FalloJuez

    eco.encolar(rp.JuicioPlan, [{"criterios": []}, {"nada": 1}])
    assert isinstance(asyncio.run(rp.juzgar("objetivo", "texto del plan", "plan")), FalloJuez)


def _plan_fijo():
    import json

    from magister.plan.esquemas import Plan

    with open(Path(__file__).parent / "fijos" / "Plan.json", encoding="utf-8") as f:
        return Plan.model_validate(json.load(f))


def test_comprobar_plan_por_codigo():
    from magister.flujo.comun import reglas_plan
    from magister.plan.esquemas import Perfil

    plan = _plan_fijo()
    caso = {"id": "x", "debe_cubrir": [plan.lecciones[0].titulo.split()[0], "palabraquenoestá"]}
    perfil = Perfil.model_validate(rp.perfil_de({"tema": "t", "objetivo": "o", "nivel": "basico",
                                                 "horas_por_dia": [2, 2, 2, 2, 2, 0, 0], "plazo_dias": 60}))
    claves = [lec.clave for lec in plan.lecciones]
    sesiones = [{"fecha": f"2026-11-{20 + i:02d}", "clave": k, "horas": 1} for i, k in enumerate(claves)]
    r = rp.comprobar_plan(caso, perfil, plan, sesiones, reglas_plan())
    assert r["carga_sesion"].ok and r["orden_calendario"].ok
    assert not r["cobertura_minimos"].ok and "palabraquenoesta" in rp.normal(r["cobertura_minimos"].detalle)
    largas = [{**s, "horas": 4} for s in sesiones]
    assert not rp.comprobar_plan(caso, perfil, plan, largas, reglas_plan())["carga_sesion"].ok
    al_reves = list(reversed(sesiones))
    if any(lec.depende_de for lec in plan.lecciones):
        assert not rp.comprobar_plan(caso, perfil, plan, al_reves, reglas_plan())["orden_calendario"].ok


def test_comprobar_roadmap_por_codigo():
    r = ea.roadmap()  # el del harness del asesor: nivel 1 detallado, nivel 2 sin pasos
    caso = {"id": "x", "debe_cubrir": ["boto3", "presupuesto", "kubernetes"]}
    res = rp.comprobar_roadmap(caso, r)
    assert res["pasos_accionables"].ok and res["tamano_bloques"].ok and res["carga_bloque"].ok and res["niveles_distintos"].ok
    assert not res["cobertura_minimos"].ok and "kubernetes" in res["cobertura_minimos"].detalle
    r["niveles"][0]["bloques"][0]["pasos"][0]["hecho_si"] = "funciona"
    r["niveles"][0]["bloques"][0]["pasos"][1]["minutos"] = 500
    assert not rp.comprobar_roadmap(caso, r)["pasos_accionables"].ok


def test_metricas_de_la_rubrica():
    from evals.comprobaciones import Resultado
    from magister.tono.juez import FalloJuez

    j = _juicio({"cobertura": "a b c", "orden": "a b c", "accionable": "a b c"})
    filas = [{"clave": "plan/a", "codigo": {"carga_dia": Resultado(True)}, "juicio": j},
             {"clave": "plan/b", "codigo": {"carga_dia": Resultado(False)}, "juicio": FalloJuez("x")},
             {"clave": "roadmap/c", "sin_salida": "roadmap"}]
    m = rp.metricas(filas)
    assert rg.resumir(m["genera"])["k"] == 2
    assert m["codigo.carga_dia"]["por_caso"] == {"plan/a": [1, 1], "plan/b": [0, 1]}
    assert m["juez_valido"]["por_caso"] == {"plan/a": [1, 1], "plan/b": [0, 1]}
    assert m["juez.orden"]["por_caso"] == {"plan/a": [1, 1]}  # el FalloJuez no cuenta como suspenso


def test_banco_de_la_rubrica_y_su_nivel_corto():
    banco = rp.cargar_banco()
    assert {x["id"] for x in banco["planes"]} >= set(rp.CORTO["planes"])
    assert {x["id"] for x in banco["roadmaps"]} >= set(rp.CORTO["roadmaps"])


def test_la_plantilla_del_juez_existe_y_tiene_version():
    v = rg.versiones(["juez_plan"])["juez_plan"]
    assert len(v) == 12


# --- suite ----------------------------------------------------------------------------------------------------------


def test_la_suite_nombra_modulos_que_existen():
    import importlib

    suite = yaml.safe_load((Path(rg.__file__).parent / "suite.yaml").read_text(encoding="utf-8"))
    for b in suite["bancos"]:
        modulo = b["comando"].split()[2]
        importlib.import_module(modulo)
