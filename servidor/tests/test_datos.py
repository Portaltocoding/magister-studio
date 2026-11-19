"""Tus datos desde Ajustes: descargarlos, las copias de la base y restaurar (solo en bases de prueba aparte)."""

import io
import shutil
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import asyncpg
import pytest
from sqlalchemy.engine import make_url

from magister.config import ajustes
from magister.datos import tus_datos as td
from magister.datos.produccion import Ajuste
from magister.datos.sesion import nueva_sesion

pytestmark = pytest.mark.anyio

CANARIO = "mg-canario-de-prueba"
MOMENTO = datetime(2026, 11, 19, 10, 30, tzinfo=ZoneInfo("Europe/Madrid"))


def _escribir(ruta: Path, datos: bytes) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_bytes(datos)


async def test_el_paquete_trae_todas_tus_tablas_y_ficheros_y_ningun_secreto(cliente, monkeypatch) -> None:
    monkeypatch.setattr(ajustes, "canario", CANARIO)
    async with nueva_sesion() as s, s.begin():
        s.add(Ajuste(clave="canario", valor={"valor": CANARIO}))
    await cliente.post("/api/conversaciones", json={"titulo": "para exportar"})
    await cliente.post("/api/conversaciones", json={"titulo": f"se coló {CANARIO}"})
    salidas, crudo = Path(ajustes.salidas), Path(ajustes.crudo)
    _escribir(salidas / "1-L1" / "apuntes.pdf", b"%PDF-1.7 apuntes")
    _escribir(salidas / "1-L1" / "fuga.md", f"clave {CANARIO}".encode())
    _escribir(salidas / ".env", b"MAGISTER_TOKEN=tok-secreto")
    _escribir(crudo / "secretos" / "canario", CANARIO.encode())
    _escribir(crudo / "abc123", b"original descargado")

    r = await cliente.get("/api/datos/exportar")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert 'filename="magister-' in r.headers["content-disposition"] and '.zip"' in r.headers["content-disposition"]
    z = zipfile.ZipFile(io.BytesIO(r.content))
    nombres = set(z.namelist())
    assert {f"{t}.json" for t in td.TABLAS} <= nombres and "LEEME.txt" in nombres
    assert {"ficheros/salidas/1-L1/apuntes.pdf", "ficheros/crudo/abc123"} <= nombres
    assert not [n for n in nombres if ".env" in n or "secretos" in n or "fuga" in n or "instalacion" in n]
    for n in nombres:
        datos = z.read(n)
        assert CANARIO.encode() not in datos and b"tok-secreto" not in datos, n
    assert "para exportar" in z.read("conversaciones.json").decode("utf-8")
    assert "No se ha quedado nada fuera" in z.read("LEEME.txt").decode("utf-8")


async def test_lo_que_no_cabe_se_queda_fuera_y_el_leeme_lo_dice(base, tmp_path, monkeypatch) -> None:
    salidas, crudo = tmp_path / "s", tmp_path / "c"
    _escribir(salidas / "1-L1" / "guion.md", b"g" * 50)
    _escribir(crudo / "grande", b"x" * 1000)
    monkeypatch.setattr(ajustes, "salidas", str(salidas))
    monkeypatch.setattr(ajustes, "crudo", str(crudo))
    destino, info = await td.paquete(MOMENTO, tmp_path / "paquete", 200)
    assert destino.name == "magister-2026-11-19.zip" and info["fuera"] == 1
    z = zipfile.ZipFile(destino)
    assert "ficheros/salidas/1-L1/guion.md" in z.namelist() and "ficheros/crudo/grande" not in z.namelist()
    leeme = z.read("LEEME.txt").decode("utf-8")
    assert "fuera por tamaño 1 ficheros" in leeme and "- crudo/grande" in leeme


async def test_listar_copias(cliente, tmp_path, monkeypatch) -> None:
    raiz = tmp_path / "copias"
    _escribir(raiz / "diarias" / "magister-2026-11-18.dump", b"d" * 10)
    _escribir(raiz / "semanales" / "magister-2026-11-16.dump", b"s" * 20)
    _escribir(raiz / "diarias" / "checkpoints-2026-11-18.sqlite", b"no es una copia de la base")
    monkeypatch.setattr(ajustes, "copias", str(raiz))
    r = (await cliente.get("/api/datos/copias")).json()
    por_id = {c["id"]: c for c in r["copias"]}
    assert set(por_id) == {"diarias/magister-2026-11-18.dump", "semanales/magister-2026-11-16.dump"}
    assert por_id["diarias/magister-2026-11-18.dump"]["dia"] == "2026-11-18" and por_id["diarias/magister-2026-11-18.dump"]["bytes"] == 10


