"""Lo que encontraron los probadores en el plan y el chat (noviembre de 2026): sustituir un plan sin perder lo hecho,
repartir sin volver a usar lo ya pasado, validar lo que llega de la web y los 404."""

import asyncio
from datetime import date, time

import pytest
from sse import eventos_sse

pytestmark = pytest.mark.anyio

LUNES = date(2026, 11, 9)
PETICION = (
    "Quiero preparar bases de datos para una entrevista de backend dentro de un mes. "
    "Sé SQL básico de la universidad. Tengo hora y media al día, entre semana, a partir de las seis de la tarde."
)


@pytest.fixture
def hoy_fijo(monkeypatch):
    from magister.api import rutas_conversaciones, rutas_plan

    monkeypatch.setattr(rutas_conversaciones, "hoy", lambda: LUNES)
    monkeypatch.setattr(rutas_plan, "hoy", lambda: LUNES)


def leccion(clave: str, titulo: str, horas: float = 1.0, deps: list[str] | None = None, objetivos=None) -> dict:
    return {"clave": clave, "titulo": titulo, "objetivos": objetivos or [f"Explicar {titulo.lower()}"],
            "conceptos": [{"id": f"c-{clave.lower()}", "nombre": titulo}], "horas": horas, "depende_de": deps or []}


def plan_con(*lecciones: dict) -> dict:
    return {"razonamiento": "x", "lecciones": list(lecciones)}


PERFIL = {"horas_por_dia": [1.5] * 5 + [0, 0], "inicio_por_dia": ["18:00"] * 5 + [None, None]}


# --- 1. Un plan nuevo del mismo tema sustituye al aceptado: avisa y conserva lo que sigue --------------------------


def test_emparejar_lecciones_por_titulo_normalizado() -> None:
    from magister.plan.sustituir import emparejar_lecciones

    viejas = [("L1", "Qué es SQL"), ("L2", "Tu primer SELECT"), ("L3", "Repaso"), ("L4", "Repaso")]
    nuevas = [("L1", "Instalar Postgres"), ("L2", "Que es SQL."), ("L3", "tu primer select"), ("L4", "Repaso"),
              ("L5", "Joins")]
    # Las claves se corren y siguen siendo las mismas lecciones; «Repaso», repetido en el viejo, no se arrastra.
    assert emparejar_lecciones(viejas, nuevas) == {"L1": "L2", "L2": "L3"}


async def _poner_fuentes(plan_id: int, clave: str) -> None:
    from sqlalchemy import text

    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        tarea = await s.scalar(text(
            "insert into tareas_research (plan_id, leccion_clave, sistema, estado, motivo_fin) "
            "values (:p, :c, 'fijo', 'acabada', '2 propuestas') returning id"), {"p": plan_id, "c": clave})
        for url in ("https://a.example/select", "https://b.example/select"):
            await s.execute(text(
                "insert into propuestas (tarea_id, url, titulo, plan_id, leccion_clave, motivo, estado, ficha) "
                "values (:t, :u, 'Fuente', :p, :c, 'buena', 'pendiente', cast(:f as jsonb))"),
                {"t": tarea, "u": url, "p": plan_id, "c": clave, "f": '{"objetivos": [1], "tipo": "tutorial"}'})
        await s.execute(text("insert into lecciones_apoyo (plan_id, leccion_clave, n_fragmentos, sin_material) "
                             "values (:p, :c, 3, false)"), {"p": plan_id, "c": clave})
        await s.commit()


