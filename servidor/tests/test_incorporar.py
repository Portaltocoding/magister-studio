"""Incorporar en bloque las propuestas del research, sin red (httpx con MockTransport) ni modelo."""

import json
from pathlib import Path

import httpx
import pytest

from magister.datos.fuentes import Propuesta, Version
from magister.datos.sesion import nueva_sesion
from magister.fuentes import ingesta
from magister.material.generador import Cancelado
from magister.seguridad.politica import UrlProhibida
from magister.trabajos import cola, incorporar

pytestmark = pytest.mark.anyio

FIJOS = Path(__file__).parent / "fijos"


def pagina(titulo: str) -> bytes:
    parrafos = "".join(f"<p>{titulo}: frase {i} con bastante detalle para que haya texto de sobra.</p>" for i in range(8))
    return f"<html><head><title>{titulo}</title></head><body><article><h1>{titulo}</h1>{parrafos}</article></body></html>".encode()


def responder(peticion: httpx.Request) -> httpx.Response:
    ruta = peticion.url.path
    if ruta == "/buena":
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, content=pagina("Colas M/M/1"))
    if ruta == "/imagen":
        return httpx.Response(200, headers={"content-type": "image/png"}, content=b"\x89PNG")
    if ruta == "/vacia":
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"")
    if ruta == "/corta":  # se carga con JavaScript: casi no tiene texto
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html><body><p>hola</p></body></html>")
    if ruta == "/salta":
        return httpx.Response(302, headers={"location": "http://interna.test/secreto"})
    return httpx.Response(404)


@pytest.fixture
def web_falsa(monkeypatch):
    """Toda descarga pasa por la respuesta de arriba; «interna.test» hace de dirección interna."""
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: original(*a, transport=httpx.MockTransport(responder), **k))

    def comprobar(url: str) -> None:
        if "interna.test" in url:
            raise UrlProhibida("interna.test apunta a una dirección interna (10.0.0.1)")

    monkeypatch.setattr("magister.seguridad.politica.comprobar_url", comprobar)


