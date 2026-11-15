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
def motor_eco(monkeypatch) -> None:
    # Ningún test gasta cuota: el motor se fuerza aquí, no por variable de entorno,
    # porque `ajustes` se crea al importar el paquete.
    monkeypatch.setattr(ajustes, "motor", "eco")


@pytest.fixture
async def base():
    """La base de pruebas (MAGISTER_DB_URL_PRUEBAS), vacía en cada test."""
    sesion.configurar(ajustes.db_url_pruebas)
    tablas = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    async with sesion.motor().begin() as c:
        await c.execute(text(f"TRUNCATE {tablas} RESTART IDENTITY CASCADE"))
    yield sesion
    await sesion.cerrar()


@pytest.fixture
async def cliente(base):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://prueba") as c:
        yield c
