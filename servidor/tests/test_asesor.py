"""El asesor que hace cosas: decide si lee o propone, el código valida las acciones y solo se aplican si las apruebas."""

import pytest

from magister.asesor import agente as ag
from magister.asesor import cambios as cb
from magister.proyectos import roadmap as rm
from tests.sse import eventos_sse

pytestmark = pytest.mark.anyio
MOMENTO = "2026-11-19T10:00:00+00:00"


def _paso(t: str, **extra) -> dict:
    return {"titulo": t, "que_haces": "Escribe un test con moto que siembra un disco suelto.",
            "antes": "moto simula AWS dentro del proceso: boto3 cree que habla con AWS y no sale nada.",
            "hecho_si": "uv run pytest pasa y el test encuentra el disco sembrado", "minutos": 45, **extra}


def _roadmap() -> dict:
    paso = rm.PasoGen(**_paso("Crea la cuenta"))
    otro = rm.PasoGen(**_paso("Alarmas de gasto"))
    r = rm.RoadmapGen(
        resumen="Línea 1.", que_es="Un agente.", por_que="Porque sí.",
        glosario=[rm.Termino(termino=t, definicion="…") for t in ("Agente", "Plan", "Nivel")],
        arquitectura="Agente y plan.",
        niveles=[rm.NivelGen(titulo="Solo lee", objetivo="Lee.", priming="…",
                             bloques=[rm.BloqueGen(titulo="La cuenta", priming="…", pasos=[paso, otro])]),
                 rm.NivelGen(titulo="Aplica", objetivo="Aplica.", priming="…",
                             bloques=[rm.BloqueGen(titulo="Plan", priming="El plan se aprueba antes de aplicarlo.")])],
        riesgos=[rm.Riesgo(riesgo="Coste", mitigacion="Un presupuesto con avisos."),
                 rm.Riesgo(riesgo="Borrar", mitigacion="Primero en simulacro (dry-run).")])
    return rm.montar(r)


def _proyecto(**extra) -> dict:
    return {"nombre": "Copiloto", "roadmap": _roadmap(), "hechos": [], "hechos_en": {}, **extra}


def _cambios(*acciones: dict) -> cb.Cambios:
    return cb.Cambios.model_validate({"resumen": "Lo que falta.", "acciones": [{"motivo": "Tu documento lo pide.", **a} for a in acciones]})


def _errores(p: dict | None, *acciones: dict) -> str:
    return " ".join(cb.simular(_cambios(*acciones), p, MOMENTO).errores)


def _propone(*acciones: dict, pendiente: str | None = None) -> dict:
    """Lo que devuelve el agente cuando propone (un fijo para el motor eco)."""
    return {"falta": "Nada: está todo en el proyecto.",
            "cambios": {"resumen": "Lo que falta.", "pendiente": pendiente,
                        "acciones": [{"motivo": "Tu documento lo pide.", **a} for a in acciones]}}


# --- Las acciones, en código puro ---------------------------------------------------------------------------------

def test_anadir_pasos_pone_ids_nuevos_sin_tocar_los_de_siempre() -> None:
    p = _proyecto(hechos=["n1-b1-p2"])
    r = cb.simular(_cambios({"tipo": "anadir_pasos", "bloque_id": "n1-b1", "despues_de": "n1-b1-p1", "pasos": [_paso("Tests con moto")]}), p, MOMENTO)
    assert r.errores == []
    assert [x["id"] for x in r.roadmap["niveles"][0]["bloques"][0]["pasos"]] == ["n1-b1-p1", "n1-b1-p3", "n1-b1-p2"]
    assert r.hechos == ["n1-b1-p2"] and "Tests con moto" in r.lineas[0].texto
    assert p["roadmap"]["niveles"][0]["bloques"][0]["pasos"][1]["id"] == "n1-b1-p2"  # el original, intacto


