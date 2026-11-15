from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_archivo_env = Path(__file__).resolve().parents[2] / ".env"
RAIZ_SERVIDOR = Path(__file__).resolve().parents[2]


class Ajustes(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MAGISTER_",
        env_file=_archivo_env,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Modelo
    motor: str = "cli"
    timeout_s: int = 180
    modelo: str = "sonnet"

    # Seguridad mínima
    token: str = ""

    # Bases de datos
    db_url: str = "postgresql+asyncpg://magister:magister@127.0.0.1:5433/magister"
    db_url_pruebas: str = "postgresql+asyncpg://magister:magister@127.0.0.1:5433/magister_pruebas"
    db_url_sim: str = "postgresql+asyncpg://magister:magister@127.0.0.1:5433/magister_sim"

    # LangGraph (conversación de diagnóstico)
    checkpoints: str = str(RAIZ_SERVIDOR / "checkpoints.sqlite")

    # Plan (Parte II)
    reintentos: int = 2  # reintentos dentro de estructurar (3 intentos)
    holgura: float = 0.15  # criterio general
    horas_max_leccion: float = 4.0  # criterio general
    partir_lecciones: bool = True  # una lección puede ocupar varios días


ajustes = Ajustes()
