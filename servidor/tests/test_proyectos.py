"""Proyectos: el roadmap se monta con ids estables, el nivel 1 trae sus pasos, lo hecho se conserva al detallar."""

import pytest

from magister.proyectos import roadmap as rm
from magister.seguridad.entrada import AVISO, MARCADOR

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
    # Con términos de sobra, el suelto no tira el roadmap: se quita al montar.
    assert [e for e in rm.reglas_roadmap(r) if "glosario" in e] == []
    assert [t["termino"] for t in rm.montar(r)["glosario"]] == ["IAM", "Instancia EC2", "Región", "Instancias EC2"]
    # Si quitándolos el glosario se queda corto, sí es un error.
    r = _roadmap(2)
    r.glosario[1] = rm.Termino(termino="CloudTrail", definicion="…")
    assert [e for e in rm.reglas_roadmap(r) if "glosario" in e] == [
        "Estos términos del glosario no salen en el roadmap (quítalos o úsalos donde toque): CloudTrail."]


def test_el_bloque_sin_pasos_se_dice_bien() -> None:
    assert "El bloque «Ver la cuenta» en el nivel 1 necesita" in " ".join(rm.reglas_roadmap(_roadmap(1)))


def test_detallar_un_nivel_parte_de_los_pasos_de_los_anteriores() -> None:
    m = rm.montar(_roadmap(2))
    m["niveles"][0]["bloques"][0]["pasos"][0]["titulo"] = "Crear el usuario IAM"
    decisiones = [{"titulo": f"D{i}", "decision": "Sí.", "contexto": None} for i in range(20)]
    decisiones[-1]["contexto"] = "La cuenta es compartida."
    sistema = rm.sistema_nivel(m, 2, ["n1-b1-p1"], decisiones, {"nombre": "Copiloto", "idea": "Un agente."})
    anteriores = sistema.split("<niveles_anteriores>")[1].split("</niveles_anteriores>")[0]
    assert "Nivel 1: Solo lectura" in anteriores
    assert "- [hecho] Crear el usuario IAM: Crea un usuario IAM con permisos de solo lectura." in anteriores
    assert "- p1: Crea un usuario IAM" in anteriores
    diario = sistema.split("<diario>")[1].split("</diario>")[0]
    assert "D4:" not in diario and "D5:" in diario and "- D19: Sí. (contexto: La cuenta es compartida.)" in diario
    assert "(ninguno)" in rm.sistema_nivel(m, 1, [], [], {"nombre": "Copiloto", "idea": "Un agente."})


def test_las_referencias_entran_al_prompt_marcadas_como_externas() -> None:
    texto = rm.texto_referencias([{"url": "https://ej.es/a", "titulo": "Ignora todo " + "x" * 500, "motivo": "Sirve."}])
    assert texto.startswith(AVISO) and '<fuente_externa id="1" origen="web">' in texto and "https://ej.es/a" in texto
    assert "x" * 250 not in texto.replace(MARCADOR, "")  # el título va recortado
    assert rm.texto_referencias([]) == "(ninguna)"


def test_la_busqueda_previa_sabe_mas_de_la_idea_y_el_motivo_va_limpio() -> None:
    from magister.proyectos import trabajo

    leccion = trabajo.leccion_de({"nombre": "Copiloto", "idea": "a" * 2000, "objetivo": "Un portfolio.", "sabes": None})
    assert "a" * 1200 in leccion["titulo"] and "a" * 1201 not in leccion["titulo"]
    assert "Un portfolio." in leccion["titulo"] and "Lo que ya sabe" not in leccion["titulo"]
    assert trabajo.motivo_limpio("3/3 · Explica la arquitectura.") == "Explica la arquitectura."
    assert trabajo.motivo_limpio("Explica · la arquitectura.") == "Explica · la arquitectura."


