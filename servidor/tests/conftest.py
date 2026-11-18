import httpx
import pytest
from sqlalchemy import text

from magister.api.app import app
from magister.config import ajustes
from magister.datos import sesion
from magister.datos.tablas import Base


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# Una tanda de tests a la vez sobre la base de pruebas. Cada test la vacía (TRUNCATE): si dos sesiones lanzan pytest
# a la vez, una borra los datos de la otra a mitad y salen fallos falsos (claves ajenas, interbloqueos). Un candado de
# Postgres que dura toda la tanda hace que la segunda espere a la primera. Y, ya con el candado, la base de pruebas se
# pone al día con las migraciones, para que una tabla o columna nueva no rompa los tests hasta migrarla a mano.
CANDADO_PRUEBAS = 7_311_208_401  # cualquier número fijo: el mismo en todas las tandas
ESPERA_MAXIMA = "20min"


@pytest.fixture(scope="session", autouse=True)
def una_tanda_a_la_vez(request):
    import asyncio
    import time
    from argparse import Namespace
    from pathlib import Path

    import asyncpg
    from alembic import command
    from alembic.config import Config

    dsn = ajustes.db_url_pruebas.replace("postgresql+asyncpg://", "postgresql://")
    bucle = asyncio.new_event_loop()
    conexion = bucle.run_until_complete(asyncpg.connect(dsn))
    try:
        if not bucle.run_until_complete(conexion.fetchval("select pg_try_advisory_lock($1)", CANDADO_PRUEBAS)):
            pantalla = request.config.pluginmanager.get_plugin("terminalreporter")
            if pantalla:
                pantalla.write_line("Otra tanda de tests está usando la base de pruebas: espero a que acabe…", yellow=True)
            inicio = time.monotonic()
            bucle.run_until_complete(conexion.execute(f"set lock_timeout = '{ESPERA_MAXIMA}'"))
            bucle.run_until_complete(conexion.execute("select pg_advisory_lock($1)", CANDADO_PRUEBAS))
            if pantalla:
                pantalla.write_line(f"Ya está libre (esperé {time.monotonic() - inicio:.0f} s).", green=True)
        # Sin fichero de configuración: así alembic no reconfigura los registros (logging) de pytest.
        cfg = Config()
        cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "migraciones"))
        cfg.cmd_opts = Namespace(x=["db=pruebas"])
        command.upgrade(cfg, "head")
        yield
    finally:
        try:
            bucle.run_until_complete(conexion.execute("select pg_advisory_unlock_all()"))
        finally:
            bucle.run_until_complete(conexion.close())
            bucle.close()


@pytest.fixture(autouse=True)
def sin_token(monkeypatch) -> None:
    # servidor/.env puede traer MAGISTER_TOKEN; los tests llaman a la API sin proxy.
    # El que necesite token lo pone con la fixture con_token.
    monkeypatch.setattr(ajustes, "token", "")


@pytest.fixture(autouse=True)
def sin_modelos_locales(monkeypatch, tmp_path) -> None:
    # Embeddings por hash y crudo en una carpeta temporal: las pruebas no cargan modelos.
    monkeypatch.setattr(ajustes, "embeddings", "falso")
    monkeypatch.setattr(ajustes, "crudo", str(tmp_path / "crudo"))
    # Las salidas (PDF, diapositivas, guiones) también en una carpeta temporal: los ids de la base de pruebas
    # coinciden con los de la real, y borrar «el plan 1» de prueba no puede tocar tus ficheros.
    monkeypatch.setattr(ajustes, "salidas", str(tmp_path / "salidas"))


@pytest.fixture(autouse=True)
def motor_eco(monkeypatch) -> None:
    # Ningún test gasta cuota: el motor se fuerza aquí, no por variable de entorno,
    # porque `ajustes` se crea al importar el paquete.
    monkeypatch.setattr(ajustes, "motor", "eco")


@pytest.fixture
async def base():
    """La base de pruebas (MAGISTER_DB_URL_PRUEBAS), vacía en cada test."""
    sesion.configurar(ajustes.db_url_pruebas)
    # configuraciones guarda la fila v1 de la migración: no se vacía.
    tablas = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables) if t.name != "configuraciones")
    async with sesion.motor().begin() as c:
        await c.execute(text(f"TRUNCATE {tablas} RESTART IDENTITY CASCADE"))
    yield sesion
    await sesion.cerrar()


@pytest.fixture
async def cliente(base):
    from magister.cerebro.estructura import eco
    from magister.flujo.grafo import iniciar

    iniciar(None)  # un grafo con InMemorySaver nuevo: los ids se reinician en cada test
    eco.vaciar()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://prueba") as c:
        yield c


@pytest.fixture(autouse=True)
def freno_limpio():
    # El freno de llamadas cuenta en memoria: cada test empieza con los contadores a cero.
    from magister.cerebro import freno

    freno.reiniciar()
    yield
    freno.reiniciar()
