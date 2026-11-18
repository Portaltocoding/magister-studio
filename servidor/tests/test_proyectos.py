"""Proyectos: el roadmap se monta con ids estables, el nivel 1 trae sus pasos, lo hecho se conserva al detallar."""

import pytest

from magister.proyectos import roadmap as rm

pytestmark = pytest.mark.anyio


def _paso(t: str, hecho_si: str = "aws sts get-caller-identity devuelve tu usuario", minutos: int = 30) -> rm.PasoGen:
    return rm.PasoGen(titulo=t, que_haces="Crea un usuario IAM con permisos de solo lectura.",
                      antes="IAM decide quién puede hacer qué en la cuenta de AWS.", hecho_si=hecho_si, minutos=minutos)


def _roadmap(pasos_n1: int = 2) -> rm.RoadmapGen:
    return rm.RoadmapGen(
        resumen="Línea 1.\nLínea 2.", que_es="Un agente que lee instancias EC2.", por_que="Porque sí.",
        glosario=[rm.Termino(termino=t, definicion="…") for t in ("IAM", "Instancia EC2", "Región")],
        arquitectura="Agente, herramientas y cuenta en una región.",
        niveles=[
            rm.NivelGen(titulo="Solo lectura", objetivo="Lee y propone.", priming="Primero mirar.",
                        bloques=[rm.BloqueGen(titulo="Ver la cuenta", priming="…", pasos=[_paso(f"p{i}") for i in range(pasos_n1)])]),
            rm.NivelGen(titulo="Aprobar y aplicar", objetivo="Aplica.", priming="Después tocar.",
                        bloques=[rm.BloqueGen(titulo="Plan", priming="El plan se aprueba antes de aplicarlo.")]),
        ],
        riesgos=[rm.Riesgo(riesgo="Coste", mitigacion="Un presupuesto con avisos."), rm.Riesgo(riesgo="Borrar algo", mitigacion="Primero en simulacro (dry-run).")],
    )


def test_el_nivel_1_tiene_que_traer_pasos_y_los_priming_son_cortos() -> None:
    assert rm.reglas_roadmap(_roadmap(2)) == []
    assert any("nivel 1" in e for e in rm.reglas_roadmap(_roadmap(1)))
    largo = _roadmap(2)
    largo.resumen = "\n".join(f"Línea {i}." for i in range(9))
    assert any("resumen" in e for e in rm.reglas_roadmap(largo))


def test_un_esqueleto_fiable_sin_juez() -> None:
    """Pasos comprobables y de tamaño razonable, sin títulos repetidos, y un glosario de lo que sale de verdad."""
    r = _roadmap(2)
    r.niveles[0].bloques[0].pasos[0] = _paso("p0", hecho_si="Funciona")
    r.niveles[0].bloques[0].pasos[1] = _paso("p0", minutos=600)
    errores = " ".join(rm.reglas_roadmap(r))
    assert "comprobable" in errores and "dura 600 min" in errores and "mismo título" in errores
    r = _roadmap(2)
    r.glosario.append(rm.Termino(termino="CloudTrail", definicion="…"))
    r.glosario.append(rm.Termino(termino="Instancias EC2", definicion="…"))  # plural de algo que sí sale: vale
    assert [e for e in rm.reglas_roadmap(r) if "glosario" in e] == [
        "Estos términos del glosario no salen en el roadmap (quítalos o úsalos donde toque): CloudTrail."]


def test_montar_pone_ids_estables_y_marca_el_mvp() -> None:
    m = rm.montar(_roadmap(3))
    n1, n2 = m["niveles"]
    assert n1["mvp"] and n1["detallado"] and not n2["mvp"] and not n2["detallado"]
    assert [p["id"] for p in n1["bloques"][0]["pasos"]] == ["n1-b1-p1", "n1-b1-p2", "n1-b1-p3"]
    assert n2["bloques"][0]["id"] == "n2-b1" and n2["bloques"][0]["pasos"] == []


def test_detallar_un_nivel_no_toca_los_demas() -> None:
    m = rm.montar(_roadmap(2))
    nuevo = rm.con_nivel_detallado(m, 2, rm.NivelDetallado(bloques=[rm.BloqueGen(titulo="Plan", priming="…", pasos=[_paso("a"), _paso("b")])]))
    assert nuevo["niveles"][0] == m["niveles"][0]
    assert nuevo["niveles"][1]["detallado"] and [p["id"] for p in rm.pasos(nuevo)][-2:] == ["n2-b1-p1", "n2-b1-p2"]