async def test_sustituir_un_plan_conserva_fuentes_y_progreso_de_lo_que_sigue(base) -> None:
    from sqlalchemy import text

    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion
    from magister.flujo import planes
    from magister.plan.sustituir import emparejar_lecciones

    viejo = plan_con(leccion("L1", "Qué es SQL"), leccion("L2", "Tu primer SELECT", deps=["L1"]))
    sesiones = [{"clave": "L1", "fecha": "2026-11-09", "inicio": "18:00", "horas": 1.0},
                {"clave": "L2", "fecha": "2026-11-10", "inicio": "18:00", "horas": 1.0}]
    tema_id, plan_viejo = await dp.guardar_plan("Bases de datos", None, PERFIL, viejo, sesiones, None, None)
    await _poner_fuentes(plan_viejo, "L2")
    async with nueva_sesion() as s:
        for x in await dp.sesiones(s, plan_viejo):
            await dp.marcar_sesion(s, x.id, "hecha")

    # Otro plan del mismo tema: entra una lección delante y «Tu primer SELECT» pasa a ser L3, con otros objetivos.
    nuevo = plan_con(leccion("L1", "Instalar Postgres"), leccion("L2", "Qué es SQL", deps=["L1"]),
                     leccion("L3", "Tu primer select", horas=2.0, deps=["L2"], objetivos=["Escribir un SELECT", "Filtrar"]))
    async with nueva_sesion() as s:
        aviso = await planes.sustitucion(s, "bases de datos", nuevo["lecciones"])
    assert aviso is not None
    assert {k: aviso[k] for k in ("plan_id", "version", "horas_hechas", "lecciones", "tema_id")} == {
        "plan_id": plan_viejo, "version": 1, "horas_hechas": 2.0, "lecciones": 2, "tema_id": tema_id}
    assert aviso["conserva"] == {"lecciones": ["L2", "L3"], "horas_hechas": 2.0, "fuentes": 2}

    nuevas_sesiones = [{"clave": c, "fecha": f"2026-11-{16 + i}", "inicio": "18:00", "horas": h}
                       for i, (c, h) in enumerate([("L1", 1.0), ("L2", 1.0), ("L3", 1.5), ("L3", 0.5)])]
    tema2, plan_nuevo = await dp.guardar_plan("Bases de datos", None, PERFIL, nuevo, nuevas_sesiones, None, None,
                                              emparejar=emparejar_lecciones)
    assert tema2 == tema_id
    await planes.recolocar_con_progreso(plan_nuevo, tema_id, LUNES)
    async with nueva_sesion() as s:
        vista = await planes.vista_por_id(s, plan_nuevo, LUNES)
        estado_viejo = await s.scalar(text("select estado from planes where id = :p"), {"p": plan_viejo})
        ficha = await s.scalar(text("select ficha from propuestas where plan_id = :p limit 1"), {"p": plan_nuevo})
        tareas = await s.scalar(text("select count(*) from tareas_research where plan_id = :p"), {"p": plan_nuevo})
    assert estado_viejo == "sustituido" and vista["version"] == 2
    por_clave = {x["clave"]: x for x in vista["lecciones"]}
    assert por_clave["L1"]["horas_hechas"] == 0 and por_clave["L1"]["fuentes"] == 0
    assert por_clave["L2"]["horas_hechas"] == 1.0 and por_clave["L2"]["estado"] == "hecha"
    assert por_clave["L3"]["horas_hechas"] == 1.0 and por_clave["L3"]["fuentes"] == 3
    assert len(por_clave["L3"]["biblioteca"]["fuentes"]) == 2
    # Con otros objetivos, la ficha ya no dice qué objetivo cubre ni pasa la búsqueda vieja.
    assert "objetivos" not in ficha and ficha["tipo"] == "tutorial" and tareas == 0
    # Lo pendiente se ha vuelto a repartir sin lo hecho: L2 no se repite y a L3 le queda 1 h.
    pendientes = [x for sem in vista["semanas"] for d in sem["dias"] for x in d["sesiones"] if x["estado"] == "pendiente"]
    assert sum(x["horas"] for x in pendientes if x["clave"] == "L3") == 1.0
    assert not [x for x in pendientes if x["clave"] == "L2"]


async def test_sustituir_con_los_mismos_objetivos_trae_la_busqueda(base) -> None:
    from sqlalchemy import text

    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion
    from magister.plan.sustituir import emparejar_lecciones

    viejo = plan_con(leccion("L1", "Tu primer SELECT"))
    _, plan_viejo = await dp.guardar_plan("Bases de datos", None, PERFIL, viejo, [], None, None)
    await _poner_fuentes(plan_viejo, "L1")
    _, plan_nuevo = await dp.guardar_plan("Bases de datos", None, PERFIL, plan_con(leccion("L1", "Tu primer SELECT")), [],
                                          None, None, emparejar=emparejar_lecciones)
    async with nueva_sesion() as s:
        tareas = await dp.ultimas_tareas_research(s, plan_nuevo)
        ficha = await s.scalar(text("select ficha from propuestas where plan_id = :p limit 1"), {"p": plan_nuevo})
    assert tareas["L1"]["estado"] == "acabada" and ficha["objetivos"] == [1]


