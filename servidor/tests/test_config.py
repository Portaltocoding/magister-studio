from magister.config import Ajustes


def test_ajustes_por_defecto(monkeypatch) -> None:
    for v in ("MAGISTER_MOTOR", "MAGISTER_TIMEOUT_S", "MAGISTER_MODELO"):
        monkeypatch.delenv(v, raising=False)
    ajustes = Ajustes(_env_file=None)

    assert ajustes.motor == "cli"
    assert ajustes.timeout_s == 180
    assert ajustes.modelo == "sonnet"


def test_ajustes_desde_variables_de_entorno(monkeypatch) -> None:
    monkeypatch.setenv("MAGISTER_MOTOR", "eco")
    monkeypatch.setenv("MAGISTER_TIMEOUT_S", "30")
    monkeypatch.setenv("MAGISTER_MODELO", "opus")

    ajustes = Ajustes(_env_file=None)

    assert ajustes.motor == "eco"
    assert ajustes.timeout_s == 30
    assert ajustes.modelo == "opus"
