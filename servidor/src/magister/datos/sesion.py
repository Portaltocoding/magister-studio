"""El motor de Postgres (asyncpg) y una sesión por petición."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from magister.config import ajustes

_motor: AsyncEngine | None = None
_fabrica: async_sessionmaker[AsyncSession] | None = None


def configurar(url: str | None = None) -> None:
    """Crea el motor. Los tests lo llaman con la base de pruebas."""
    global _motor, _fabrica
    _motor = create_async_engine(url or ajustes.db_url, pool_pre_ping=True)
    _fabrica = async_sessionmaker(_motor, expire_on_commit=False)


def motor() -> AsyncEngine:
    if _motor is None:
        configurar()
    assert _motor is not None
    return _motor


def nueva_sesion() -> AsyncSession:
    if _fabrica is None:
        configurar()
    assert _fabrica is not None
    return _fabrica()


async def cerrar() -> None:
    global _motor, _fabrica
    if _motor is not None:
        await _motor.dispose()
    _motor = _fabrica = None


async def sesion_por_peticion() -> AsyncIterator[AsyncSession]:
    """Dependencia de FastAPI: una sesión por petición, cerrada al acabar."""
    async with nueva_sesion() as s:
        yield s
