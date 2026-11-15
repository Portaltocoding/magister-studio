from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_archivo_env = Path(__file__).resolve().parents[2] / ".env"


class Ajustes(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MAGISTER_",
        env_file=_archivo_env,
        env_file_encoding="utf-8",
    )

    motor: str = "cli"
    timeout_s: int = 180
    modelo: str = "sonnet"
    token: str = ""


ajustes = Ajustes()
