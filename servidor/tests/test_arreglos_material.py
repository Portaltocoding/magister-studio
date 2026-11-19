"""Arreglos del material tras la prueba: opciones de las tipo test en los apuntes y el PDF, baraja estable, sangría
del repaso, estado de los materiales del plan, cola con varios trabajadores y el libro."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from magister.config import ajustes
from magister.material.plantillas import barajar, montar_apuntes

# Opciones y repaso


def test_barajar_igual_que_la_web() -> None:
    # Los mismos vectores que web/pruebas/barajar.test.ts: el PDF y la web enseñan el mismo orden.
    assert barajar(list("abcd"), "1") == list("abdc")
    assert barajar(list("abcd"), "42") == list("dacb")
    assert barajar(list("abcd"), "1234") == list("cabd")
    assert barajar(list("abc"), "1234") == list("bac")
    assert barajar(list("abcd"), "42") == barajar(list("abcd"), "42")


def test_la_buena_no_sale_siempre_la_primera() -> None:
    posiciones = {barajar([0, 1, 2, 3], str(s)).index(0) for s in range(1, 40)}
    assert posiciones == {0, 1, 2, 3}


def _test(i: int) -> dict:
    return {"id": i, "enunciado": f"Pregunta {i}: un banquero parisino de 1788 pertenecía a:",
            "fantasma": "El tercer estado: la trampa es pensar en la riqueza.",
            "opciones": [{"texto": "El tercer estado", "buena": True}, {"texto": "La nobleza", "buena": False},
                         {"texto": "El clero", "buena": False}]}


def _abierta(i: int) -> dict:
    return {"id": i, "enunciado": f"¿Pregunta abierta {i}?", "fantasma": "Línea uno.\nLínea dos."}


@pytest.mark.parametrize("estilo", ["libro", "ficha"])
def test_las_tipo_test_llevan_sus_opciones_en_los_apuntes(estilo: str) -> None:
    md = montar_apuntes("Antiguo Régimen", "Magister · Historia", "a.pdf", [], [("Bloque", "Texto.")], [_test(7)],
                        estilo=estilo)
    orden = [o["texto"] for o in barajar(_test(7)["opciones"], "7")]
    for letra, texto in zip("abc", orden):
        assert f"   - **{letra})** {texto}" in md
    buena = "abc"[orden.index("El tercer estado")]
    assert f"**Respuesta: {buena})**. El tercer estado" in md


def test_la_pregunta_diez_sangra_al_ancho_de_su_numero() -> None:
    repaso = [_abierta(i) for i in range(1, 10)] + [_test(10)]
    md = montar_apuntes("T", "P", "a.pdf", [], [("B", "x")], repaso)
    assert "10. Pregunta 10" in md
    assert "\n    ::: fantasma\n    **Respuesta:" in md and "\n    - **a)** " in md
    # Las de una cifra siguen con tres espacios y la respuesta de varias líneas va entera dentro.
    assert "\n   ::: fantasma\n   Línea uno.\n   Línea dos.\n   :::" in md


@pytest.mark.skipif(not (shutil.which("pandoc") or (Path(ajustes.pandoc) / "pandoc.exe").exists()), reason="sin pandoc")
def test_con_pandoc_la_respuesta_de_la_diez_queda_dentro_de_su_elemento() -> None:
    pandoc = shutil.which("pandoc") or str(Path(ajustes.pandoc) / "pandoc.exe")
    repaso = [_abierta(i) for i in range(1, 10)] + [_test(10), _abierta(11)]
    md = montar_apuntes("T", "P", "a.pdf", [], [("B", "x")], repaso)
    md = re.sub(r"\A---\n.*?\n---\n", "", md, flags=re.S)
    html = subprocess.run([pandoc, "-f", "markdown", "-t", "html5", "--wrap=none"], input=md, capture_output=True,
                          text=True, encoding="utf-8", check=True).stdout
    assert ":::" not in html
    assert html.count('<div class="fantasma">') == 11
    diez = html[html.index("Pregunta 10"):html.index("abierta 11")]
    assert '<div class="fantasma">' in diez and "</li>" in diez.split('<div class="fantasma">')[1]
    assert "El tercer estado" in diez and "<ul>" in diez
    assert "<ol" not in diez.split("Pregunta 10")[1]  # la letra no abre otra lista («a.»)


# La cola con varios trabajadores (base de pruebas)


async def _encolar(tipo: str, plan_id, clave, n: str, parametros: dict | None = None) -> int:
    from magister.trabajos import cola

    tid, _ = await cola.encolar(tipo, plan_id, clave, parametros or {}, f"prueba-{n}")
    return tid


@pytest.mark.anyio
async def test_dos_de_la_misma_leccion_no_corren_a_la_vez(base, monkeypatch) -> None:
    from magister.trabajos import cola

    monkeypatch.setattr(ajustes, "trabajos_a_la_vez", 20)

    a = await _encolar("material", 1, "L1", "a")
    b = await _encolar("material", 1, "L1", "b")
    c = await _encolar("material", 1, "L2", "c")
    assert (await cola.coger("t1")).id == a
    # El segundo de L1 espera; el de L2 no se queda detrás de él.
    assert (await cola.coger("t2")).id == c
    assert await cola.coger("t3") is None
    await cola.terminar(a, "hecho")
    assert (await cola.coger("t3")).id == b


@pytest.mark.anyio
async def test_un_lease_caducado_no_bloquea_su_leccion(base) -> None:
    from sqlalchemy import update

    from magister.datos.material import Trabajo
    from magister.datos.sesion import nueva_sesion
    from magister.trabajos import cola

    a = await _encolar("material", 1, "L1", "a")
    await _encolar("material", 1, "L1", "b")
    assert (await cola.coger("t1")).id == a
    async with nueva_sesion() as s, s.begin():  # el trabajador de «a» murió: su lease caducó
        await s.execute(update(Trabajo).where(Trabajo.id == a).values(lease_hasta=cola.ahora().replace(year=2000)))
    # Vuelve «a» (el más antiguo), no los dos a la vez.
    assert (await cola.coger("t2")).id == a
    assert await cola.coger("t3") is None


@pytest.mark.anyio
async def test_los_cortos_pasan_antes_y_los_largos_dejan_un_hueco(base, monkeypatch) -> None:
    from magister.trabajos import cola

    monkeypatch.setattr(ajustes, "trabajos_a_la_vez", 2)
    apuntes1 = await _encolar("material", 1, "L1", "m1", {"tipos": ["apuntes", "preguntas"]})
    apuntes2 = await _encolar("material", 1, "L2", "m2", {"tipos": ["apuntes"]})
    sin_tipos = await _encolar("material", 1, "L5", "m5")
    mp4 = await _encolar("video_mp4", 1, "L3", "v1")
    # Un corto que llega el último no espera detrás de los apuntes, y su posición lo dice.
    assert (await cola.leer(mp4))["cola"]["por_delante"] == 0
    assert (await cola.leer(apuntes2))["cola"]["por_delante"] == 2  # el mp4 y apuntes1
    assert (await cola.coger("t1")).id == mp4
    assert (await cola.coger("t2")).id == apuntes1
    # Los largos ya ocupan su hueco (a_la_vez - 1): el otro queda para cortos.
    assert await cola.coger("t3") is None
    diapositivas = await _encolar("material", 1, "L4", "d1", {"tipos": ["diapositivas"]})
    incorporar = await _encolar("incorporar", 1, None, "i1")
    assert (await cola.coger("t3")).id == diapositivas
    await cola.terminar(mp4, "hecho")
    assert (await cola.coger("t4")).id == incorporar
    await cola.terminar(diapositivas, "hecho")
    await cola.terminar(incorporar, "hecho")
    await cola.terminar(apuntes1, "hecho")
    # Sin cortos pendientes, los largos siguen por orden de llegada.
    assert (await cola.coger("t5")).id == apuntes2
    await cola.terminar(apuntes2, "hecho")
    assert (await cola.coger("t5")).id == sin_tipos


def test_corto_en_python() -> None:
    from magister.trabajos.cola import es_corto

    assert es_corto("incorporar", {}) and es_corto("video_mp4", None) and es_corto("material", {"tipos": ["guion"]})
    assert not es_corto("material", {}) and not es_corto("material", {"tipos": ["diapositivas", "apuntes"]})
    assert not es_corto("proyecto_roadmap", {"proyecto_id": 1})


@pytest.mark.anyio
async def test_incorporar_y_el_mismo_proyecto_van_de_uno_en_uno(base, monkeypatch) -> None:
    from magister.trabajos import cola

    monkeypatch.setattr(ajustes, "trabajos_a_la_vez", 5)
    i1 = await _encolar("incorporar", 1, None, "i1")
    await _encolar("incorporar", 2, "L1", "i2")
    p1 = await _encolar("proyecto_nivel", None, None, "p1", {"proyecto_id": 3})
    await _encolar("proyecto_roadmap", None, None, "p2", {"proyecto_id": 3})
    p3 = await _encolar("proyecto_roadmap", None, None, "p3", {"proyecto_id": 4})
    cogidos = [(await cola.coger(f"t{k}")) for k in range(5)]
    assert [t.id for t in cogidos if t] == [i1, p1, p3]


@pytest.mark.anyio
async def test_reservas_a_la_vez_nunca_dan_el_mismo_trabajo(base, monkeypatch) -> None:
    import asyncio

    from magister.trabajos import cola

    monkeypatch.setattr(ajustes, "trabajos_a_la_vez", 20)

    distintas = [await _encolar("material", 1, f"L{k}", f"d{k}") for k in range(8)]
    misma = [await _encolar("material", 2, "L1", f"m{k}") for k in range(4)]
    cogidos = await asyncio.gather(*(cola.coger(f"t{k}") for k in range(16)))
    ids = [t.id for t in cogidos if t is not None]
    assert len(ids) == len(set(ids))
    assert set(distintas) <= set(ids)
    assert len(set(misma) & set(ids)) == 1


@pytest.mark.anyio
async def test_el_tope_de_largos_aguanta_reservas_a_la_vez(base, monkeypatch) -> None:
    import asyncio

    from magister.trabajos import cola

    monkeypatch.setattr(ajustes, "trabajos_a_la_vez", 2)
    for k in range(6):
        await _encolar("material", 1, f"L{k}", f"d{k}")
    cogidos = await asyncio.gather(*(cola.coger(f"t{k}") for k in range(6)))
    assert sum(t is not None for t in cogidos) == 1


@pytest.mark.anyio
async def test_la_cola_dice_cuantos_van_por_delante(base) -> None:
    from magister.trabajos import cola

    ids = [await _encolar("material", 1, f"L{k}", f"c{k}") for k in range(5)]
    await cola.coger("t1")
    t = await cola.leer(ids[4])
    assert t["estado"] == "pendiente"
    assert t["cola"]["por_delante"] == 3 and t["cola"]["en_marcha"] == 1 and t["cola"]["a_la_vez"] >= 1
    assert (await cola.leer(ids[0]))["cola"] is None


@pytest.mark.anyio
async def test_el_bucle_lanza_tantos_trabajadores_como_el_ajuste(monkeypatch) -> None:
    from magister.trabajos import trabajador

    vistos: list[str] = []

    async def falso(quien: str, pausa: float) -> None:
        vistos.append(quien)

    monkeypatch.setattr(trabajador, "_uno", falso)
    monkeypatch.setattr(ajustes, "trabajos_a_la_vez", 3)
    await trabajador.bucle()
    assert len(vistos) == 3 and len(set(vistos)) == 3


# Materiales del plan, contrato y libro


@pytest.mark.anyio
async def test_un_material_a_medias_no_se_ofrece_como_apuntes(cliente) -> None:
    from sqlalchemy import update

    from magister.datos.material import Material
    from magister.datos.sesion import nueva_sesion
    from magister.material import almacen
    from magister.trabajos import cola
    from tests.test_material import plan_aceptado

    plan_id = await plan_aceptado()
    tid, _ = await cola.encolar("material", plan_id, "L1", {"tipos": ["apuntes", "preguntas"]}, "clave-medias")
    a_medias = await almacen.nuevo_material(plan_id, "L1", "apuntes", tid)
    await almacen.guardar_contrato(a_medias, {"razonamiento": "Ordeno así porque…", "definiciones": [],
                                              "bloques": [{"clave": "b1", "titulo": "Claves", "conceptos": [],
                                                           "proposito": "Responde: qué es. Aclara que…"}]})
    plan = (await cliente.get(f"/api/planes/{plan_id}/materiales")).json()
    l1 = plan["L1"]
    assert l1["tipos"]["apuntes"] == "generando" and "apuntes_id" not in l1 and l1["ids"] == {}
    assert l1["apuntes_listos"] is False
    assert l1["trabajo"] == {"id": tid, "estado": "pendiente", "tipos": ["apuntes", "preguntas"]}
    # Ya terminado (aunque sea «revisar»), se ofrece; las diapositivas que se hacen luego no lo tapan.
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Material).where(Material.id == a_medias).values(estado="revisar"))
    await cola.terminar(tid, "hecho")
    tid2, _ = await cola.encolar("material", plan_id, "L1", {"tipos": ["diapositivas"]}, "clave-diapos")
    await cola.coger("t1")
    l1 = (await cliente.get(f"/api/planes/{plan_id}/materiales")).json()["L1"]
    assert l1["apuntes_id"] == a_medias and l1["apuntes_listos"] is True
    assert l1["trabajo"] == {"id": tid2, "estado": "en_curso", "tipos": ["diapositivas"]}
    # El contrato que viaja a la web no lleva las instrucciones internas.
    m = (await cliente.get(f"/api/materiales/{a_medias}")).json()
    assert m["contrato"]["bloques"] == [{"clave": "b1", "titulo": "Claves", "conceptos": []}]
    assert "Responde" not in str(m["contrato"]) and "razonamiento" not in m["contrato"]
    # La posición en la cola viaja con el trabajo.
    t = (await cliente.get(f"/api/trabajos/{tid2}")).json()
    assert "cola" in t and t["cola"] is None


@pytest.mark.anyio
async def test_el_estado_del_libro_no_da_rutas_del_disco(cliente) -> None:
    from magister.material.libro import _guardar

    await _guardar("libro_plan_7", {"estado": "listo", "pdf": "C:/Users/alguien/salidas/7-libro/libro.pdf",
                                    "lecciones": ["L1"], "faltan": [], "paginas": 12, "error": None, "fecha": "x"})
    r = (await cliente.get("/api/planes/7/libro")).json()
    assert "pdf" not in r and r["estado"] == "listo" and r["paginas"] == 12


def test_el_libro_solo_nombra_temas_con_lecciones_y_numera_el_indice() -> None:
    from magister.material.libro import markdown_libro

    apuntes = {"L1": "---\ntitulo: x\n---\n\n::: capitulo\n# Título largo\n:::\n\n## Bloque {.nb}\n\nTexto.",
               "L3": "::: capitulo\n# Otra\n:::\n"}
    temas = [{"nombre": "Uno", "lecciones": ["L1", "L2"], "trata": ["a"]},
             {"nombre": "Vacío", "lecciones": ["L4"], "trata": ["b"]},
             {"nombre": "Tres", "lecciones": ["L3"], "trata": ["c"]}]
    md, incluidas, faltan = markdown_libro("Historia", temas, {"L1": "Corto"}, apuntes, ["L1", "L2", "L3", "L4"], "s.pdf")
    assert incluidas == ["L1", "L3"] and faltan == ["L2", "L4"]
    assert "[Uno; Tres]{.salir}" in md and "Vacío" not in md
    assert "{.num}" not in md and "2 lecciones" in md
    assert '- Corto [?]{.pg data-for="cap-l1"}' in md and '- L3 [?]{.pg data-for="cap-l3"}' in md
    assert "# Corto {#cap-l1}" in md and "# Otra {#cap-l3}" in md


def test_el_motivo_de_revisar_dice_que_bloque_y_que_hacer() -> None:
    from magister.material.almacen import motivo_revisar

    contrato = {"bloques": [{"clave": "b1", "titulo": "Los tres estamentos"}, {"clave": "b2", "titulo": "La crisis"}]}
    uno = motivo_revisar(["b2"], contrato)
    assert "«La crisis»" in uno and "b2" not in uno and "Rehacer" in uno and "leerlo igualmente" in uno
    dos = motivo_revisar(["b1", "b2"], contrato)
    assert "Los bloques «Los tres estamentos» y «La crisis» no han pasado" in dos


def test_los_controles_de_marp_en_castellano_y_las_teclas_quietas() -> None:
    from magister.material.diapositivas import castellanizar_marp

    # Trozos tal cual los da marp-cli 4.5.1 (minificado).
    html = ('<html><body><button title="Previous slide"></button><button title="Next slide"></button>'
            '<script>e.on("activate",({index:t})=>{n("page",n=>n.textContent=`Page ${t+1} of ${e.slides.length}`)})'
            '</script></body></html>')
    salida = castellanizar_marp(html)
    assert "`Diapositiva ${t+1} de ${e.slides.length}`" in salida and "Page $" not in salida
    assert 'title="Diapositiva anterior"' in salida and 'title="Diapositiva siguiente"' in salida
    assert salida.count("preventDefault()") == 1 and salida.endswith("</script></body></html>")
    assert castellanizar_marp(salida) == salida


@pytest.mark.anyio
async def test_el_libro_vuelve_a_montar_los_apuntes_con_sus_opciones(base, monkeypatch) -> None:
    from sqlalchemy import update

    from magister.datos.material import Material, Pregunta
    from magister.datos.sesion import nueva_sesion
    from magister.material import almacen, libro, render
    from tests.test_material import plan_aceptado

    plan_id = await plan_aceptado()
    mid = await almacen.nuevo_material(plan_id, "L1", "apuntes", None)
    await almacen.guardar_bloque(mid, "b1", "Claves", "Texto del bloque.", 0, False, "v")
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Material).where(Material.id == mid).values(estado="listo", texto="viejo sin opciones"))
        s.add(Pregunta(id="p-test", plan_id=plan_id, leccion_clave="L1", tipo="test", enunciado="¿Cuál?",
                       fantasma="La buena.", donde="b1", estado="activa",
                       opciones=[{"texto": "Buena", "buena": True}, {"texto": "Mala", "buena": False},
                                 {"texto": "Peor", "buena": False}]))
    await libro._guardar(f"indice_plan_{plan_id}", {"temas": [{"nombre": "Todo", "lecciones": ["L1"], "trata": ["x"]}],
                                                    "titulos": {}})
    visto: dict = {}

    async def pintar(md, plan, clave, nombre="apuntes", estilo="libro"):
        visto["md"] = md
        return render.Render(None, None, error="sin motor en las pruebas")

    monkeypatch.setattr(render, "pintar", pintar)
    await libro.montar_libro(plan_id)
    assert "viejo sin opciones" not in visto["md"] and "**a)**" in visto["md"] and "Buena" in visto["md"]
    assert '[?]{.pg data-for="cap-l1"}' in visto["md"]