async def test_la_propuesta_avisa_de_que_sustituye_al_plan_aceptado(cliente, hoy_fijo) -> None:
    async def proponer() -> tuple[int, dict]:
        cid = (await cliente.post("/api/conversaciones", json={"titulo": "Plan BD", "tipo": "plan"})).json()["id"]
        r = await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": PETICION})
        return cid, next(d for e, d in eventos_sse(r.text) if e == "plan")

    cid, primera = await proponer()
    assert primera["sustituye"] is None
    await cliente.post(f"/api/conversaciones/{cid}/plan/decision", json={"accion": "aceptar"})
    plan_id = (await cliente.get("/api/planes")).json()[0]["plan_id"]

    cid2, segunda = await proponer()
    assert segunda["sustituye"]["plan_id"] == plan_id and segunda["sustituye"]["version"] == 1
    assert segunda["sustituye"]["conserva"]["lecciones"]  # mismas lecciones: siguen todas
    recuperada = (await cliente.get(f"/api/conversaciones/{cid2}/propuesta")).json()
    assert recuperada["sustituye"]["plan_id"] == plan_id


async def test_el_plan_va_al_tema_de_la_conversacion(base) -> None:
    """La conversación ya tiene tema («Biología celular: mitosis y meiosis»): el plan va ahí aunque el modelo llame al
    tema de otra forma; antes se creaba «Biología celular» y la conversación se mudaba, dejando el tuyo vacío."""
    from sqlalchemy import text

    from magister.datos import conversaciones as dc
    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        tema = await dc.crear_tema(s, "Biología celular: mitosis y meiosis")
        conv = await dc.crear_conversacion(s, "Plan", tema.id, "plan")
        tema_id, conv_id = tema.id, conv.id
    t, _ = await dp.guardar_plan("Biología celular", conv_id, PERFIL, plan_con(leccion("L1", "Mitosis")), [], None, None)
    async with nueva_sesion() as s:
        temas = (await s.execute(text("select nombre from temas"))).scalars().all()
        de_conv = await s.scalar(text("select tema_id from conversaciones where id = :c"), {"c": conv_id})
    assert t == tema_id and de_conv == tema_id and temas == ["Biología celular: mitosis y meiosis"]


# --- 2 y 4. No se reparte en la franja de hoy que ya pasó ni encima de lo ya estudiado ----------------------------


def _plan(*lecs):
    from magister.plan.esquemas import Plan

    return Plan.model_validate(plan_con(*lecs))


def test_un_plan_aceptado_tarde_no_empieza_en_una_hora_pasada() -> None:
    from magister.plan.calendario import ReglasCalendario, calendarizar

    plan = _plan(leccion("L1", "Uno", 1.0), leccion("L2", "Dos", 1.0))
    inicios = [time(18, 0)] * 5 + [None, None]
    # Aceptado a las 20:50 con hora y media desde las 18:00: hoy ya no queda nada.
    c = calendarizar(plan, [1.5] * 5 + [0, 0], inicios, LUNES, None, {}, ReglasCalendario(), ahora=time(20, 50))
    assert c.sesiones[0].fecha == date(2026, 11, 10) and c.sesiones[0].inicio == time(18, 0)
    # A las 18:30 con dos horas: lo que queda de hoy, desde las 18:30.
    c = calendarizar(plan, [2.0] * 5 + [0, 0], inicios, LUNES, None, {}, ReglasCalendario(), ahora=time(18, 30))
    assert (c.sesiones[0].fecha, c.sesiones[0].inicio, c.sesiones[0].horas) == (LUNES, time(18, 30), 1.0)
    assert c.sesiones[1].fecha == LUNES and c.sesiones[1].horas == 0.5
    # Antes de empezar, como siempre.
    c = calendarizar(plan, [1.5] * 5 + [0, 0], inicios, LUNES, None, {}, ReglasCalendario(), ahora=time(9, 0))
    assert c.sesiones[0].fecha == LUNES and c.sesiones[0].inicio == time(18, 0)


