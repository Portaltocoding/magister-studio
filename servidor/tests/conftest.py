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