async def plan_con_propuestas(urls: list[str], tarea_id: int | None = None) -> tuple[int, list[int]]:
    from magister.datos.plan import guardar_plan

    plan = json.loads((FIJOS / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((FIJOS / "Perfil.json").read_text(encoding="utf-8"))
    _, plan_id = await guardar_plan("teoría de colas", None, perfil, plan, [], "x", "eco")
    ids = []
    async with nueva_sesion() as s, s.begin():
        for u in urls:
            p = Propuesta(url=u, titulo=u.rsplit("/", 1)[-1], plan_id=plan_id, leccion_clave="L1", motivo="m", tarea_id=tarea_id)
            s.add(p)
            await s.flush()
            ids.append(p.id)
    return plan_id, ids


URLS = ["https://a.example/buena", "https://a.example/no-existe", "https://a.example/imagen",
        "https://a.example/vacia", "https://a.example/salta", "http://interna.test/directa"]


async def test_incorporar_sigue_cuando_una_falla_y_anota_por_que(base, web_falsa) -> None:
    plan_id, ids = await plan_con_propuestas(URLS)
    tid, n = await incorporar.encolar(plan_id)
    assert n == len(URLS)
    await incorporar.ejecutar(tid, {"ids": ids, "automatica": False})
    r = await incorporar.leer(tid)
    assert (r["total"], r["van"], r["entradas"]) == (6, 6, 1)
    motivos = {f["url"]: f["motivo"] for f in r["fallidas"]}
    assert motivos["https://a.example/no-existe"] == "la página da error 404"
    assert "no es una página ni un PDF" in motivos["https://a.example/imagen"]
    assert motivos["https://a.example/vacia"] == "la página está vacía"
    assert motivos["https://a.example/salta"].startswith("dirección prohibida")  # la redirección también se vigila
    assert motivos["http://interna.test/directa"].startswith("dirección prohibida")
    async with nueva_sesion() as s:
        buena = await s.get(Propuesta, ids[0])
        v = await s.get(Version, buena.version_id)
        resto = [(await s.get(Propuesta, i)).estado for i in ids[1:]]
    # Entra ya extraída y validada (el bucle de fondo solo tiene que indexarla), con su origen.
    assert buena.estado == "aprobada" and v.estado == "pendiente"
    assert v.metadatos["origen"] == "research" and v.metadatos["leccion_clave"] == "L1"
    assert resto == ["pendiente"] * 5  # las que fallan siguen ahí, para reintentar o descartar


async def test_incorporar_dos_veces_no_duplica(base, web_falsa) -> None:
    plan_id, ids = await plan_con_propuestas(URLS[:2])
    tid, _ = await incorporar.encolar(plan_id)
    await incorporar.ejecutar(tid, {"ids": ids})
    # Reanudar el mismo trabajo (el trabajador murió) y lanzar otra ronda no bajan ni anotan nada dos veces.
    await incorporar.ejecutar(tid, {"ids": ids})
    otro, _ = await incorporar.encolar(plan_id, ronda="otra")
    await incorporar.ejecutar(otro, {"ids": [ids[1]]})
    async with nueva_sesion() as s:
        from sqlalchemy import func, select

        versiones = await s.scalar(select(func.count()).select_from(Version))
    r = await incorporar.leer(tid)
    assert versiones == 1 and (r["van"], r["entradas"]) == (2, 1)


async def test_incorporar_se_puede_cancelar(base, web_falsa) -> None:
    plan_id, ids = await plan_con_propuestas(URLS[:1])
    tid, _ = await incorporar.encolar(plan_id)
    await cola.cancelar(tid)
    with pytest.raises(Cancelado):
        await incorporar.ejecutar(tid, {"ids": ids})
    async with nueva_sesion() as s:
        assert (await s.get(Propuesta, ids[0])).estado == "pendiente"


async def test_endpoint_lanza_una_vez_y_enseña_el_progreso(cliente) -> None:
    await plan_con_propuestas(URLS[:3])
    r1 = (await cliente.post("/api/incorporar", json={})).json()
    r2 = (await cliente.post("/api/incorporar", json={})).json()
    assert r1["total"] == 3 and not r1["ya_en_marcha"]
    assert r2["trabajo_id"] == r1["trabajo_id"] and r2["ya_en_marcha"]
    ultimo = (await cliente.get("/api/incorporar/ultimo")).json()["ultimo"]
    assert ultimo["trabajo_id"] == r1["trabajo_id"] and ultimo["van"] == 0 and ultimo["estado"] == "pendiente"


async def test_lo_que_acaba_en_cuarentena_sigue_pendiente(base, web_falsa) -> None:
    plan_id, [pid] = await plan_con_propuestas(["https://a.example/corta"])
    tid, _ = await incorporar.encolar(plan_id)
    await incorporar.ejecutar(tid, {"ids": [pid]})
    r = await incorporar.leer(tid)
    assert r["entradas"] == 0 and "Casi no tiene texto" in r["fallidas"][0]["motivo"]
    async with nueva_sesion() as s:
        p = await s.get(Propuesta, pid)
    assert p.estado == "pendiente"  # no desaparece de «Propuestas por revisar»


async def test_un_error_inesperado_en_una_no_para_las_demas(base, web_falsa, monkeypatch) -> None:
    from sqlalchemy.exc import IntegrityError

    original = ingesta.recibir

    async def recibir(fuente_id, crudo, nombre, uri, *a, **k):
        if "rota" in uri:  # como si hubieras borrado la fuente a mitad del trabajo
            raise IntegrityError("insert into documentos", {}, Exception("viola la clave ajena fk_documentos_fuente_id"))
        return await original(fuente_id, crudo, nombre, uri, *a, **k)

    monkeypatch.setattr(ingesta, "recibir", recibir)
    plan_id, ids = await plan_con_propuestas(["https://a.example/buena?rota", "https://a.example/buena"])
    tid, _ = await incorporar.encolar(plan_id)
    await incorporar.ejecutar(tid, {"ids": ids})
    r = await incorporar.leer(tid)
    assert (r["van"], r["entradas"]) == (2, 1)
    assert r["fallidas"][0]["propuesta_id"] == ids[0] and "IntegrityError" in r["fallidas"][0]["motivo"]
    async with nueva_sesion() as s:
        assert [(await s.get(Propuesta, i)).estado for i in ids] == ["pendiente", "aprobada"]


async def test_sin_pendientes_no_encola(base) -> None:
    assert await incorporar.encolar() == (None, 0)


def test_resumen_cuenta_entradas_y_fallos() -> None:
    t = {"id": 7, "estado": "hecho", "parametros": {"ids": [1, 2, 3], "automatica": True}, "avisos": [
        {"regla": "incorporada", "propuesta_id": 1},
        {"regla": "no_incorporada", "propuesta_id": 2, "url": "u", "motivo": "la página da error 404"},
        {"regla": "otra", "detalle": "no cuenta"},
    ]}
    r = incorporar.resumen(t)
    assert (r["total"], r["van"], r["entradas"], r["automatica"]) == (3, 2, 1, True)
    assert r["fallidas"][0]["motivo"] == "la página da error 404"


def test_tipo_externo() -> None:
    assert ingesta.tipo_externo("text/html; charset=utf-8", "https://x") == "html"
    assert ingesta.tipo_externo("application/pdf", "https://x") == "pdf"
    assert ingesta.tipo_externo("", "https://x/a.pdf") == "pdf"
    assert ingesta.tipo_externo("text/plain", "https://x") == "txt"
    with pytest.raises(ValueError, match="no es una página"):
        ingesta.tipo_externo("application/zip", "https://x")


# Lo que se queda a medias (P4)


def test_explicar_problema() -> None:
    claro, a = ingesta.explicar_problema("cuarentena", "no se pudo indexar: maximum recursion depth exceeded", True, 0)
    assert a == "pendiente" and "indexarlo" in claro
    assert ingesta.explicar_problema("cuarentena", "no se pudo extraer: roto", False, 0)[1] == "recibida"
    assert ingesta.explicar_problema("cuarentena", "solo 12 caracteres de texto (mínimo 80)", True, 0)[1] is None
    assert ingesta.explicar_problema("lista", None, True, 0)[1] == "pendiente"
    assert ingesta.explicar_problema("lista", None, True, 5) == ("", None)


async def test_resumen_y_reintentar_lo_que_fallo_al_indexar(cliente) -> None:
    from magister.datos import repositorio_fuentes as rf

    async with nueva_sesion() as s:
        fid = (await rf.crear_fuente(s, "Documentos buscados", "web", 1)).id
    crudo = pagina("Delirios").decode()
    vid = await ingesta.recibir(fid, crudo.encode(), "https://b.example/delirio", "https://b.example/delirio", None, "html")
    await ingesta.procesar_recibida(vid)
    async with nueva_sesion() as s, s.begin():
        v = await s.get(Version, vid)
        v.estado, v.motivo = "cuarentena", "no se pudo indexar: maximum recursion depth exceeded"
    r = (await cliente.get("/api/fuentes/resumen")).json()
    assert (r["listos"], r["indexando"], r["con_problema"]) == (0, 0, 1)
    assert r["problemas"][0]["reintentable"] and r["problemas"][0]["que_paso"]
    assert (await cliente.post(f"/api/versiones/{vid}/reintentar")).json()["estado"] == "pendiente"
    await ingesta.procesar_pendientes()
    r = (await cliente.get("/api/fuentes/resumen")).json()
    assert (r["listos"], r["con_problema"]) == (1, 0)
    # Lo que ya está bien no se reintenta.
    assert (await cliente.post(f"/api/versiones/{vid}/reintentar")).status_code == 409


async def test_reintentar_no_arregla_lo_que_casi_no_tiene_texto(cliente) -> None:
    from magister.datos import repositorio_fuentes as rf

    async with nueva_sesion() as s:
        fid = (await rf.crear_fuente(s, "web", "web", 1)).id
    vid = await ingesta.recibir(fid, b"<p>hola</p>", "https://c.example/x", "https://c.example/x", None, "html")
    await ingesta.procesar_recibida(vid)
    r = (await cliente.get("/api/fuentes/resumen")).json()
    assert r["con_problema"] == 1 and not r["problemas"][0]["reintentable"]
    res = await cliente.post(f"/api/versiones/{vid}/reintentar")
    assert res.status_code == 409 and "no lo arregla" in res.json()["detail"]
