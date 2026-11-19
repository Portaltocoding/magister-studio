"""El asesor que hace cosas: decide si lee o propone, el código valida las acciones y solo se aplican si las apruebas."""

from datetime import date

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
    assert cambio["en_breve"] == "Añade 1 paso."  # lo cuenta el código, no lo que dijo el chat
    # Nada cambia hasta que lo apruebas.
    assert len(await _pasos_n1(cliente, pid)) == 2
    assert [c["id"] for c in (await cliente.get(f"/api/conversaciones/{cid}/cambios")).json()] == [cambio["id"]]

    r = (await cliente.post(f"/api/cambios/{cambio['id']}/aplicar")).json()
    assert r["estado"] == "aplicada" and r["nuevos"] == ["n1-b1-p3"]
    assert [x["titulo"] for x in await _pasos_n1(cliente, pid)][-1] == "Tests con moto"
    assert (await cliente.post(f"/api/cambios/{cambio['id']}/aplicar")).status_code == 409  # dos veces no hace nada

    assert (await cliente.post(f"/api/cambios/{cambio['id']}/deshacer")).json()["estado"] == "deshecha"
    assert len(await _pasos_n1(cliente, pid)) == 2


async def _propuesto(cliente, cid: int, pid: int, *acciones: dict) -> dict:
    from magister.cerebro.estructura import eco

    eco.encolar(ag.Paso, [_propone(*acciones)])
    return next(d for e, d in await _pedir(cliente, cid, pid) if e == "cambio")


async def _cambiar_roadmap(pid: int, cambiar) -> None:
    from magister.datos.proyectos import Proyecto
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s, s.begin():
        p = await s.get(Proyecto, pid)
        r = __import__("copy").deepcopy(p.roadmap)
        cambiar(r)
        p.roadmap = r