def test_aceptar_a_las_20_50_recoloca_la_primera_sesion() -> None:
    from magister.flujo.nodos.proponer import _al_dia

    estado = {"hoy": LUNES.isoformat(), "ahora": "20:50", "perfil": PERFIL,
              "plan": plan_con(leccion("L1", "Uno"), leccion("L2", "Dos")),
              "sesiones": [{"clave": "L1", "fecha": "2026-11-09", "inicio": "18:00", "horas": 1.0},
                           {"clave": "L2", "fecha": "2026-11-10", "inicio": "18:00", "horas": 1.0}]}
    cmd = _al_dia(estado)
    assert cmd.goto == "guardar" and min(x["fecha"] for x in cmd.update["sesiones"]) == "2026-11-10"
    # Sin hora (las pruebas, o quien no la pasa) no se toca.
    assert _al_dia({**estado, "ahora": None}).update is None


def test_reajustar_no_vuelve_a_poner_lo_estudiado_hoy() -> None:
    from magister.aprender.reajuste import reajustar
    from magister.plan.calendario import ReglasCalendario

    plan = _plan(leccion("L1", "Uno", 2.0))
    inicios = [time(18, 0)] * 7
    cal, _ = reajustar(plan, [2.0] * 7, inicios, LUNES, None, {"L1": 1.0}, {}, set(), ReglasCalendario(),
                       usado_inicial=60)
    # Hecha 18:00-19:00: lo que queda va a las 19:00, no otra vez a las 18:00.
    assert [(x.fecha, x.inicio, x.horas) for x in cal.sesiones] == [(LUNES, time(19, 0), 1.0)]


async def test_el_reajuste_descuenta_lo_hecho_hoy(base, monkeypatch) -> None:
    """«Reajustar con mis repasos» a las 18:55, con 18:00-19:00 ya hecho: lo que queda va a las 19:00, no a las 18:00."""
    from datetime import datetime, timezone

    from magister.config import ajustes
    from magister.datos import plan as dp
    from magister.datos.sesion import nueva_sesion
    from magister.flujo import planes

    monkeypatch.setattr(ajustes, "zona", "UTC")
    perfil = {"horas_por_dia": [2.0] * 7, "inicio_por_dia": ["18:00"] * 7}
    sesiones = [{"clave": "L1", "fecha": "2026-11-09", "inicio": "18:00", "horas": 1.0},
                {"clave": "L1", "fecha": "2026-11-09", "inicio": "19:00", "horas": 1.0}]
    tema_id, plan_id = await dp.guardar_plan("Topografía", None, perfil, plan_con(leccion("L1", "Uno", 2.0)),
                                             sesiones, None, None)
    async with nueva_sesion() as s:
        await dp.marcar_sesion(s, (await dp.sesiones(s, plan_id))[0].id, "hecha")
        r = await planes.proponer_reajuste(s, tema_id, datetime(2026, 11, 9, 18, 55, tzinfo=timezone.utc))
    assert [(x["fecha"], x["inicio"]) for x in r["sesiones"]] == [("2026-11-09", "19:00")]


# --- 3. Lo que llega de la web al aceptar un reajuste o recalcular se valida ----------------------------------------


async def test_aceptar_reajuste_valida_las_sesiones(cliente, hoy_fijo) -> None:
    from magister.datos import plan as dp

    sesiones = [{"clave": "L1", "fecha": "2026-11-10", "inicio": "18:00", "horas": 1.0}]
    tema_id, _ = await dp.guardar_plan("Topografía", None, PERFIL, plan_con(leccion("L1", "Uno")), sesiones, None, None)
    url = f"/api/temas/{tema_id}/plan/reajuste/aceptar"
    buena = {"clave": "L1", "fecha": "2026-11-11", "inicio": "18:00", "horas": 1.0}
    casos = {
        "ninguna sesión": [],
        "no están en el plan: L9": [{**buena, "clave": "L9"}],
        "más de 0 h": [{**buena, "horas": -2}],
        "como mucho 12 h": [{**buena, "horas": 40}],
        "anterior a hoy": [{**buena, "fecha": "2020-01-01"}],
    }
    for texto, cuerpo in casos.items():
        r = await cliente.post(url, json={"sesiones": cuerpo})
        assert r.status_code == 422 and texto in r.json()["detail"], (texto, r.text)
    assert (await cliente.post(url, json={"sesiones": [{**buena, "titulo": "x"}]})).status_code == 422
    # Nada de lo anterior ha borrado la pendiente.
    vista = (await cliente.get(f"/api/temas/{tema_id}/plan")).json()
    assert [d["fecha"] for s in vista["semanas"] for d in s["dias"] for x in d["sesiones"]] == ["2026-11-10"]
    r = await cliente.post(url, json={"sesiones": [buena]})
    assert r.status_code == 200
    assert [d["fecha"] for s in r.json()["semanas"] for d in s["dias"] for x in d["sesiones"]] == ["2026-11-11"]