def test_lo_que_no_vale_vuelve_al_modelo_con_el_porque() -> None:
    p = _proyecto()
    assert "no existe el bloque" in _errores(p, {"tipo": "anadir_pasos", "bloque_id": "n9-b1", "pasos": [_paso("X")]})
    assert "aún no tiene pasos" in _errores(p, {"tipo": "anadir_pasos", "bloque_id": "n2-b1", "pasos": [_paso("X")]})
    assert "Ya hay un paso" in _errores(p, {"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("Crea la cuenta")]})
    assert "comprobable" in _errores(p, {"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("X", hecho_si="Funciona")]})
    muchos = [_paso(f"Paso {i}") for i in range(5)]
    assert "bloque nuevo" in _errores(p, {"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": muchos})
    assert "no cambia nada" in _errores(p, {"tipo": "cambiar_paso", "paso_id": "n1-b1-p1", "campos": {"titulo": "Crea la cuenta"}})
    assert "no hay ningún proyecto" in _errores(None, {"tipo": "marcar_paso", "paso_id": "n1-b1-p1", "hecho": True})
    # Solo cuenta cómo queda al final: quitar un paso vale, dejar el bloque vacío no.
    assert _errores(p, {"tipo": "quitar_paso", "paso_id": "n1-b1-p1"}) == ""
    assert "se queda con 0 pasos" in _errores(p, {"tipo": "quitar_paso", "paso_id": "n1-b1-p1"}, {"tipo": "quitar_paso", "paso_id": "n1-b1-p2"})


def test_un_bloque_nuevo_y_las_demas_acciones() -> None:
    p = _proyecto(hechos=["n1-b1-p1"], hechos_en={"n1-b1-p1": "2026-11-18T09:00:00+00:00"})
    r = cb.simular(_cambios(
        {"tipo": "nuevo_bloque", "nivel_id": "n1", "titulo": "Probar sin coste", "priming": "Todo contra moto antes de tocar AWS.",
         "pasos": [_paso("Tests con moto"), _paso("Dry-run y registro")]},
        {"tipo": "quitar_paso", "paso_id": "n1-b1-p1"},
        {"tipo": "marcar_paso", "paso_id": "n1-b1-p2", "hecho": True},
        {"tipo": "apuntar_decision", "decision": {"titulo": "Probar con moto", "decision": "Nada contra AWS real hasta el nivel 2."}},
        {"tipo": "guardar_nota", "nota": "El plan de 7 días del documento."},
    ), p, MOMENTO)
    assert r.errores == []
    bloques = r.roadmap["niveles"][0]["bloques"]
    assert bloques[1]["id"] == "n1-b2" and [x["id"] for x in bloques[1]["pasos"]] == ["n1-b2-p1", "n1-b2-p2"]
    assert r.hechos == ["n1-b1-p2"] and r.hechos_en == {"n1-b1-p2": MOMENTO}
    assert r.decisiones[0]["titulo"] == "Probar con moto" and r.notas == ["El plan de 7 días del documento."]
    assert len(r.lineas) == 5


def test_reestructurar_mueve_sin_perder_lo_hecho_y_anade_niveles() -> None:
    p = _proyecto(hechos=["n1-b1-p2"])
    r = cb.simular(_cambios(
        {"tipo": "nuevo_bloque", "nivel_id": "n1", "despues_de": "inicio", "titulo": "Probar sin coste",
         "priming": "Todo contra moto antes de tocar AWS.", "pasos": [_paso("Tests con moto"), _paso("Dry-run y registro")]},
        {"tipo": "mover_paso", "paso_id": "n1-b1-p2", "bloque_id": "n1-b2", "despues_de": "inicio"},
        {"tipo": "cambiar_bloque", "bloque_id": "n1-b1", "titulo": "La cuenta, blindada"},
        {"tipo": "nuevo_nivel", "despues_de": "n1", "titulo": "Evals", "objetivo": "Mide lo que detecta sobre escenarios plantados.",
         "priming": "Antes de aplicar nada, saber cuánto acierta.",
         "bloques": [{"titulo": "Banco de escenarios", "priming": "Escenarios moto con desperdicio plantado."}]},
        {"tipo": "cambiar_nivel", "nivel_id": "n2", "objetivo": "Aplica en dry-run con aprobación."},
    ), p, MOMENTO)
    assert r.errores == []
    n1, evals, n2 = r.roadmap["niveles"]
    assert [b["id"] for b in n1["bloques"]] == ["n1-b2", "n1-b1"]
    assert [x["id"] for x in n1["bloques"][0]["pasos"]] == ["n1-b1-p2", "n1-b2-p1", "n1-b2-p2"]  # el movido conserva su id
    assert r.hechos == ["n1-b1-p2"] and n1["bloques"][1]["titulo"] == "La cuenta, blindada"
    assert (evals["id"], evals["numero"], evals["detallado"], n2["numero"]) == ("n3", 2, False, 3)
    assert n2["objetivo"] == "Aplica en dry-run con aprobación."
    # Lo que ves en la tarjeta dice dónde queda cada cosa, con títulos y sin ids.
    assert [x.texto for x in r.lineas][1:3] == ["Mover el paso «Alarmas de gasto» al principio de «Probar sin coste»",
                                               "Renombrar el bloque «La cuenta» a «La cuenta, blindada»"]


def test_reordenar_dentro_de_un_bloque_y_quitar_un_nivel() -> None:
    p = _proyecto()
    r = cb.simular(_cambios({"tipo": "mover_paso", "paso_id": "n1-b1-p2", "bloque_id": "n1-b1", "despues_de": "inicio"},
                            {"tipo": "quitar_nivel", "nivel_id": "n2"}), p, MOMENTO)
    assert r.errores == []
    assert [x["id"] for x in r.roadmap["niveles"][0]["bloques"][0]["pasos"]] == ["n1-b1-p2", "n1-b1-p1"]
    assert len(r.roadmap["niveles"]) == 1


def test_un_id_que_se_fue_no_se_reutiliza() -> None:
    """Un paso movido a otro bloque conserva su id: un paso nuevo en el bloque de origen no puede llevar el mismo."""
    p = _proyecto()
    r = cb.simular(_cambios(
        {"tipo": "nuevo_bloque", "nivel_id": "n1", "titulo": "Otro", "priming": "Un bloque más para repartir los pasos.",
         "pasos": [_paso("A"), _paso("B")]},
        {"tipo": "mover_paso", "paso_id": "n1-b1-p2", "bloque_id": "n1-b2"},
        {"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("C")]},
    ), p, MOMENTO)
    assert r.errores == []
    todos = [x["id"] for b in r.roadmap["niveles"][0]["bloques"] for x in b["pasos"]]
    assert len(todos) == len(set(todos)) and "n1-b1-p3" in todos


def test_reestructurar_tiene_limites() -> None:
    p = _proyecto()
    assert "aún no tiene pasos" in _errores(p, {"tipo": "mover_paso", "paso_id": "n1-b1-p1", "bloque_id": "n2-b1"})
    assert "no encaja" in _errores(p, {"tipo": "mover_bloque", "bloque_id": "n1-b1", "nivel_id": "n2"})
    assert "único bloque" in _errores(p, {"tipo": "quitar_bloque", "bloque_id": "n1-b1"})
    assert "no es un paso" in _errores(p, {"tipo": "mover_paso", "paso_id": "n1-b1-p1", "bloque_id": "n1-b1", "despues_de": "n9"})
    assert "o todos sus bloques" in _errores(p, {
        "tipo": "nuevo_nivel", "titulo": "Evals", "objetivo": "Mide lo que detecta.", "priming": "Antes de aplicar nada, saber cuánto acierta.",
        "bloques": [{"titulo": "A", "priming": "Un bloque con sus pasos de siempre.", "pasos": [_paso("P1"), _paso("P2")]},
                    {"titulo": "B", "priming": "Y otro bloque que viene sin pasos."}]})


def test_detallar_un_nivel_no_repite_el_id_de_un_bloque_movido() -> None:
    r = _roadmap()
    r["niveles"][0]["bloques"].append({"id": "n2-b1", "titulo": "Movido", "priming": "…", "pasos": []})
    detalle = rm.NivelDetallado(bloques=[rm.BloqueGen(titulo="Plan", priming="…", pasos=[rm.PasoGen(**_paso("Aprobar"))])])
    assert rm.con_nivel_detallado(r, 2, detalle)["niveles"][1]["bloques"][0]["id"] == "n2-b2"


def test_el_encargo_sale_del_bloque_cambio() -> None:
    texto = "Lo añado al nivel 1.\n\n```cambio\nAñade los tests con moto al bloque n1-b1.\n```"
    assert cb.encargo_de(texto) == "Añade los tests con moto al bloque n1-b1."
    assert cb.sin_bloque_cambio(texto) == "Lo añado al nivel 1."
    assert cb.encargo_de("Sin cambios.") is None


# --- Cómo decide el agente ----------------------------------------------------------------------------------------

def test_como_decide_el_agente_esta_en_codigo() -> None:
    """Una salida por vuelta, sin repetir lecturas, con tope, y en la última vuelta solo vale proponer."""
    p = _proyecto()
    notas = {"herramienta": "buscar_notas", "consulta": "moto"}

    def reglas(hechas=(), ultima=False, **salida) -> str:
        paso = ag.Paso.model_validate({"falta": "…", **salida})
        return " ".join(ag.reglas_paso(paso, list(hechas), ultima, p, MOMENTO))

    assert reglas(leer=[notas]) == ""
    assert "exactamente una" in reglas() and "exactamente una" in reglas(leer=[notas], no_se_puede="No.")
    assert "Ya has leído" in reglas(hechas=[notas], leer=[{"herramienta": "buscar_notas", "consulta": "Moto "}])
    assert "necesita en `consulta`" in reglas(leer=[{"herramienta": "buscar_notas"}])
    assert "Ya no quedan lecturas" in reglas(ultima=True, leer=[notas])
    assert "Como mucho" in reglas(leer=[notas, {"herramienta": "ver_plan_estudio"}, {"herramienta": "buscar_notas", "consulta": "iam"}])
    assert reglas(no_se_puede="Crear proyectos se hace en Proyectos.") == ""
    assert "no existe el bloque" in reglas(**_propone({"tipo": "anadir_pasos", "bloque_id": "n9-b1", "pasos": [_paso("X")]}))


async def _preparado(cliente):
    from magister.datos.proyectos import Proyecto
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s, s.begin():
        p = Proyecto(nombre="Copiloto", idea="Un agente que audita AWS.", estado="listo", roadmap=_roadmap())
        s.add(p)
        await s.flush()
        pid = p.id
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Asesor · Proyectos", "tipo": "asesor"})).json()["id"]
    return pid, cid


async def _pedir(cliente, cid: int, pid: int) -> list[tuple[str, dict]]:
    # El motor eco repite la pregunta: así la «respuesta» trae el bloque cambio.
    pregunta = "Añádelo.\n```cambio\nAñade al bloque n1-b1 un paso con los tests con moto del documento.\n```"
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": pregunta, "asesor": True, "proyecto_id": pid})
    return eventos_sse(r.text)


async def _pasos_n1(cliente, pid: int) -> list[dict]:
    return (await cliente.get(f"/api/proyectos/{pid}")).json()["roadmap"]["niveles"][0]["bloques"][0]["pasos"]


async def test_el_agente_lee_antes_de_proponer_y_lo_cuenta(cliente) -> None:
    from magister.cerebro.estructura import eco
    from magister.datos.notas import Nota
    from magister.datos.sesion import nueva_sesion

    pid, cid = await _preparado(cliente)
    async with nueva_sesion() as s, s.begin():
        s.add(Nota(texto="moto no genera métricas de CPU: se siembran con put_metric_data."))
    eco.encolar(ag.Paso, [
        {"falta": "Lo que apuntó sobre moto.", "leer": [{"herramienta": "buscar_notas", "consulta": "moto métricas"}]},
        _propone({"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("Sembrar métricas de CPU")]}),
    ])
    eventos = await _pedir(cliente, cid, pid)
    fases = [d.get("detalle") for e, d in eventos if e == "fase" and d.get("nodo") == "preparar_cambio"]
    assert fases == ["Preparando el cambio…", "Mirando tus notas sobre «moto métricas»…"]
    cambio = next(d for e, d in eventos if e == "cambio")
    assert cambio["consultado"] == ["tus notas sobre «moto métricas»"]


async def test_las_lecturas_solo_leen_y_el_diario_va_en_el_prompt(cliente) -> None:
    from magister.asesor import herramientas as h
    from magister.datos.notas import Nota
    from magister.datos.sesion import nueva_sesion

    pid, _ = await _preparado(cliente)
    async with nueva_sesion() as s, s.begin():
        s.add(Nota(texto="moto no genera métricas de CPU."))
    await cliente.post(f"/api/proyectos/{pid}/decisiones", json={"titulo": "Todo contra moto", "decision": "Nada contra AWS real."})
    assert "métricas de CPU" in await h.leer("buscar_notas", pid, "Métricas")
    assert "ninguna nota" in await h.leer("buscar_notas", pid, "kubernetes")
    assert "ningún plan" in await h.leer("ver_plan_estudio", pid, None)
    assert "Todo contra moto: Nada contra AWS real." in await h.diario(pid)


async def test_si_no_se_puede_lo_dice_sin_proponer_nada(cliente) -> None:
    from magister.cerebro.estructura import eco

    pid, cid = await _preparado(cliente)
    eco.encolar(ag.Paso, [{"falta": "Nada.", "no_se_puede": "Borrar el proyecto se hace desde su pantalla."}])
    eventos = await _pedir(cliente, cid, pid)
    assert next(d for e, d in eventos if e == "cambio_fallido") == {"detalle": "Borrar el proyecto se hace desde su pantalla.", "explicado": True}
    assert (await cliente.get(f"/api/conversaciones/{cid}/cambios")).json() == []


# --- De la respuesta a aplicar ------------------------------------------------------------------------------------

async def test_de_la_respuesta_a_aplicar_y_deshacer(cliente) -> None:
    from magister.cerebro.estructura import eco

    pid, cid = await _preparado(cliente)
    # El primer intento no vale (bloque que no existe): vuelve al modelo y el segundo sí.
    eco.encolar(ag.Paso, [
        _propone({"tipo": "anadir_pasos", "bloque_id": "n7-b1", "pasos": [_paso("Tests con moto")]}),
        _propone({"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("Tests con moto")]},
                 pendiente="El paso del nivel 2 se queda fuera: detállalo primero."),
    ])
    eventos = await _pedir(cliente, cid, pid)
    cambio = next(d for e, d in eventos if e == "cambio")
    assert cambio["estado"] == "propuesta" and "Tests con moto" in cambio["lineas"][0]["texto"] and cambio["consultado"] == []
    assert cambio["pendiente"] == "El paso del nivel 2 se queda fuera: detállalo primero."
    # Nada cambia hasta que lo apruebas.
    assert len(await _pasos_n1(cliente, pid)) == 2
    assert [c["id"] for c in (await cliente.get(f"/api/conversaciones/{cid}/cambios")).json()] == [cambio["id"]]

    r = (await cliente.post(f"/api/cambios/{cambio['id']}/aplicar")).json()
    assert r["estado"] == "aplicada" and r["nuevos"] == ["n1-b1-p3"]
    assert [x["titulo"] for x in await _pasos_n1(cliente, pid)][-1] == "Tests con moto"
    assert (await cliente.post(f"/api/cambios/{cambio['id']}/aplicar")).status_code == 409  # dos veces no hace nada

    assert (await cliente.post(f"/api/cambios/{cambio['id']}/deshacer")).json()["estado"] == "deshecha"
    assert len(await _pasos_n1(cliente, pid)) == 2


async def test_si_el_proyecto_cambia_antes_de_aplicarlo_la_propuesta_caduca(cliente) -> None:
    from magister.cerebro.estructura import eco

    pid, cid = await _preparado(cliente)
    eco.encolar(ag.Paso, [_propone({"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("Tests con moto")]})])
    cambio = next(d for e, d in await _pedir(cliente, cid, pid) if e == "cambio")
    await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p1", json={"hecho": True})
    r = (await cliente.post(f"/api/cambios/{cambio['id']}/aplicar")).json()
    assert r["estado"] == "caducada" and "ha cambiado" in r["motivo_estado"]
    assert len(await _pasos_n1(cliente, pid)) == 2


async def test_sin_bloque_cambio_no_se_prepara_nada(cliente) -> None:
    pid, cid = await _preparado(cliente)
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "Explícame esta pantalla", "asesor": True, "proyecto_id": pid})
    assert not any(e.startswith("cambio") for e, _ in eventos_sse(r.text))
