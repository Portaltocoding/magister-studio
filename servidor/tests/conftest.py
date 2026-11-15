import pytest

from magister.config import ajustes


@pytest.fixture(autouse=True)
def sin_token(monkeypatch) -> None:
    # servidor/.env puede traer MAGISTER_TOKEN; los tests llaman a la API sin proxy.
    # El que necesite token lo pone con la fixture con_token.
    monkeypatch.setattr(ajustes, "token", "")