async def test_recalcular_desde_una_fecha_absurda_da_422(cliente, hoy_fijo) -> None:
    from magister.datos import plan as dp

    tema_id, _ = await dp.guardar_plan("Topografía", None, PERFIL, plan_con(leccion("L1", "Uno")), [], None, None)
    for desde in ("1999-01-01", "2999-01-01", "2026-11-08"):
        r = await cliente.post(f"/api/temas/{tema_id}/plan/recalcular", json={"desde": desde})
        assert r.status_code == 422 and "No se puede recalcular" in r.json()["detail"]
    assert (await cliente.post(f"/api/temas/{tema_id}/plan/recalcular", json={"desde": "2026-11-09"})).status_code == 200


def test_errores_de_sesiones_y_fechas() -> None:
    from magister.plan.calendario import Sesion, error_en_desde, error_en_sesiones

    s = lambda f, h=1.0: Sesion(f, None, "L1", h)  # noqa: E731
    assert error_en_sesiones([s(LUNES)], {"L1"}, LUNES) is None
    assert "suma 25 h" in error_en_sesiones([s(LUNES, 12), s(LUNES, 12), s(LUNES, 1)], {"L1"}, LUNES)
    assert "demasiado lejos" in error_en_sesiones([s(date(2999, 1, 1))], {"L1"}, LUNES)
    assert error_en_desde(LUNES, LUNES) is None and "anterior a hoy" in error_en_desde(date(1999, 1, 1), LUNES)


# --- 5 y 6. 404 donde toca y títulos de solo espacios ------------------------------------------------------------


async def test_rutas_de_planes_y_conversaciones_que_no_existen_dan_404(cliente) -> None:
    from magister.datos import plan as dp

    _, plan_id = await dp.guardar_plan("Topografía", None, PERFIL, plan_con(leccion("L1", "Uno")), [], None, None)
    assert (await cliente.patch("/api/planes/999999/lecciones/L1/hecha")).status_code == 404
    assert (await cliente.patch(f"/api/planes/{plan_id}/lecciones/L9/hecha")).status_code == 404
    assert (await cliente.patch(f"/api/planes/{plan_id}/lecciones/L1/hecha")).status_code == 200
    assert (await cliente.get("/api/planes/999999/materiales")).status_code == 404
    assert (await cliente.get(f"/api/planes/{plan_id}/materiales")).json() == {}
    assert (await cliente.get("/api/conversaciones/999999/propuesta")).status_code == 404
    # Una conversación que existe y no tiene propuesta sigue dando null (lo espera la web).
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Charla"})).json()["id"]
    r = await cliente.get(f"/api/conversaciones/{cid}/propuesta")
    assert r.status_code == 200 and r.json() is None


async def test_un_titulo_de_solo_espacios_no_vale(cliente) -> None:
    r = await cliente.post("/api/conversaciones", json={"titulo": "   "})
    assert r.status_code == 422 and "vacío" in r.text
    assert (await cliente.post("/api/temas", json={"nombre": "  \t "})).status_code == 422
    r = await cliente.post("/api/conversaciones", json={"titulo": "  Charla  "})
    assert r.status_code == 201 and r.json()["titulo"] == "Charla"


# --- 7. El nombre del tema ya no se recorta tras los dos puntos ---------------------------------------------------