async def test_un_proyecto_de_punta_a_punta_por_la_api(cliente, monkeypatch) -> None:
    from magister.proyectos import trabajo

    async def roadmap_falso(datos, referencias):
        assert datos["nombre"] == "Copiloto" and referencias == []
        return rm.montar(_roadmap(2))

    async def nivel_falso(mapa, numero, hechos, decisiones, datos):
        assert hechos == ["n1-b1-p1"] and decisiones[0]["titulo"] == "Usar boto3"
        return rm.con_nivel_detallado(mapa, numero, rm.NivelDetallado(bloques=[rm.BloqueGen(titulo="Plan", priming="…", pasos=[_paso("a"), _paso("b")])]))

    async def sin_dibujo(datos, mapa):
        return None

    async def fase(*a):
        return None

    monkeypatch.setattr(rm, "generar_roadmap", roadmap_falso)
    monkeypatch.setattr(rm, "detallar_nivel", nivel_falso)
    monkeypatch.setattr(rm, "dibujar_arquitectura", sin_dibujo)
    monkeypatch.setattr(trabajo.cola, "fase", fase)

    r = await cliente.post("/api/proyectos", json={"nombre": "Copiloto", "idea": "Un agente que opera mi cuenta de AWS sin tocar nada sin permiso.", "investigar": False})
    assert r.status_code == 201 and r.json()["estado"] == "generando"
    pid = r.json()["id"]
    await trabajo.ejecutar(0, "proyecto_roadmap", {"proyecto_id": pid, "investigar": False})
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["estado"] == "listo" and p["progreso"] == {"pasos": 2, "hechos": 0, "nivel": 1, "niveles": 2}

    assert (await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p1", json={"hecho": True})).json()["progreso"]["hechos"] == 1
    assert (await cliente.put(f"/api/proyectos/{pid}/pasos/no-existe", json={"hecho": True})).status_code == 404
    await cliente.post(f"/api/proyectos/{pid}/decisiones", json={"titulo": "Usar boto3", "decision": "El SDK oficial de AWS para Python."})
    assert (await cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar")).status_code == 200
    await trabajo.ejecutar(0, "proyecto_nivel", {"proyecto_id": pid, "numero": 2})
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["hechos"] == ["n1-b1-p1"] and p["progreso"]["pasos"] == 4
    assert list(p["hechos_en"]) == ["n1-b1-p1"]  # cuándo se marcó, para retomar
    await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p1", json={"hecho": False})
    assert (await cliente.get(f"/api/proyectos/{pid}")).json()["hechos_en"] == {}
    assert [x["nombre"] for x in (await cliente.get("/api/proyectos")).json()][0] == "Copiloto"
    assert (await cliente.delete(f"/api/proyectos/{pid}")).status_code == 204
    assert (await cliente.get(f"/api/proyectos/{pid}")).status_code == 404


async def test_un_proyecto_nunca_se_queda_generando_si_su_trabajo_ya_no_va(cliente) -> None:
    from magister.trabajos import cola

    r = await cliente.post("/api/proyectos", json={"nombre": "Atascado", "idea": "Un proyecto cuyo trabajo va a fallar del todo.", "investigar": False})
    pid = r.json()["id"]
    ver = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert ver["estado"] == "generando" and ver["trabajo"]["estado"] == "pendiente" and "trabajador_vivo" in ver["trabajo"]
    # El trabajo falla del todo: la lista ya lo dice sin tener que abrir el proyecto.
    await cola.terminar(ver["trabajo"]["id"], "fallido", "el modelo no contestó")
    lista = {x["id"]: x for x in (await cliente.get("/api/proyectos")).json()}
    assert lista[pid]["estado"] == "error" and lista[pid]["error"] == "el modelo no contestó"
    # Reintentar lo vuelve a poner en marcha.
    assert (await cliente.post(f"/api/proyectos/{pid}/rehacer")).json()["estado"] == "generando"
    # Si su trabajo desaparece (se borró la cola, una restauración), tampoco se queda colgado.
    from sqlalchemy import delete

    from magister.datos.material import Trabajo
    from magister.datos.sesion import nueva_sesion

    tid = (await cliente.get(f"/api/proyectos/{pid}")).json()["trabajo"]["id"]
    async with nueva_sesion() as s, s.begin():
        await s.execute(delete(Trabajo).where(Trabajo.id == tid))
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["estado"] == "error" and "perdió" in p["error"]