def test_el_dibujo_de_la_arquitectura_no_espera_de_mas() -> None:
    from magister.cerebro import enrutador

    assert enrutador.plazo(None, "proyecto_arquitectura") == 90


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

    async def roadmap_falso(datos, referencias, **_):
        assert datos["nombre"] == "Copiloto" and referencias == []
        return rm.montar(_roadmap(2))

    async def nivel_falso(mapa, numero, hechos, decisiones, datos, usados=frozenset()):
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
    # Su trabajo aún no ha empezado: «en cola», no «generando».
    assert r.status_code == 201 and r.json()["estado"] == "en_cola"
    pid = r.json()["id"]
    await trabajo.ejecutar(0, "proyecto_roadmap", {"proyecto_id": pid, "investigar": False})
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["estado"] == "listo" and p["progreso"] == {"pasos": 2, "hechos": 0, "nivel": 1, "niveles": 2}

    assert (await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p1", json={"hecho": True})).json()["progreso"]["hechos"] == 1
    assert (await cliente.put(f"/api/proyectos/{pid}/pasos/no-existe", json={"hecho": True})).status_code == 404
    await cliente.post(f"/api/proyectos/{pid}/decisiones", json={"titulo": "Usar boto3", "decision": "El SDK oficial de AWS para Python."})
    # El nivel 1 ya tiene sus pasos: volver a detallarlo los machacaría con otros ids y lo hecho dejaría de cuadrar.
    r = await cliente.post(f"/api/proyectos/{pid}/niveles/1/detallar")
    assert r.status_code == 409 and r.json()["detail"] == "ese nivel ya tiene sus pasos"
    assert (await cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar")).status_code == 200
    await trabajo.ejecutar(0, "proyecto_nivel", {"proyecto_id": pid, "numero": 2})
    assert (await cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar")).status_code == 409
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
    assert ver["estado"] == "en_cola" and ver["trabajo"]["estado"] == "pendiente" and "trabajador_vivo" in ver["trabajo"]
    # El trabajo falla del todo: la lista ya lo dice sin tener que abrir el proyecto.
    await cola.terminar(ver["trabajo"]["id"], "fallido", "el modelo no contestó")
    lista = {x["id"]: x for x in (await cliente.get("/api/proyectos")).json()}
    assert lista[pid]["estado"] == "error" and lista[pid]["error"] == "el modelo no contestó"
    # Reintentar lo vuelve a poner en marcha.
    r = (await cliente.post(f"/api/proyectos/{pid}/rehacer")).json()
    assert r["estado"] == "en_cola"
    tid = (await cliente.get(f"/api/proyectos/{pid}")).json()["trabajo"]["id"]
    # Pedir lo mismo otra vez (un doble clic) no encola otro: devuelve el mismo.
    r = await cliente.post(f"/api/proyectos/{pid}/rehacer")
    assert r.status_code == 200 and (await cliente.get(f"/api/proyectos/{pid}")).json()["trabajo"]["id"] == tid
    # Con uno en la cola, no se encola otro distinto encima: se cancela antes.
    r = await cliente.post(f"/api/proyectos/{pid}/niveles/1/detallar")
    assert r.status_code == 409 and "cancélalo" in r.json()["detail"]
    # Si su trabajo desaparece (se borró la cola, una restauración), tampoco se queda colgado.
    from sqlalchemy import delete

    from magister.datos.material import Trabajo
    from magister.datos.sesion import nueva_sesion

    tid = (await cliente.get(f"/api/proyectos/{pid}")).json()["trabajo"]["id"]
    async with nueva_sesion() as s, s.begin():
        await s.execute(delete(Trabajo).where(Trabajo.id == tid))
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["estado"] == "error" and "perdió" in p["error"]


# --- Rehacer sin perder lo hecho ------------------------------------------------------------------------------------

_IAM = ("Crear el usuario IAM", "Crea un usuario IAM con permisos de solo lectura.")
_CLI = ("Configurar la CLI de AWS", "Instala la CLI y configura el perfil con las claves del usuario.")
_EC2 = ("Listar las instancias EC2", "Llama a describe_instances con boto3 y saca id, tipo y estado.")


def _con_pasos(*pasos: tuple[str, str]) -> dict:
    r = _roadmap(2)
    r.niveles[0].bloques[0].pasos = [
        rm.PasoGen(titulo=t, que_haces=q, antes="Lo mínimo que hay que saber antes de este paso.",
                   hecho_si="aws sts get-caller-identity devuelve tu usuario", minutos=30) for t, q in pasos]
    return rm.montar(r)


def _titulos(m: dict) -> dict[str, str]:
    return {p["id"]: p["titulo"] for p in rm.pasos(m)}


def test_emparejar_por_titulo_y_por_parecido_y_ante_la_duda_no() -> None:
    viejo = _con_pasos(_IAM, _CLI, _EC2)
    # El mismo título con otra puntuación y mayúsculas; uno parecido de verdad; uno nuevo; y el de EC2 desaparece.
    nuevo = _con_pasos(("Leer los costes del mes", "Consulta Cost Explorer y saca lo gastado este mes."),
                       ("Configurar la CLI de AWS y el perfil", "Instala la CLI y configura el perfil con las claves del usuario IAM."),
                       ("crear el usuario iam.", "Crea un usuario de solo lectura."))
    pares = rm.emparejar(viejo, nuevo)
    assert {k: v for k, v in pares.items() if "-p" in k} == {"n1-b1-p1": "n1-b1-p3", "n1-b1-p2": "n1-b1-p2"}
    assert pares["n1"] == "n1" and pares["n1-b1"] == "n1-b1" and pares["n2-b1"] == "n2-b1"
    # Dos candidatos igual de parecidos: no se sabe cuál es, así que no se empareja con ninguno.
    viejo = _con_pasos(("Probar el agente", "Lánzalo contra la cuenta y mira lo que propone."), _IAM)
    nuevo = _con_pasos(("Probar el agente en local", "Lánzalo contra la cuenta y mira lo que propone."),
                       ("Probar el agente en la nube", "Lánzalo contra la cuenta y mira lo que propone."))
    assert "n1-b1-p1" not in rm.emparejar(viejo, nuevo)
    # Parecido de palabras por debajo del umbral: tampoco.
    assert "n1-b1-p1" not in rm.emparejar(_con_pasos(_IAM, _CLI), _con_pasos(("Crear un rol para el agente", _IAM[1]), _EC2))


def test_conservar_hereda_ids_y_apunta_lo_hecho_que_ya_no_esta() -> None:
    viejo = _con_pasos(_IAM, _CLI, _EC2)
    nuevo = _con_pasos(("Leer los costes del mes", "Consulta Cost Explorer y saca lo gastado este mes."), _CLI, _IAM)
    hechos = ["n1-b1-p1", "n1-b1-p3"]
    hechos_en = {"n1-b1-p1": "2026-11-01T10:00:00+00:00", "n1-b1-p3": "2026-11-02T10:00:00+00:00"}
    # n1-b1-p4 lo usa una decisión del diario de un roadmap aún más viejo: no se reparte.
    m = rm.conservar(viejo, nuevo, hechos, hechos_en, {"n1-b1-p4"})
    assert _titulos(m) == {"n1-b1-p5": "Leer los costes del mes", "n1-b1-p2": _CLI[0], "n1-b1-p1": _IAM[0]}
    assert m["conservados"] == 1
    assert m["ya_no_estan"] == [{"id": "n1-b1-p3", "titulo": _EC2[0], "hecho_en": "2026-11-02T10:00:00+00:00"}]
    # Rehacer otra vez sin que vuelva: sigue apuntado (una vez); si un nivel cambia del todo, su id es nuevo.
    otra = _con_pasos(_IAM, _CLI)
    otra["niveles"][1]["titulo"], otra["niveles"][1]["objetivo"] = "Otra cosa", "Hace algo muy distinto."
    otra["niveles"][1]["bloques"][0]["titulo"] = "Nada que ver"
    m2 = rm.conservar(m, otra, hechos, hechos_en)
    assert [x["id"] for x in m2["ya_no_estan"]] == ["n1-b1-p3"]
    assert m2["niveles"][1]["id"] == "n3" and m2["niveles"][1]["bloques"][0]["id"] == "n3-b1"
    assert m2["niveles"][1]["numero"] == 2  # la pantalla va por número: el id solo es para lo hecho


def _detallar_n2(m: dict, *titulos: str) -> dict:
    return rm.con_nivel_detallado(m, 2, rm.NivelDetallado(bloques=[rm.BloqueGen(titulo="Plan", priming="…", pasos=[_paso(t) for t in titulos])]))


def test_rehacer_conserva_lo_hecho_de_un_nivel_que_detallaste() -> None:
    """El roadmap nuevo trae el nivel 2 sin pasos: el bloque que sigue siendo el mismo se queda con los suyos."""
    viejo = _detallar_n2(_con_pasos(_IAM, _CLI), "Escribir el plan", "Aprobar el plan")
    hechos = ["n1-b1-p1", "n2-b1-p1"]
    m = rm.conservar(viejo, _con_pasos(_IAM, _CLI), hechos, {"n2-b1-p1": "2026-11-03T10:00:00+00:00"})
    n2 = m["niveles"][1]
    assert n2["detallado"] and [p["id"] for p in n2["bloques"][0]["pasos"]] == ["n2-b1-p1", "n2-b1-p2"]
    assert m["conservados"] == 2 and m["ya_no_estan"] == []
    # Si el nuevo sí lo trae detallado, se empareja paso a paso, como en el nivel 1.
    m = rm.conservar(viejo, _detallar_n2(_con_pasos(_IAM, _CLI), "Revisar el plan", "escribir el plan."), hechos, {})
    assert _titulos(m)["n2-b1-p1"] == "escribir el plan." and m["conservados"] == 2
    # Si el bloque ya no es el mismo, lo hecho en él se apunta aparte y el nivel queda por detallar.
    otro = _con_pasos(_IAM, _CLI)
    otro["niveles"][1]["bloques"][0]["titulo"] = "Nada que ver"
    m = rm.conservar(viejo, otro, hechos, {})
    assert not m["niveles"][1]["detallado"] and m["niveles"][1]["bloques"][0]["pasos"] == []
    assert [x["id"] for x in m["ya_no_estan"]] == ["n2-b1-p1"] and m["conservados"] == 1


def test_un_paso_que_el_roadmap_nuevo_sube_de_nivel_no_sale_dos_veces() -> None:
    viejo = _detallar_n2(_con_pasos(_IAM, _CLI), "Escribir el plan", "Aprobar el plan")
    nuevo = _con_pasos(_IAM, _CLI, ("Escribir el plan", "Crea un usuario IAM con permisos de solo lectura."))
    m = rm.conservar(viejo, nuevo, ["n2-b1-p1"], {})
    ids = [p["id"] for p in rm.pasos(m)]
    assert ids.count("n2-b1-p1") == 1 and [p["id"] for p in m["niveles"][1]["bloques"][0]["pasos"]] == ["n2-b1-p2"]


async def test_rehacer_por_la_api_conserva_lo_hecho_avisa_y_se_puede_volver(cliente, monkeypatch) -> None:
    from magister.proyectos import trabajo

    mapas = [_con_pasos(_IAM, _CLI, _EC2)]

    async def roadmap_falso(datos, referencias, **_):
        return mapas[-1]

    async def sin_dibujo(datos, mapa):
        return None

    async def fase(*a):
        return None

    monkeypatch.setattr(rm, "generar_roadmap", roadmap_falso)
    monkeypatch.setattr(rm, "dibujar_arquitectura", sin_dibujo)
    monkeypatch.setattr(trabajo.cola, "fase", fase)

    pid = (await cliente.post("/api/proyectos", json={"nombre": "Copiloto", "idea": "Un agente que opera mi cuenta de AWS.", "investigar": False})).json()["id"]
    tid = (await cliente.get(f"/api/proyectos/{pid}")).json()["trabajo"]["id"]
    await trabajo.ejecutar(tid, "proyecto_roadmap", {"proyecto_id": pid, "investigar": False})
    assert (await cliente.get(f"/api/proyectos/{pid}")).json()["anterior"] is False
    for x in ("n1-b1-p1", "n1-b1-p3"):
        await cliente.put(f"/api/proyectos/{pid}/pasos/{x}", json={"hecho": True})
    await cliente.post(f"/api/proyectos/{pid}/decisiones", json={"titulo": "Solo lectura", "decision": "Nada de escribir.", "paso_id": "n1-b1-p1"})

    # Con pasos hechos, sin confirmar no se encola nada: dice lo que va a pasar.
    r = await cliente.post(f"/api/proyectos/{pid}/rehacer")
    assert r.status_code == 428 and "2 pasos hechos" in r.json()["detail"] and "cuota" in r.json()["detail"]
    assert "volver" in r.json()["detail"] and (await cliente.get(f"/api/proyectos/{pid}")).json()["estado"] == "listo"
    r = await cliente.post(f"/api/proyectos/{pid}/rehacer", json={"confirmado": True})
    assert r.status_code == 200 and r.json()["estado"] == "en_cola"
    mapas.append(_con_pasos(("Leer los costes del mes", "Consulta Cost Explorer y saca lo gastado este mes."), _CLI, _IAM))
    tid = (await cliente.get(f"/api/proyectos/{pid}")).json()["trabajo"]["id"]
    await trabajo.ejecutar(tid, "proyecto_roadmap", {"proyecto_id": pid, "investigar": False})
    # Un reintento del mismo trabajo no pisa el roadmap de antes con el que él mismo escribió.
    await trabajo.ejecutar(tid, "proyecto_roadmap", {"proyecto_id": pid, "investigar": False})
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["estado"] == "listo" and p["anterior"] is True
    assert _titulos(p["roadmap"])["n1-b1-p1"] == _IAM[0] and p["progreso"]["hechos"] == 1
    assert [x["titulo"] for x in p["roadmap"]["ya_no_estan"]] == [_EC2[0]] and p["roadmap"]["conservados"] == 1
    d = (await cliente.get(f"/api/proyectos/{pid}/decisiones")).json()[0]
    assert _titulos(p["roadmap"])[d["paso_id"]] == _IAM[0]  # el diario sigue apuntando al mismo paso

    # Volver al de antes: vuelve entero, con lo hecho, y el de ahora queda como anterior (se puede ir y volver).
    p = (await cliente.post(f"/api/proyectos/{pid}/volver")).json()
    assert list(_titulos(p["roadmap"]).values()) == [_IAM[0], _CLI[0], _EC2[0]]
    assert p["progreso"]["hechos"] == 2 and p["roadmap"]["ya_no_estan"] == [] and "conservados" not in p["roadmap"]
    p = (await cliente.post(f"/api/proyectos/{pid}/volver")).json()
    assert list(_titulos(p["roadmap"]).values())[0] == "Leer los costes del mes" and p["anterior"] is True
    sin = (await cliente.post("/api/proyectos", json={"nombre": "Otro", "idea": "Otro proyecto sin roadmap aún.", "investigar": False})).json()["id"]
    assert (await cliente.post(f"/api/proyectos/{sin}/volver")).status_code == 409


# --- Detallar solo los bloques vacíos ---------------------------------------------------------------------------------

_DESPLEGAR = rm.BloqueGen(titulo="Desplegar el agente", priming="Llevarlo a la nube cuando el plan ya se aprueba.")


def _rehecho_con_bloque_nuevo() -> tuple[dict, list[str]]:
    """Un nivel 2 que detallaste y rehiciste: el roadmap nuevo trae su bloque de antes y uno nuevo sin pareja."""
    viejo = _detallar_n2(_con_pasos(_IAM, _CLI), "Escribir el plan", "Aprobar el plan")
    r = _roadmap(2)
    r.niveles[0].bloques[0].pasos = [_paso(_IAM[0]), _paso(_CLI[0])]
    r.niveles[1].bloques.append(_DESPLEGAR)
    hechos = ["n2-b1-p1"]
    return rm.conservar(viejo, rm.montar(r), hechos, {"n2-b1-p1": "2026-11-03T10:00:00+00:00"}), hechos


def test_un_nivel_con_un_bloque_nuevo_sin_pasos_se_puede_detallar() -> None:
    m, _ = _rehecho_con_bloque_nuevo()
    n2 = m["niveles"][1]
    assert n2["detallado"] and [len(b["pasos"]) for b in n2["bloques"]] == [2, 0]
    assert rm.por_detallar(n2) and [b["titulo"] for b in rm.bloques_vacios(n2)] == ["Desplegar el agente"]
    assert not rm.por_detallar(m["niveles"][0])
    assert rm.por_detallar(rm.montar(_roadmap(2))["niveles"][1])  # esbozado del todo: como siempre


def test_rellenar_los_bloques_vacios_no_toca_los_que_tienen_pasos() -> None:
    m, _ = _rehecho_con_bloque_nuevo()
    plan, desplegar = m["niveles"][1]["bloques"]
    # El id que le tocaría al primer paso nuevo ya lo usa el diario: no se reparte.
    ocupado = f"{desplegar['id']}-p1"
    detalle = rm.NivelDetallado(bloques=[rm.BloqueGen(titulo="Desplegar el agente", priming="…", pasos=[_paso("Subir la imagen"), _paso("Lanzar el servicio")])])
    nuevo = rm.con_bloques_rellenos(m, 2, detalle, frozenset({ocupado}))
    n2 = nuevo["niveles"][1]
    assert n2["bloques"][0] == plan  # mismos ids, títulos y pasos
    assert n2["bloques"][1]["id"] == desplegar["id"] and n2["bloques"][1]["titulo"] == desplegar["titulo"]
    assert [p["id"] for p in n2["bloques"][1]["pasos"]] == [f"{desplegar['id']}-p2", f"{desplegar['id']}-p3"]
    assert [p["titulo"] for p in n2["bloques"][1]["pasos"]] == ["Subir la imagen", "Lanzar el servicio"]
    assert n2["detallado"] and not rm.por_detallar(n2)
    assert nuevo["niveles"][0] == m["niveles"][0] and nuevo["ya_no_estan"] == m["ya_no_estan"]
    assert len(set(p["id"] for p in rm.pasos(nuevo))) == len(rm.pasos(nuevo))


def test_el_prompt_pide_solo_los_bloques_vacios_y_ensena_los_pasos_que_ya_hay() -> None:
    datos = {"nombre": "Copiloto", "idea": "Un agente."}
    m, hechos = _rehecho_con_bloque_nuevo()
    sistema = rm.sistema_nivel(m, 2, hechos, [], datos)
    assert "Devuelve solo los bloques que aún no tienen pasos (1), en este orden y con el mismo título: «Desplegar el agente»." in sistema
    nivel = sistema.split("<nivel_a_detallar>")[1]
    assert '"pasos_que_ya_tiene": [\n    "Escribir el plan",\n    "Aprobar el plan"\n   ]' in nivel
    # Un nivel esbozado del todo se pide entero, como siempre.
    entero = rm.sistema_nivel(rm.montar(_roadmap(2)), 2, [], [], datos)
    assert rm._ENCARGO_TODO in entero and "pasos_que_ya_tiene" not in entero
    # Las reglas: un bloque por cada vacío y sin repetir los pasos que ya están.
    reglas = rm.reglas_relleno(m["niveles"][1], 2)
    bien = rm.NivelDetallado(bloques=[rm.BloqueGen(titulo="Desplegar el agente", priming="…", pasos=[_paso("Subir la imagen"), _paso("Lanzar el servicio")])])
    assert reglas(bien) == []
    de_mas = rm.NivelDetallado(bloques=[*bien.bloques, *bien.bloques])
    assert any("exactamente 1 bloques" in e for e in reglas(de_mas))
    repite = rm.NivelDetallado(bloques=[rm.BloqueGen(titulo="Desplegar el agente", priming="…", pasos=[_paso("Escribir el plan"), _paso("Lanzar el servicio")])])
    assert any("ya están en otro bloque" in e and "Escribir el plan" in e for e in reglas(repite))


async def test_detallar_nivel_rellena_solo_los_vacios_y_sin_vacios_no_llama_al_modelo(monkeypatch) -> None:
    m, hechos = _rehecho_con_bloque_nuevo()
    llamadas = []

    async def estructurar_falso(sistema, entrada, Modelo, reglas=None, **_):
        llamadas.append(entrada)
        d = Modelo(bloques=[rm.BloqueGen(titulo="Desplegar el agente", priming="…", pasos=[_paso("Subir la imagen"), _paso("Lanzar el servicio")])])
        assert reglas(d) == []
        return d

    monkeypatch.setattr(rm, "estructurar", estructurar_falso)
    datos = {"nombre": "Copiloto", "idea": "Un agente."}
    nuevo = await rm.detallar_nivel(m, 2, hechos, [], datos)
    assert llamadas == ["Devuelve solo los bloques sin pasos, con sus pasos."]
    assert nuevo["niveles"][1]["bloques"][0] == m["niveles"][1]["bloques"][0]
    assert len(nuevo["niveles"][1]["bloques"][1]["pasos"]) == 2
    # Un reintento del trabajo encuentra el nivel completo: no rehace nada ni llama al modelo.
    assert await rm.detallar_nivel(nuevo, 2, hechos, [], datos) == nuevo and len(llamadas) == 1


async def test_detallar_por_la_api_un_nivel_con_un_bloque_nuevo(cliente, monkeypatch) -> None:
    from magister.proyectos import trabajo

    r = _roadmap(2)
    r.niveles[1].bloques[0].pasos = [_paso("Escribir el plan"), _paso("Aprobar el plan")]
    r.niveles[1].bloques.append(_DESPLEGAR)
    mapa = rm.montar(r)
    assert mapa["niveles"][1]["detallado"]

    async def roadmap_falso(datos, referencias, **_):
        return mapa

    async def sin_dibujo(datos, mapa):
        return None

    async def fase(*a):
        return None

    async def estructurar_falso(sistema, entrada, Modelo, reglas=None, **_):
        return Modelo(bloques=[rm.BloqueGen(titulo="Desplegar el agente", priming="…", pasos=[_paso("Subir la imagen"), _paso("Lanzar el servicio")])])

    monkeypatch.setattr(rm, "generar_roadmap", roadmap_falso)
    monkeypatch.setattr(rm, "dibujar_arquitectura", sin_dibujo)
    monkeypatch.setattr(rm, "estructurar", estructurar_falso)
    monkeypatch.setattr(trabajo.cola, "fase", fase)

    pid = (await cliente.post("/api/proyectos", json={"nombre": "Copiloto", "idea": "Un agente que opera mi cuenta de AWS.", "investigar": False})).json()["id"]
    await trabajo.ejecutar(0, "proyecto_roadmap", {"proyecto_id": pid, "investigar": False})
    await cliente.put(f"/api/proyectos/{pid}/pasos/n2-b1-p1", json={"hecho": True})
    antes = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert antes["progreso"]["nivel"] == 1
    # El nivel 1, completo: 409 como siempre. El 2 tiene un bloque sin pasos: se puede detallar.
    assert (await cliente.post(f"/api/proyectos/{pid}/niveles/1/detallar")).status_code == 409
    assert (await cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar")).status_code == 200
    await trabajo.ejecutar(0, "proyecto_nivel", {"proyecto_id": pid, "numero": 2})
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    n2 = p["roadmap"]["niveles"][1]
    assert n2["bloques"][0] == antes["roadmap"]["niveles"][1]["bloques"][0]
    assert [x["id"] for x in n2["bloques"][1]["pasos"]] == ["n2-b2-p1", "n2-b2-p2"]
    assert p["hechos"] == ["n2-b1-p1"] and list(p["hechos_en"]) == ["n2-b1-p1"]
    r = await cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar")
    assert r.status_code == 409 and r.json()["detail"] == "ese nivel ya tiene sus pasos"


# --- Rehacer: el imperativo y el infinitivo son el mismo paso -------------------------------------------------------
# Los pares de un rehacer de verdad (la novela del ensayo): 6 pasos hechos y «conservados: 0».

_NOVELA_ANTES = [
    ("Lee las bases de un concurso real", "Busca las bases de uno o dos concursos de novela corta que te interesen y anota en un documento: extensión mínima y máxima, plazo, formato del archivo, si es anónimo y premio. Guarda el documento como bases.md o bases.docx."),
    ("Escribe la premisa en tres frases", "En un documento nuevo llamado premisa, escribe tres frases: quién es la jefa de estación y qué quiere, qué se lo impide (la línea se cierra) y qué decisión difícil tiene que tomar. Añade una cuarta frase con cómo termina la historia."),
    ("Crea el registro de progreso", "Crea una hoja de cálculo o una nota con tres columnas: fecha, palabras escritas y escena. Apunta ahí cada día lo que escribas, y fija un objetivo de 400 a 600 palabras por sesión."),
    ("Haz las fichas de la protagonista y del pueblo", "Escribe una ficha de media página para la jefa de estación (edad, pasado, miedo, lo que cree al empezar y lo que entenderá al final) y otra del pueblo, con cuatro o cinco personajes secundarios y una línea sobre cada uno."),
    ("Pruébala en voz alta y ajusta", 'Lee solo las frases de "qué cambia" de cada ficha, de seguido. Mueve, une o elimina escenas hasta que la sucesión tenga sentido y suba la tensión.'),
]
_NOVELA_DESPUES = [
    ("Leer las bases del concurso", "Elige uno o dos concursos de novela corta que te interesen, busca sus bases oficiales y anota en 00-ficha/concurso.txt el límite mínimo y máximo de palabras, el formato de envío, si es anónimo, la fecha límite y las condiciones de originalidad."),
    ("Escribir la premisa", "En 00-ficha/premisa.txt escribe la premisa en una o dos frases con esta forma: una jefa de estación (quién) que quiere X (deseo) pero Y se lo impide (obstáculo). Haz tres versiones y quédate con la mejor."),
    ("Crear el registro de palabras", "Crea una hoja de cálculo con las columnas fecha, palabras escritas ese día, palabras totales y una nota breve. Pon como meta 500 palabras por sesión de una hora y 2.500 por semana."),
    ("Ficha de la protagonista", "En 00-ficha/protagonista.txt escribe: nombre, edad, años en la estación, qué quiere, qué teme, qué se niega a ver de sí misma y una costumbre concreta que la defina."),
    ("Releer en voz alta y ajustar el plan", "Lee cap01 en voz alta sin cambiar el texto. Anota en 03-revision/notas.txt tres hallazgos (qué suena bien, qué suena raro, qué falta o sobra) y ajusta la escaleta si el capítulo te ha enseñado algo."),
]


def test_las_formas_verbales_y_los_articulos_no_cuentan() -> None:
    for a, b in [("Lee las bases", "Leer las bases"), ("Crea el bot", "Crear un bot"), ("Escribe la premisa", "Escribir la premisa"),
                 ("Define los personajes", "Definir el personaje"), ("Pruébala en voz alta", "Probar en voz alta"),
                 ("Hazlo en local", "Hacer en local"), ("Léele la versión corta", "Leer la versión corta")]:
        assert rm._raices(a) == rm._raices(b), (a, b)
    assert rm._raices("Volúmenes EBS") == rm._raices("volumen ebs")
    # Las palabras de verdad siguen distinguiéndose.
    assert rm._raices("Crear la carpeta") != rm._raices("Crear el registro")


def test_rehacer_conserva_los_pasos_que_siguen_aunque_cambie_el_verbo() -> None:
    viejo, nuevo = _con_pasos(*_NOVELA_ANTES), _con_pasos(*_NOVELA_DESPUES)
    pares = {k: v for k, v in rm.emparejar(viejo, nuevo).items() if "-p" in k}
    # Las bases, la premisa y el registro son los mismos pasos (imperativo contra infinitivo, con otro texto).
    assert pares == {"n1-b1-p1": "n1-b1-p1", "n1-b1-p2": "n1-b1-p2", "n1-b1-p3": "n1-b1-p3"}
    # Negativos: «Haz las fichas de la protagonista y del pueblo» no es solo «Ficha de la protagonista», ni probar la
    # escaleta en voz alta es releer el capítulo: comparten título a medias y casi nada de lo que se hace.
    assert "n1-b1-p4" not in pares and "n1-b1-p5" not in pares
    m = rm.conservar(viejo, nuevo, ["n1-b1-p1", "n1-b1-p3", "n1-b1-p4"], {})
    assert m["conservados"] == 2 and m["no_conservados"] == ["n1-b1-p4"]
    assert [x["titulo"] for x in m["ya_no_estan"]] == ["Haz las fichas de la protagonista y del pueblo"]


def test_dos_pasos_con_numeros_distintos_no_son_el_mismo() -> None:
    texto = "Escribe una o dos líneas por capítulo: qué pasa, quién aparece y qué cambia al terminar."
    viejo = _con_pasos(("Capítulos 1 a 6 de la escaleta", texto), _IAM)
    nuevo = _con_pasos(("Capítulos 7 a 12 de la escaleta", texto), _CLI)
    assert "n1-b1-p1" not in rm.emparejar(viejo, nuevo)
    # Ni dos «Crear …» de cosas distintas.
    viejo = _con_pasos(("Crear la carpeta de la novela", "Crea una carpeta con subcarpetas para la ficha y el borrador."), _IAM)
    nuevo = _con_pasos(("Crear el registro de palabras", "Crea una hoja de cálculo con la fecha y las palabras del día."), _CLI)
    assert "n1-b1-p1" not in rm.emparejar(viejo, nuevo)


def test_al_rehacer_el_modelo_ve_el_roadmap_de_antes_y_que_conserve_los_titulos() -> None:
    datos = {"nombre": "La última estación", "idea": "Una novela corta."}
    viejo = _con_pasos(*_NOVELA_ANTES)
    sistema = rm.sistema_roadmap(datos, [], viejo, ["n1-b1-p1"])
    anterior = sistema.split("<roadmap_anterior>")[1].split("</roadmap_anterior>")[0]
    assert "- [hecho] Lee las bases de un concurso real" in anterior and "- Escribe la premisa en tres frases" in anterior
    assert "conserva su título exacto" in sistema
    # La primera vez no hay roadmap de antes.
    assert "es la primera vez" in rm.sistema_roadmap(datos, [])
    # Sin marca de género ni comillas rectas; y lo del código, en ASCII.
    for nombre in ("proyecto_roadmap", "proyecto_nivel"):
        from magister.cerebro.prompts import cargar

        texto = cargar(nombre).texto
        assert "sin marcar su género" in texto and "«si te atascas»" in texto and "ASCII" in texto and "/añadir" in texto


async def test_rehacer_por_la_api_le_pasa_el_roadmap_de_antes(cliente, monkeypatch) -> None:
    from magister.proyectos import trabajo

    vistos = []

    async def roadmap_falso(datos, referencias, anterior=None, hechos=None):
        vistos.append((anterior, hechos))
        return _con_pasos(*_NOVELA_DESPUES)

    async def nada(*a, **k):
        return None

    monkeypatch.setattr(rm, "generar_roadmap", roadmap_falso)
    monkeypatch.setattr(rm, "dibujar_arquitectura", nada)
    monkeypatch.setattr(trabajo.cola, "fase", nada)
    pid = await _con_roadmap(_con_pasos(*_NOVELA_ANTES), hechos=["n1-b1-p1", "n1-b1-p4"])
    assert (await cliente.post(f"/api/proyectos/{pid}/rehacer", json={"confirmado": True})).status_code == 200
    tid = (await cliente.get(f"/api/proyectos/{pid}")).json()["trabajo"]["id"]
    await trabajo.ejecutar(tid, "proyecto_roadmap", {"proyecto_id": pid, "investigar": False})
    assert [x["titulo"] for x in rm.pasos(vistos[0][0])][0] == "Lee las bases de un concurso real"
    assert vistos[0][1] == ["n1-b1-p1", "n1-b1-p4"]
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["roadmap"]["conservados"] == 1 and p["roadmap"]["no_conservados"] == ["n1-b1-p4"] and p["anterior"]


# --- El proyecto en cola se sigue usando ----------------------------------------------------------------------------

async def _con_roadmap(mapa: dict | None = None, **extra) -> int:
    from magister.datos.proyectos import Proyecto
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s, s.begin():
        p = Proyecto(nombre="Copiloto", idea="Un agente que opera mi cuenta de AWS.", estado="listo",
                     roadmap=mapa or rm.montar(_roadmap(3)), **extra)
        s.add(p)
        await s.flush()
        return p.id


async def _trabajos(pid: int, tipo: str | None = None) -> list[tuple[int, str]]:
    from sqlalchemy import select

    from magister.datos.material import Trabajo
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        consulta = select(Trabajo.id, Trabajo.estado).where(Trabajo.parametros["proyecto_id"].astext == str(pid))
        if tipo:
            consulta = consulta.where(Trabajo.tipo == tipo)
        return [tuple(x) for x in (await s.execute(consulta.order_by(Trabajo.id))).all()]


async def test_en_cola_se_lee_se_marca_y_se_cancela_y_no_choca_con_otro_trabajo(cliente) -> None:
    from magister.trabajos import cola

    pid = await _con_roadmap()
    r = await cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar")
    assert r.status_code == 200 and r.json()["estado"] == "en_cola"
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["estado"] == "en_cola" and p["trabajo"]["nivel"] == 2 and p["trabajo"]["tipo"] == "proyecto_nivel"
    assert {x["id"]: x["estado"] for x in (await cliente.get("/api/proyectos")).json()}[pid] == "en_cola"
    # Lo que no choca con detallar el nivel 2: marcar pasos y el diario.
    assert (await cliente.put(f"/api/proyectos/{pid}/pasos/n1-b1-p1", json={"hecho": True})).json()["progreso"]["hechos"] == 1
    assert (await cliente.post(f"/api/proyectos/{pid}/decisiones", json={"titulo": "Usar boto3", "decision": "El SDK oficial."})).status_code == 201
    # Lo que sí choca (otro trabajo, volver al anterior): 409 que dice que se cancele.
    for r in [await cliente.post(f"/api/proyectos/{pid}/rehacer", json={"confirmado": True}),
              await cliente.post(f"/api/proyectos/{pid}/volver")]:
        assert r.status_code == 409 and "en la cola" in r.json()["detail"] and "cancélalo" in r.json()["detail"]
    # Cancelarlo deja el proyecto libre, sin error a la vista («cancelado» la pantalla no lo enseña).
    assert await cola.cancelar(p["trabajo"]["id"])
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["estado"] == "listo" and p["error"] == "cancelado" and p["trabajo"] is None
    assert (await cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar")).status_code == 200


async def test_un_doble_clic_encola_un_solo_trabajo_y_la_clave_no_depende_del_reloj(cliente) -> None:
    import asyncio

    pid = await _con_roadmap()
    a, b = await asyncio.gather(cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar"),
                                cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar"))
    assert a.status_code == b.status_code == 200
    assert len(await _trabajos(pid, "proyecto_nivel")) == 1
    # Rehacer dos veces seguidas (confirmar con doble clic): uno.
    pid = await _con_roadmap()
    a, b = await asyncio.gather(cliente.post(f"/api/proyectos/{pid}/rehacer", json={"confirmado": True}),
                                cliente.post(f"/api/proyectos/{pid}/rehacer", json={"confirmado": True}))
    assert a.status_code == b.status_code == 200 and len(await _trabajos(pid, "proyecto_roadmap")) == 1


async def test_marcar_varios_pasos_a_la_vez_no_pierde_ninguno(cliente) -> None:
    import asyncio

    pid = await _con_roadmap(rm.montar(_roadmap(6)))
    ids = [f"n1-b1-p{i}" for i in range(1, 7)]
    respuestas = await asyncio.gather(*(cliente.put(f"/api/proyectos/{pid}/pasos/{x}", json={"hecho": True}) for x in ids))
    assert all(r.status_code == 200 for r in respuestas)
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert sorted(p["hechos"]) == sorted(ids) and sorted(p["hechos_en"]) == sorted(ids)


async def test_borrar_cancela_su_trabajo_y_lo_que_no_existe_es_404(cliente) -> None:
    pid = await _con_roadmap()
    await cliente.post(f"/api/proyectos/{pid}/niveles/2/detallar")
    assert (await cliente.delete(f"/api/proyectos/{pid}")).status_code == 204
    assert [e for _, e in await _trabajos(pid)] == ["cancelado"]
    assert (await cliente.delete(f"/api/proyectos/{pid}")).status_code == 404
    assert (await cliente.delete("/api/proyectos/999999")).status_code == 404


async def test_el_detalle_no_pisa_lo_que_cambio_mientras_tanto(cliente) -> None:
    from magister.datos.proyectos import Proyecto
    from magister.datos.sesion import nueva_sesion
    from magister.proyectos import trabajo

    base = rm.montar(_roadmap(2))
    nuevo = _detallar_n2(base, "Escribir el plan", "Aprobar el plan")
    pid = await _con_roadmap(base)
    # Mientras el modelo escribía, el asesor cambió un paso del nivel 1: se queda, y el nivel 2 sale detallado.
    cambiado = {**base, "niveles": [{**base["niveles"][0], "titulo": "Solo leer"}, base["niveles"][1]]}
    async with nueva_sesion() as s, s.begin():
        (await s.get(Proyecto, pid)).roadmap = cambiado
    await trabajo._guardar_detalle(pid, base, nuevo, 2)
    async with nueva_sesion() as s:
        r = (await s.get(Proyecto, pid)).roadmap
    assert r["niveles"][0]["titulo"] == "Solo leer" and r["niveles"][1] == nuevo["niveles"][1]
    # Si lo que cambió es el propio nivel 2, no se adivina: falla y se vuelve a pedir.
    otro = {**base, "niveles": [base["niveles"][0], {**base["niveles"][1], "objetivo": "Otra cosa."}]}
    async with nueva_sesion() as s, s.begin():
        (await s.get(Proyecto, pid)).roadmap = otro
    with pytest.raises(LookupError, match="ha cambiado mientras se detallaba"):
        await trabajo._guardar_detalle(pid, base, nuevo, 2)


# --- Entradas: espacios, pasos que no existen y 422 en castellano ---------------------------------------------------

async def test_un_nombre_de_solo_espacios_es_un_422_en_castellano(cliente) -> None:
    r = await cliente.post("/api/proyectos", json={"nombre": "     ", "idea": "Una idea con más de diez letras.", "investigar": False})
    assert r.status_code == 422 and r.json()["detail"] == "el nombre necesita al menos 2 caracteres, sin contar los espacios"
    r = await cliente.post("/api/proyectos", json={"nombre": "Bot", "idea": "            ", "objetivo": "   "})
    assert r.status_code == 422 and r.json()["detail"] == "la idea necesita al menos 10 caracteres, sin contar los espacios"
    r = await cliente.post("/api/proyectos", json={"idea": "Una idea con más de diez letras."})
    assert r.status_code == 422 and r.json()["detail"] == "falta el nombre"
    assert (await cliente.get("/api/proyectos/abc")).json()["detail"] == "el número del proyecto tiene que ser un número entero"
    # Lo opcional de solo espacios se guarda vacío, no como «   ».
    r = await cliente.post("/api/proyectos", json={"nombre": "  Bot  ", "idea": "Una idea con más de diez letras.", "ritmo": "  ", "investigar": False})
    assert r.status_code == 201 and r.json()["nombre"] == "Bot"
    assert (await cliente.get(f"/api/proyectos/{r.json()['id']}")).json()["ritmo"] is None


async def test_una_decision_de_espacios_o_de_un_paso_que_no_existe_es_un_422(cliente) -> None:
    pid = await _con_roadmap()
    r = await cliente.post(f"/api/proyectos/{pid}/decisiones", json={"titulo": "    ", "decision": "Algo que decidí."})
    assert r.status_code == 422 and "el título" in r.json()["detail"]
    r = await cliente.post(f"/api/proyectos/{pid}/decisiones", json={"titulo": "Usar boto3", "decision": "El SDK.", "paso_id": "zz-no-existe"})
    assert r.status_code == 422 and "ese paso no está en el proyecto" in r.json()["detail"]
    r = await cliente.post(f"/api/proyectos/{pid}/decisiones", json={"titulo": "Usar boto3", "decision": "El SDK.", "paso_id": "n1-b1-p1", "contexto": "  "})
    assert r.status_code == 201 and r.json()["paso_id"] == "n1-b1-p1" and r.json()["contexto"] is None


# --- Lo que va en el código, en ASCII --------------------------------------------------------------------------------

def test_un_comando_con_ene_deja_un_aviso_en_el_paso() -> None:
    malo = rm.PasoGen(titulo="Crear el comando de alta", que_haces="Registra el comando /añadir con CommandHandler y guarda el tema.",
                      antes="Un CommandHandler responde a un comando que empieza por barra.", hecho_si="Escribir /añadir en el chat responde «Hecho»", minutos=30)
    aviso = rm.aviso_ascii(malo)
    assert aviso and "«/añadir» por «/anadir»" in aviso
    assert rm.aviso_ascii(rm.PasoGen(**{**malo.model_dump(), "que_haces": "Guarda `funcion_rápida` en capítulo_1.py con una función.",
                                        "hecho_si": "python -c 'print(1)' devuelve 1 sin errores"}))
    # Un texto para el usuario con tildes, una URL o una ruta en ASCII no avisan.
    bien = rm.PasoGen(**{**malo.model_dump(), "que_haces": "Registra /anadir y responde «Añadido» al usuario; mira https://core.telegram.org/bots.",
                         "hecho_si": "Escribir /anadir en el chat responde «Añadido»"})
    assert rm.aviso_ascii(bien) is None
    r = _roadmap(2)
    r.niveles[0].bloques[0].pasos[0] = malo
    m = rm.montar(r)
    assert "aviso" in m["niveles"][0]["bloques"][0]["pasos"][0] and "aviso" not in m["niveles"][0]["bloques"][0]["pasos"][1]


def test_sin_software_la_pantalla_lo_sabe() -> None:
    r = _roadmap(2)
    assert rm.montar(r)["software"] is True
    r.software = False
    assert rm.montar(r)["software"] is False