async def test_si_el_proyecto_cambia_antes_de_aplicarlo_la_propuesta_caduca(cliente) -> None:
    pid, cid = await _preparado(cliente)
    cambio = await _propuesto(cliente, cid, pid, {"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("Tests con moto")]})
    await _cambiar_roadmap(pid, lambda r: r["niveles"][0]["bloques"][0]["pasos"][0].update(titulo="Crea la cuenta y el MFA"))
    r = (await cliente.post(f"/api/cambios/{cambio['id']}/aplicar")).json()
    assert r["estado"] == "caducada" and "ha cambiado" in r["motivo_estado"]
    assert len(await _pasos_n1(cliente, pid)) == 2


async def test_marcar_un_paso_que_la_propuesta_no_toca_no_la_caduca(cliente) -> None:
    pid, cid = await _preparado(cliente)
    anadir = await _propuesto(cliente, cid, pid, {"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("Tests con moto")]})
    quitar = await _propuesto(cliente, cid, pid, {"tipo": "quitar_paso", "paso_id": "n1-b1-p2"})
    await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p1", json={"hecho": True})
    # Añadir no depende de lo hecho: se aplica, y la marca de después se queda.
    r = (await cliente.post(f"/api/cambios/{anadir['id']}/aplicar")).json()
    assert r["estado"] == "aplicada"
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["hechos"] == ["n1-b1-p1"] and len(rm.pasos(p["roadmap"])) == 3
    # Quitar un paso sí depende de si está hecho (se pierde): marcarlo después lo caduca. (Esta, además, ya era de
    # otro roadmap: el que acaba de cambiar el cambio aplicado.)
    await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p2", json={"hecho": True})
    assert (await cliente.post(f"/api/cambios/{quitar['id']}/aplicar")).json()["estado"] == "caducada"
    pid, cid = await _preparado(cliente)
    quitar = await _propuesto(cliente, cid, pid, {"tipo": "quitar_paso", "paso_id": "n1-b1-p2"})
    await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p2", json={"hecho": True})
    assert (await cliente.post(f"/api/cambios/{quitar['id']}/aplicar")).json()["estado"] == "caducada"
    # Y marcar otro paso (el p1) no la caduca.
    quitar = await _propuesto(cliente, cid, pid, {"tipo": "quitar_paso", "paso_id": "n1-b1-p2"})
    await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p1", json={"hecho": True})
    assert (await cliente.post(f"/api/cambios/{quitar['id']}/aplicar")).json()["estado"] == "aplicada"
    assert (await cliente.get(f"/api/proyectos/{pid}")).json()["hechos"] == ["n1-b1-p1"]


async def test_deshacer_es_exacto_y_respeta_lo_que_marcaste_despues(cliente) -> None:
    pid, cid = await _preparado(cliente)
    marcar = await _propuesto(cliente, cid, pid, {"tipo": "marcar_paso", "paso_id": "n1-b1-p1", "hecho": True},
                              {"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("Tests con moto")]})
    assert (await cliente.post(f"/api/cambios/{marcar['id']}/aplicar")).json()["estado"] == "aplicada"
    # Después marcas otro paso a mano: deshacer quita lo que hizo el cambio (la marca del p1 y el paso nuevo) y deja
    # la tuya.
    await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p2", json={"hecho": True})
    assert (await cliente.post(f"/api/cambios/{marcar['id']}/deshacer")).json()["estado"] == "deshecha"
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["hechos"] == ["n1-b1-p2"] and list(p["hechos_en"]) == ["n1-b1-p2"] and len(rm.pasos(p["roadmap"])) == 2
    # Si marcas lo que el cambio tocó (el paso que creó), no se deshace a ciegas.
    anadir = await _propuesto(cliente, cid, pid, {"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("Tests con moto")]})
    nuevo = (await cliente.post(f"/api/cambios/{anadir['id']}/aplicar")).json()["nuevos"][0]
    await cliente.put(f"/api/proyectos/{pid}/pasos/{nuevo}", json={"hecho": True})
    r = await cliente.post(f"/api/cambios/{anadir['id']}/deshacer")
    assert r.status_code == 409 and "has marcado o desmarcado un paso que tocó este cambio" in r.json()["detail"]
    # Y dos veces, en buen castellano.
    r = await cliente.post(f"/api/cambios/{marcar['id']}/deshacer")
    assert r.status_code == 409 and r.json()["detail"] == "solo se deshace un cambio aplicado (este está deshecho)"
    r = await cliente.post(f"/api/cambios/{anadir['id']}/aplicar")
    assert r.status_code == 409 and r.json()["detail"] == "este cambio ya está aplicado"
    r = await cliente.post("/api/cambios/abc/aplicar")
    assert r.status_code == 422 and r.json()["detail"] == "el número del cambio tiene que ser un número entero"


async def test_con_el_proyecto_en_cola_el_asesor_cambia_lo_que_no_choca(cliente) -> None:
    pid, cid = await _preparado(cliente)
    assert (await cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar")).json()["estado"] == "en_cola"
    # Se prepara (antes daba 409 todo el rato) y se aplica fuera del nivel que espera a detallarse.
    fuera = await _propuesto(cliente, cid, pid, {"tipo": "anadir_pasos", "bloque_id": "n1-b1", "pasos": [_paso("Tests con moto")]})
    dentro = await _propuesto(cliente, cid, pid, {"tipo": "nuevo_bloque", "nivel_id": "n2", "titulo": "Desplegar",
                                                  "priming": "Llevarlo a la nube cuando el plan ya se aprueba."})
    r = await cliente.post(f"/api/cambios/{dentro['id']}/aplicar")
    assert r.status_code == 409 and "el nivel 2 está en la cola para detallarse" in r.json()["detail"]
    # No caduca: sigue en propuesta para cuando acabe.
    assert [c["estado"] for c in (await cliente.get(f"/api/conversaciones/{cid}/cambios")).json()][-1] == "propuesta"
    assert (await cliente.post(f"/api/cambios/{fuera['id']}/aplicar")).json()["estado"] == "aplicada"
    # Deshacer lo de fuera también vale con el trabajo en cola.
    assert (await cliente.post(f"/api/cambios/{fuera['id']}/deshacer")).json()["estado"] == "deshecha"


async def test_sin_bloque_cambio_no_se_prepara_nada(cliente) -> None:
    pid, cid = await _preparado(cliente)
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": "Explícame esta pantalla", "asesor": True, "proyecto_id": pid})
    assert not any(e.startswith("cambio") for e, _ in eventos_sse(r.text))


# --- El plan de estudio activo y la agenda --------------------------------------------------------------------------

HOY = date(2026, 11, 19)  # jueves


def _plan(**extra) -> dict:
    """Dos horas de lunes a viernes desde las 17:00. L2 depende de L1 y L3 de L2."""
    return {"plan_id": 1, "tema_id": 1, "tema": "Cálculo", "horas_por_dia": [2, 2, 2, 2, 2, 0, 0],
            "inicio_por_dia": ["17:00"] * 5 + [None, None],
            "lecciones": [{"clave": "L1", "titulo": "Límites", "horas": 1, "depende_de": [], "apuntes": "listos"},
                          {"clave": "L2", "titulo": "Derivadas", "horas": 1, "depende_de": ["L1"], "apuntes": None},
                          {"clave": "L3", "titulo": "Integrales", "horas": 2, "depende_de": ["L2"], "apuntes": None}],
            "sesiones": [{"id": 10, "clave": "L1", "fecha": "2026-11-19", "inicio": "17:00", "horas": 1, "estado": "pendiente"},
                         {"id": 11, "clave": "L2", "fecha": "2026-11-19", "inicio": "18:00", "horas": 1, "estado": "pendiente"},
                         {"id": 12, "clave": "L3", "fecha": "2026-11-20", "inicio": "17:00", "horas": 2, "estado": "pendiente"}],
            "eventos": [], **extra}


def _en_plan(plan: dict | None, *acciones: dict) -> cb.Resultado:
    return cb.simular(_cambios(*acciones), None, MOMENTO, plan, HOY)


def _errores_plan(plan: dict | None, *acciones: dict) -> str:
    return " ".join(_en_plan(plan, *acciones).errores)


def test_mover_una_sesion_respeta_el_dia_la_medianoche_y_las_dependencias() -> None:
    p = _plan()
    r = _en_plan(p, {"tipo": "mover_sesion", "sesion_id": 12, "fecha": "2026-11-23"})
    assert r.errores == [] and r.movidas == {12}
    assert (r.plan["sesiones"][2]["fecha"], r.plan["sesiones"][2]["inicio"]) == ("2026-11-23", "17:00")  # a la hora de ese día
    assert r.lineas[0].texto == ("Mover la sesión de L3 «Integrales» (2 h) del viernes 20 de noviembre a las 17:00 al "
                                 "lunes 23 de noviembre a las 17:00")
    assert p["sesiones"][2]["fecha"] == "2026-11-20"  # el original, intacto
    # Sin hora, detrás de lo que ya hay ese día; y el día no pasa de sus horas.
    assert "tendrías 3 h de este plan y ese día estudias 2 h" in _errores_plan(p, {"tipo": "mover_sesion", "sesion_id": 11, "fecha": "2026-11-20"})
    assert "no tienes horas de estudio" in _errores_plan(p, {"tipo": "mover_sesion", "sesion_id": 12, "fecha": "2026-11-21"})
    assert "pasaría de medianoche" in _errores_plan(p, {"tipo": "mover_sesion", "sesion_id": 11, "fecha": "2026-11-23", "hora": "23:30"})
    assert "ya ha pasado" in _errores_plan(p, {"tipo": "mover_sesion", "sesion_id": 11, "fecha": "2026-11-18"})
    assert "quedaría antes de L1 «Límites»" in _errores_plan(p, {"tipo": "mover_sesion", "sesion_id": 10, "fecha": "2026-11-23"})
    assert "no existe la sesión" in _errores_plan(p, {"tipo": "mover_sesion", "sesion_id": 99, "fecha": "2026-11-23"})
    hecha = _plan()
    hecha["sesiones"][0]["estado"] = "hecha"
    assert "solo se mueven las pendientes" in _errores_plan(hecha, {"tipo": "mover_sesion", "sesion_id": 10, "fecha": "2026-11-23"})
    # Dos sesiones no se pisan (sin horario, solo cuenta eso).
    libre = _plan(horas_por_dia=None)
    assert "se pisaría con la de L1" in _errores_plan(libre, {"tipo": "mover_sesion", "sesion_id": 12, "fecha": "2026-11-19", "hora": "17:30"})
    # Solo cuenta cómo queda al final: mover L2 y L3 juntas vale.
    assert _errores_plan(p, {"tipo": "mover_sesion", "sesion_id": 11, "fecha": "2026-11-23"},
                         {"tipo": "mover_sesion", "sesion_id": 12, "fecha": "2026-11-24"}) == ""
    assert "no hay ningún plan" in _errores_plan(None, {"tipo": "mover_sesion", "sesion_id": 12, "fecha": "2026-11-23"})


def test_marcar_preparar_y_apuntar_en_la_agenda() -> None:
    p = _plan()
    r = _en_plan(p, {"tipo": "marcar_leccion", "clave": "l1", "hecho": True},
                 {"tipo": "preparar_leccion", "clave": "L2"},
                 {"tipo": "apuntar_evento", "titulo": "Parcial de cálculo", "fecha": "2026-11-27", "hora": "10:00", "tipo_evento": "examen"})
    assert r.errores == []
    assert r.plan["sesiones"][0]["estado"] == "hecha" and r.marcar == [("L1", True)] and r.preparar == ["L2"]
    assert r.eventos == [{"fecha": "2026-11-27", "hora": "10:00", "titulo": "Parcial de cálculo", "tipo": "examen"}]
    assert [x.texto for x in r.lineas] == ["Marcar L1 «Límites» como hecha (1 sesión)", "Preparar los apuntes de L2 «Derivadas» (gasta cuota)",
                                          "Apuntar en tu agenda: examen «Parcial de cálculo» el viernes 27 de noviembre a las 10:00"]
    assert [x.deshace for x in r.lineas] == [True, False, True]
    assert "ya tiene apuntes" in _errores_plan(p, {"tipo": "preparar_leccion", "clave": "L1"})
    assert "ya está pendiente" in _errores_plan(p, {"tipo": "marcar_leccion", "clave": "L1", "hecho": False})
    # La agenda no necesita plan; el plan sí.
    assert _errores_plan(None, {"tipo": "apuntar_evento", "titulo": "Entregar la práctica", "fecha": "2026-11-20"}) == ""
    assert "no hay ningún plan" in _errores_plan(None, {"tipo": "marcar_leccion", "clave": "L1", "hecho": True})
    assert "ya ha pasado" in _errores_plan(None, {"tipo": "apuntar_evento", "titulo": "Entregar", "fecha": "2026-11-01"})
    # «Deshacer» no sale para un cambio que solo prepara apuntes.
    assert not cb.deshacible([{"texto": "Preparar…", "motivo": "…", "deshace": False}])
    assert cb.deshacible([{"texto": "Preparar…", "motivo": "…", "deshace": False}, {"texto": "Mover…", "motivo": "…"}])


def test_la_huella_cubre_el_plan_solo_si_el_cambio_lo_toca() -> None:
    proyecto, p = _proyecto(), _plan()
    nota = _cambios({"tipo": "guardar_nota", "nota": "Algo que guardar."})
    mover = _cambios({"tipo": "mover_sesion", "sesion_id": 12, "fecha": "2026-11-23"})
    assert cb.huella_de(nota, proyecto, p) == cb.huella_propuesta(nota, proyecto)  # como antes
    otro = _plan()
    otro["sesiones"][0]["estado"] = "hecha"
    assert cb.huella_de(mover, None, p) != cb.huella_de(mover, None, otro)
    assert cb.huella_de(nota, None, p) == cb.huella_de(nota, None, otro) is None


def test_el_agente_ve_el_plan_y_lee_otros_dias() -> None:
    p = _plan()
    p["sesiones"].append({"id": 13, "clave": "L3", "fecha": "2026-12-20", "inicio": "17:00", "horas": 1, "estado": "pendiente"})
    texto = ag.texto_plan(p, HOY)
    assert '"id": 12' in texto and '"id": 13' not in texto and "viernes 20 de noviembre" in texto
    assert "no hay ningún plan" in ag.texto_plan(None, HOY)

    def reglas(**lectura) -> str:
        paso = ag.Paso.model_validate({"falta": "…", "leer": [{"herramienta": "ver_calendario", **lectura}]})
        return " ".join(ag.reglas_paso(paso, [], False, None, MOMENTO, p, HOY))

    assert reglas(desde="2026-12-14", hasta="2026-12-20") == ""
    assert "necesita `desde`" in reglas()
    assert "como mucho" in reglas(desde="2026-12-01", hasta="2026-12-31")
    from magister.asesor import herramientas as h

    assert h.descripcion({"herramienta": "ver_calendario", "desde": "2026-11-28", "hasta": "2026-12-04"}) == \
        "tu calendario del 28 de noviembre al 4 de diciembre"


async def _plan_guardado() -> tuple[int, dict[str, int]]:
    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion

    lecciones = [{"clave": c, "titulo": t, "objetivos": ["Explicar algo"], "conceptos": [{"id": f"c-{c.lower()}", "nombre": t}],
                  "horas": h, "depende_de": d} for c, t, h, d in (("L1", "Límites", 1, []), ("L2", "Derivadas", 1, ["L1"]),
                                                                  ("L3", "Integrales", 2, ["L2"]))]
    sesiones = [{"clave": "L1", "fecha": "2026-11-19", "inicio": "17:00", "horas": 1},
                {"clave": "L2", "fecha": "2026-11-19", "inicio": "18:00", "horas": 1},
                {"clave": "L3", "fecha": "2026-11-20", "inicio": "17:00", "horas": 2}]
    perfil = {"horas_por_dia": [2, 2, 2, 2, 2, 0, 0], "inicio_por_dia": ["17:00"] * 5 + [None, None]}
    _, plan_id = await dp.guardar_plan("Cálculo", None, perfil, {"razonamiento": "x", "lecciones": lecciones}, sesiones, None, None)
    async with nueva_sesion() as s:
        ids = {x.leccion_clave: x.id for x in await dp.sesiones(s, plan_id)}
    return plan_id, ids


async def _sesiones(plan_id: int) -> dict[str, tuple[str, str | None, str]]:
    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        return {x.leccion_clave: (x.fecha.isoformat(), x.inicio.strftime("%H:%M") if x.inicio else None, x.estado)
                for x in await dp.sesiones(s, plan_id)}


@pytest.fixture
def el_19_de_noviembre(monkeypatch) -> None:
    from datetime import datetime, timezone

    from magister.api import rutas_asesor, rutas_conversaciones

    monkeypatch.setattr(rutas_asesor, "ahora", lambda: datetime(2026, 11, 19, 9, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(rutas_conversaciones, "hoy", lambda: HOY)


async def _pedir_en_plan(cliente, plan_id: int, *acciones: dict) -> dict:
    from magister.cerebro.estructura import eco

    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Asesor · Calendario", "tipo": "asesor"})).json()["id"]
    eco.encolar(ag.Paso, [_propone(*acciones)])
    pregunta = "Hecho.\n```cambio\nMover la sesión de L3 del viernes al lunes.\n```"
    r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": pregunta, "asesor": True, "plan_activo_id": plan_id})
    return next(d for e, d in eventos_sse(r.text) if e == "cambio")


async def test_en_el_plan_se_aplica_y_se_deshace(cliente, el_19_de_noviembre) -> None:
    from sqlalchemy import select

    from magister.datos.agenda import Evento
    from magister.datos.sesion import nueva_sesion

    plan_id, ids = await _plan_guardado()
    cambio = await _pedir_en_plan(cliente, plan_id, {"tipo": "mover_sesion", "sesion_id": ids["L3"], "fecha": "2026-11-23"},
                                  {"tipo": "marcar_leccion", "clave": "L1", "hecho": True},
                                  {"tipo": "apuntar_evento", "titulo": "Parcial de cálculo", "fecha": "2026-11-27", "tipo_evento": "examen"})
    assert cambio["plan_id"] == plan_id and cambio["deshacible"] and len(cambio["lineas"]) == 3
    antes = await _sesiones(plan_id)
    assert antes["L3"] == ("2026-11-20", "17:00", "pendiente")  # nada cambia hasta que lo apruebas

    assert (await cliente.post(f"/api/cambios/{cambio['id']}/aplicar")).json()["estado"] == "aplicada"
    despues = await _sesiones(plan_id)
    assert despues["L3"] == ("2026-11-23", "17:00", "pendiente") and despues["L1"][2] == "hecha"
    async with nueva_sesion() as s:
        assert [e.titulo for e in (await s.scalars(select(Evento))).all()] == ["Parcial de cálculo"]

    assert (await cliente.post(f"/api/cambios/{cambio['id']}/deshacer")).json()["estado"] == "deshecha"
    assert await _sesiones(plan_id) == antes
    async with nueva_sesion() as s:
        assert (await s.scalars(select(Evento))).all() == []


async def test_si_el_calendario_cambia_antes_de_aplicarlo_caduca(cliente, el_19_de_noviembre) -> None:
    plan_id, ids = await _plan_guardado()
    cambio = await _pedir_en_plan(cliente, plan_id, {"tipo": "mover_sesion", "sesion_id": ids["L3"], "fecha": "2026-11-23"})
    await cliente.patch(f"/api/sesiones/{ids['L1']}", json={"estado": "hecha"})
    r = (await cliente.post(f"/api/cambios/{cambio['id']}/aplicar")).json()
    assert r["estado"] == "caducada" and "calendario ha cambiado" in r["motivo_estado"]
    assert (await _sesiones(plan_id))["L3"][0] == "2026-11-20"


async def test_preparar_apuntes_encola_como_lecciones_y_no_se_deshace(cliente, el_19_de_noviembre) -> None:
    from sqlalchemy import select

    from magister.datos.material import Trabajo
    from magister.datos.sesion import nueva_sesion

    plan_id, _ = await _plan_guardado()
    cambio = await _pedir_en_plan(cliente, plan_id, {"tipo": "preparar_leccion", "clave": "L2"})
    assert cambio["lineas"][0]["texto"] == "Preparar los apuntes de L2 «Derivadas» (gasta cuota)" and not cambio["deshacible"]
    assert (await cliente.post(f"/api/cambios/{cambio['id']}/aplicar")).json()["estado"] == "aplicada"
    async with nueva_sesion() as s:
        trabajos = (await s.scalars(select(Trabajo))).all()
    assert [(t.tipo, t.plan_id, t.leccion_clave) for t in trabajos] == [("material", plan_id, "L2")]
    # El mismo trabajo que pide el botón de Lecciones (misma clave): no se encola dos veces.
    r = await cliente.post(f"/api/planes/{plan_id}/lecciones/L2/material", json={})
    assert r.json() == {"trabajo_id": trabajos[0].id, "nuevo": False}
    assert (await cliente.post(f"/api/cambios/{cambio['id']}/deshacer")).status_code == 409


# --- Lo que dice la tarjeta lo escribe el código ----------------------------------------------------------------------

def test_lo_que_hace_la_propuesta_en_una_frase_sale_de_sus_acciones() -> None:
    def breve(*acciones: dict) -> str:
        return cb.en_breve([{"motivo": "…", **a} for a in acciones])

    bloque = {"tipo": "nuevo_bloque", "nivel_id": "n1", "titulo": "Tests", "priming": "…", "pasos": [_paso(f"P{i}") for i in range(5)]}
    assert breve(bloque) == "Añade 1 bloque y 5 pasos."
    # El bloque sin pasos que el asesor anunció «con cinco pasos»: la tarjeta dice lo que hay de verdad.
    assert breve({**bloque, "pasos": []}) == "Añade 1 bloque."
    assert breve({"tipo": "cambiar_paso", "paso_id": "n1-b1-p1"}, {"tipo": "cambiar_paso", "paso_id": "n1-b1-p2"},
                 {"tipo": "cambiar_bloque", "bloque_id": "n1-b1"}, {"tipo": "quitar_paso", "paso_id": "n1-b1-p3"},
                 {"tipo": "apuntar_decision"}) == "Cambia 2 pasos y 1 bloque, quita 1 paso y apunta 1 decisión en el diario."
    assert breve({"tipo": "nuevo_nivel", "bloques": [{"titulo": "A", "priming": "…"}, {"titulo": "B", "priming": "…"}]}) == "Añade 1 nivel y 2 bloques."
    assert breve() == ""


def test_los_ids_no_llegan_al_alumno() -> None:
    r = _roadmap()
    assert cb.sin_ids("Lo pongo en el paso n1-b1-p2, tras n1-b1-p1.", r) == "Lo pongo en el paso «Alarmas de gasto», tras «Crea la cuenta»."
    assert cb.sin_ids("En el bloque n1-b1 del nivel n2.", r) == "En el bloque «La cuenta» del nivel 2 «Aplica»."
    # Lo que no es un id del proyecto (n8-b1, una versión), tal cual.
    assert cb.sin_ids("Usa n8-b1 y la v2-b1.", r) == "Usa n8-b1 y la v2-b1."
    assert cb.sin_ids(None, r) is None