async def test_restaurar_sin_la_palabra_no_restaura_nada(cliente, tmp_path, monkeypatch) -> None:
    raiz = tmp_path / "copias"
    _escribir(raiz / "diarias" / "magister-2026-11-18.dump", b"d")
    monkeypatch.setattr(ajustes, "copias", str(raiz))
    llamadas = []

    async def falso(*a, **k):
        llamadas.append(a)
        return {"copia_previa": "x"}

    monkeypatch.setattr(td, "restaurar", falso)
    copia = "diarias/magister-2026-11-18.dump"
    assert (await cliente.post("/api/datos/copias/restaurar")).status_code == 422
    assert (await cliente.post("/api/datos/copias/restaurar", json={"copia": copia})).status_code == 422
    assert (await cliente.post("/api/datos/copias/restaurar", json={"copia": copia, "confirmacion": "si"})).status_code == 400
    assert (await cliente.post("/api/datos/copias/restaurar", content=b"copia=x&confirmacion=RESTAURAR",
                               headers={"Content-Type": "application/x-www-form-urlencoded"})).status_code == 415
    r = await cliente.post("/api/datos/copias/restaurar", json={"copia": copia, "confirmacion": "RESTAURAR"},
                           headers={"Origin": "https://otra.web"})
    assert r.status_code == 403
    assert (await cliente.post("/api/datos/copias", headers={"Origin": "https://otra.web"})).status_code == 403
    for mala in ("../diarias/magister-2026-11-18.dump", "diarias/../../x.dump", "diarias/magister-2026-11-17.dump"):
        assert (await cliente.post("/api/datos/copias/restaurar", json={"copia": mala, "confirmacion": "RESTAURAR"})).status_code == 404
    assert llamadas == []
    assert (await cliente.post("/api/datos/copias/restaurar", json={"copia": copia, "confirmacion": "RESTAURAR"})).status_code == 200
    assert len(llamadas) == 1


async def test_si_la_copia_previa_falla_no_se_restaura(tmp_path, monkeypatch) -> None:
    ordenes = []

    async def volcar_falla(*a, **k):
        raise td.ErrorCopia("pg_dump falló: sin espacio")

    async def proceso(*orden, **k):
        ordenes.append(orden)
        return ""

    monkeypatch.setattr(td, "volcar", volcar_falla)
    monkeypatch.setattr(td, "_proceso", proceso)
    copia = tmp_path / "magister-2026-11-18.dump"
    copia.write_bytes(b"d")
    with pytest.raises(td.ErrorCopia, match="no he restaurado nada"):
        await td.restaurar(copia, MOMENTO, tmp_path, "magister_restaurar_prueba", "magister", "contenedor")
    assert ordenes == []


async def test_las_ordenes_de_postgres_van_por_docker_o_directas_sin_contenedor() -> None:
    assert td.orden_pg("magister-studio-db", "pg_dump", "-Fc", "m") == ["docker", "exec", "magister-studio-db", "pg_dump", "-Fc", "m"]
    assert td.orden_pg("c", "psql", "-f", "-", entrada=True) == ["docker", "exec", "-i", "c", "psql", "-f", "-"]
    assert td.orden_pg("", "pg_restore", "-f", "-", entrada=True) == ["pg_restore", "-f", "-"]