async def test_temas_con_el_mismo_prefijo_no_se_juntan(base) -> None:
    from magister.datos import plan as dp

    assert dp.nombre_corto("Inglés B2: condicionales y phrasal verbs") == "Inglés B2: condicionales y phrasal verbs"
    largo = "Biología celular: mitosis, meiosis, ciclo celular, apoptosis y regulación del ciclo en eucariotas"
    assert dp.nombre_corto(largo) == "Biología celular"
    t1, _ = await dp.guardar_plan("Inglés B2: condicionales y phrasal verbs", None, PERFIL, plan_con(leccion("L1", "If")),
                                  [], None, None)
    t2, _ = await dp.guardar_plan("Inglés B2: vocabulario de trabajo", None, PERFIL, plan_con(leccion("L1", "Job")),
                                  [], None, None)
    t3, _ = await dp.guardar_plan("inglés b2: condicionales y phrasal verbs", None, PERFIL, plan_con(leccion("L1", "If")),
                                  [], None, None)
    assert t1 != t2 and t3 == t1


# --- 8. Botones de lecciones de otros planes solo si el título coincide de verdad ---------------------------------


def test_la_leccion_relacionada_no_sale_por_una_palabra_suelta() -> None:
    from magister.flujo.comun import _palabras, elegir_leccion

    filas = [(1, 10, "L5", "Meiosis II", "cromosomas homólogos", None, 0),
             (2, 20, "L2", "Tu primer SELECT", "consulta select", None, 0),
             (3, 30, "L4", "Phrasal verbs con get", "get up get over", None, 0)]
    mensaje = _palabras("explícame la diferencia entre get over y get through, en mi primer intento me lío con la meiosis")
    # En la charla de phrasal verbs (tema 30), su plan: basta una palabra.
    assert elegir_leccion(mensaje, filas, 30)["clave"] == "L4"
    # Sin plan propio, «primer» no saca «Tu primer SELECT»; «meiosis» sí saca «Meiosis II» (es todo su título).
    sin_plan = elegir_leccion(_palabras("en mi primer intento me lío"), filas, None)
    assert sin_plan is None
    assert elegir_leccion(_palabras("qué pasa en la meiosis"), filas, None)["clave"] == "L5"
    assert elegir_leccion(_palabras("mi primer select con where"), filas, None)["clave"] == "L2"


# --- 9. Dos «Aceptar» a la vez --------------------------------------------------------------------------------------


async def test_dos_aceptar_a_la_vez_acaban_los_dos_con_un_evento_claro(cliente, hoy_fijo) -> None:
    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Plan BD", "tipo": "plan"})).json()["id"]
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": PETICION})
    from magister.api import rutas_conversaciones

    url = f"/api/conversaciones/{cid}/plan/decision"
    # Las dos pasan la comprobación de «hay algo pendiente» antes de que la primera guarde: se retienen en el candado.
    candado = rutas_conversaciones._decisiones.setdefault(cid, asyncio.Lock())
    await candado.acquire()
    peticiones = [asyncio.create_task(cliente.post(url, json={"accion": "aceptar"})) for _ in range(2)]
    await asyncio.sleep(1)
    candado.release()
    a, b = await asyncio.gather(*peticiones)
    assert a.status_code == b.status_code == 200
    finales = sorted(eventos_sse(r.text)[-1][0] for r in (a, b))
    assert finales == ["error", "fin"]
    error = next(eventos_sse(r.text)[-1][1] for r in (a, b) if eventos_sse(r.text)[-1][0] == "error")
    assert error["ya_decidido"] and "ya estaba aceptado" in error["detalle"]
    planes = (await cliente.get("/api/planes")).json()
    assert len(planes) == 1 and planes[0]["version"] == 1


# --- 10. «Parar» y «Cambiar algo» dejan rastro en el hilo -----------------------------------------------------------