async def test_la_rotacion_deja_7_diarias_4_semanales_y_12_mensuales(tmp_path) -> None:
    from datetime import date, timedelta

    raiz = tmp_path / "copias"
    for i in range(10):
        dia = date(2026, 11, 1) + timedelta(days=i)
        _escribir(raiz / "diarias" / f"magister-{dia.isoformat()}.dump", b"d")
        _escribir(raiz / "diarias" / f"checkpoints-{dia.isoformat()}.sqlite", b"c")
    for i in range(6):
        _escribir(raiz / "semanales" / f"magister-2026-0{i + 1}-05.dump", b"s")
    lunes = date(2026, 11, 9)  # 9-11-2026 es lunes: su copia pasa también a semanales
    td.rotar(raiz, lunes)
    diarias = sorted(f.name for f in (raiz / "diarias").glob("magister-*.dump"))
    assert diarias == [f"magister-2026-11-{d:02d}.dump" for d in range(4, 11)]
    assert not (raiz / "diarias" / "checkpoints-2026-11-03.sqlite").exists()
    assert (raiz / "diarias" / "checkpoints-2026-11-04.sqlite").exists()
    semanales = sorted(f.name for f in (raiz / "semanales").glob("*.dump"))
    assert len(semanales) == 4 and semanales[-1] == "magister-2026-11-09.dump"
    assert not (raiz / "mensuales").exists()
    td.rotar(raiz, date(2026, 11, 1))  # día 1, sin copia de ese día: no se inventa nada
    assert not (raiz / "mensuales").exists()


# --- De punta a punta, contra una base temporal del contenedor hecha con una copia de la base de PRUEBAS ---

PRUEBA = "magister_restaurar_prueba"


def _hay_contenedor() -> bool:
    if not shutil.which("docker"):
        return False
    r = subprocess.run(["docker", "exec", ajustes.contenedor_db, "pg_dump", "--version"], capture_output=True)
    return r.returncode == 0


async def _titulos(dsn: str) -> list[str]:
    c = await asyncpg.connect(dsn)
    try:
        return [f["titulo"] for f in await c.fetch("select titulo from conversaciones order by id")]
    finally:
        await c.close()


@pytest.mark.skipif(not _hay_contenedor(), reason="hace falta el contenedor de la base con pg_dump")
async def test_restaurar_de_punta_a_punta_en_una_base_aparte(base, tmp_path) -> None:
    url = make_url(ajustes.db_url_pruebas)
    assert url.database not in (None, "magister") and PRUEBA != make_url(ajustes.db_url).database
    contenedor, usuario = ajustes.contenedor_db, url.username
    dsn = url.set(drivername="postgresql", database=PRUEBA).render_as_string(hide_password=False)
    raiz = tmp_path / "copias"

    async with nueva_sesion() as s, s.begin():
        from sqlalchemy import text

        await s.execute(text("insert into conversaciones (titulo, tipo) values ('antes', 'libre')"))
    copia = raiz / "diarias" / "magister-2026-11-18.dump"
    assert await td.volcar(url.database, usuario, copia, contenedor) > 0

    def docker(*orden: str) -> None:
        subprocess.run(["docker", "exec", contenedor, *orden], check=True, capture_output=True)

    docker("dropdb", "-U", usuario, "--if-exists", PRUEBA)
    docker("createdb", "-U", usuario, PRUEBA)
    try:
        await td.restaurar(copia, MOMENTO, raiz, PRUEBA, usuario, contenedor)
        assert await _titulos(dsn) == ["antes"]

        # Como la app: una conexión abierta (sin transacción a medias) no impide restaurar.
        c = await asyncpg.connect(dsn)
        await c.execute("insert into conversaciones (titulo, tipo) values ('despues', 'libre')")
        hecho = await td.restaurar(copia, MOMENTO.replace(minute=31), raiz, PRUEBA, usuario, contenedor)
        assert await c.fetchval("select count(*) from conversaciones") == 1
        await c.close()
        assert await _titulos(dsn) == ["antes"]
        # La copia previa guarda lo que había justo antes de restaurar (con «despues»), para deshacerlo.
        previa = td.copia_por_id(raiz, hecho["copia_previa"])
        await td.restaurar(previa, MOMENTO.replace(minute=32), raiz, PRUEBA, usuario, contenedor)
        assert await _titulos(dsn) == ["antes", "despues"]
        assert len([c for c in td.listar_copias(raiz) if c["carpeta"] == td.ANTES_DE_RESTAURAR]) == 3

        # Una copia que no se puede leer no toca nada.
        rota = raiz / "diarias" / "magister-2026-11-17.dump"
        rota.write_bytes(b"esto no es una copia")
        with pytest.raises(td.ErrorCopia):
            await td.restaurar(rota, MOMENTO.replace(minute=33), raiz, PRUEBA, usuario, contenedor)
        assert await _titulos(dsn) == ["antes", "despues"]
    finally:
        docker("dropdb", "-U", usuario, "--if-exists", "--force", PRUEBA)