async def test_parar_antes_de_la_primera_palabra_guarda_un_interrumpido() -> None:
    from magister.api.flujo import TurnoCortado, flujo_tutor

    guardados: list[tuple[str, str]] = []

    async def guardar(texto, estado, *_):
        guardados.append((texto, estado))
        return 7

    async def cortado():
        yield {"tipo": "fase", "nodo": "responder"}
        raise TurnoCortado

    eventos = [e async for e in flujo_tutor(cortado(), guardar, {}, guardar_corte_vacio=True)]
    assert guardados == [("", "interrumpido")] and eventos[-1].event == "cortado"
    # En la llamada (sin la opción) sigue sin dejar vacíos.
    guardados.clear()
    [e async for e in flujo_tutor(cortado(), guardar, {})]
    assert guardados == []

    # Te vas a los 4 s (Parar corta la conexión): el flujo se cierra sin acabar y también queda el interrumpido.
    async def lento():
        yield {"tipo": "fase", "nodo": "responder"}
        await asyncio.sleep(10)
        yield {"tipo": "delta", "t": "tarde"}

    flujo = flujo_tutor(lento(), guardar, {}, guardar_corte_vacio=True)
    await flujo.__anext__()  # inicio
    await flujo.__anext__()  # fase
    await flujo.aclose()
    assert guardados == [("", "interrumpido")]


async def test_un_fallo_inesperado_acaba_en_error() -> None:
    from magister.api.flujo import flujo_tutor

    async def guardar(*_):
        return 1

    async def roto():
        yield {"tipo": "fase", "nodo": "guardar"}
        raise RuntimeError("se rompió la base")

    eventos = [e async for e in flujo_tutor(roto(), guardar, {})]
    assert eventos[-1].event == "error" and "vuelve a intentarlo" in eventos[-1].data["detalle"]


async def test_lo_que_pides_en_cambiar_algo_se_guarda_en_el_hilo(cliente, hoy_fijo) -> None:
    from magister.cerebro.estructura import eco
    from magister.plan.esquemas import Plan

    cid = (await cliente.post("/api/conversaciones", json={"titulo": "Plan BD", "tipo": "plan"})).json()["id"]
    await cliente.post(f"/api/conversaciones/{cid}/mensajes", json={"contenido": PETICION})
    eco.encolar(Plan, ["plan_ok.json"])
    await cliente.post(f"/api/conversaciones/{cid}/plan/decision", json={"accion": "cambiar", "texto": "Quita los viernes"})
    mensajes = (await cliente.get(f"/api/conversaciones/{cid}/mensajes")).json()
    assert [m["contenido"] for m in mensajes if m["rol"] == "usuario"] == [PETICION, "Quita los viernes"]


# --- 11 y 12. Fechas, decimales y el razonamiento del plan ----------------------------------------------------------


def test_textos_del_reajuste_con_fechas_y_decimales_como_se_dicen() -> None:
    from magister.aprender.reajuste import diferencias
    from magister.plan.calendario import NoCabe, fecha_larga

    assert fecha_larga(date(2027, 1, 5)) == "5 de enero de 2027"
    cambios = diferencias([{"fecha": "2027-01-05", "clave": "L1"}],
                          [{"fecha": "2027-01-04", "clave": "L1"}, {"fecha": "2027-01-04", "clave": "L2"}])
    assert cambios[0] == "El final pasa del 5 de enero de 2027 al 4 de enero de 2027."
    assert "L2: 0 sesiones pendientes antes, 1 ahora." in cambios
    assert NoCabe(2.5, 1.25).mensaje() == "No cabe: hacen falta 2,5 h y hay 1,2 h; faltan 1,2 h."


def test_el_prompt_del_reajuste_esta_en_su_plantilla() -> None:
    from magister.cerebro.prompts import cargar

    p = cargar("reajuste")
    assert len(p.version) == 12 and "tuteando" in p.rellenar()


def test_el_razonamiento_sin_jerga_ni_horas_inventadas() -> None:
    from magister.plan.razonamiento import pulir_razonamiento

    texto = ("Alcance: tema_amplio. Partes de SQL básico, así que empiezo por los joins. Uso unas 22 h para todo. "
             "La L3 lleva 2 h porque es práctica.\nProyecto: una API de reservas.")
    pulido = pulir_razonamiento(texto, [4, 2, 6, 6, 8], {1.5})
    assert "tema_amplio" not in pulido and "Alcance" not in pulido and pulido.startswith("Es un tema amplio")
    assert "22 h" not in pulido and "La L3 lleva 2 h" in pulido and "Proyecto: una API de reservas." in pulido
    assert pulido.endswith("En total son 26 h en 5 lecciones.")
    # Si no hay nada que quitar, no se añade nada.
    assert pulir_razonamiento("Partes de cero.", [1, 2]) == "Partes de cero."
