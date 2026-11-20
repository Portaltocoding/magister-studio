"""El idioma de toda la app (el de las preferencias del tutor): material, voces y avisos de la bienvenida. Sin base ni red."""

from pathlib import Path

from magister.api.rutas_bienvenida import EN
from magister.material.preferencias import IDIOMA_INGLES, texto, texto_preguntas
from magister.voz import piper


def test_el_material_sale_en_ingles_si_se_elige_y_en_espanol_no_dice_nada() -> None:
    assert IDIOMA_INGLES in texto({"idioma": "en"})
    assert IDIOMA_INGLES in texto_preguntas({"idioma": "en"})
    assert IDIOMA_INGLES not in texto({}) and IDIOMA_INGLES not in texto({"idioma": "es"})
    assert IDIOMA_INGLES not in texto_preguntas({"idioma": "es"})


def test_las_voces_dicen_su_idioma_y_solo_salen_las_instaladas(tmp_path: Path, monkeypatch) -> None:
    ejecutable = tmp_path / "piper.exe"
    ejecutable.write_bytes(b"")
    (tmp_path / "es_ES-davefx-medium.onnx").write_bytes(b"")
    monkeypatch.setattr(piper.ajustes, "voz_piper", str(ejecutable))
    monkeypatch.setattr(piper.ajustes, "voz_dir", str(tmp_path))
    assert [(v.id, v.idioma) for v in piper.disponibles()] == [("davefx", "es")]
    (tmp_path / "en_US-amy-medium.onnx").write_bytes(b"")
    assert [(v.id, v.idioma) for v in piper.disponibles()] == [("davefx", "es"), ("amy", "en")]


def test_los_avisos_de_la_cuenta_tienen_version_en_ingles() -> None:
    from magister.cerebro import cuenta

    # Los mensajes que el alta puede dar existen también en inglés, sin jerga (la pantalla reconoce el de «sin pty»).
    assert any("you signed in with" in v for v in EN.values())
    assert not any("docker" in v.lower() for v in EN.values())
    assert all(v.strip() for v in EN.values())
    assert cuenta.MENSAJE_CUENTA  # el que reconoce la pantalla en español sigue ahí


def test_puede_conectar_solo_con_pty_y_claude(monkeypatch) -> None:
    import builtins
    import sys
    import types

    from magister.cerebro import cuenta

    monkeypatch.setitem(sys.modules, "pty", types.ModuleType("pty"))
    monkeypatch.setattr(cuenta.shutil, "which", lambda _: "/usr/bin/claude")
    assert cuenta.puede_conectar() is True
    monkeypatch.setattr(cuenta.shutil, "which", lambda _: None)
    assert cuenta.puede_conectar() is False  # sin el programa
    monkeypatch.setattr(cuenta.shutil, "which", lambda _: "/usr/bin/claude")
    original = builtins.__import__

    def sin_pty(nombre, *a, **k):
        if nombre == "pty":
            raise ImportError("sin pty")
        return original(nombre, *a, **k)

    monkeypatch.setattr(builtins, "__import__", sin_pty)
    assert cuenta.puede_conectar() is False  # Windows


def test_el_plan_se_pide_en_ingles_solo_si_el_alumno_lo_ha_elegido() -> None:
    from magister.flujo.comun import IDIOMA_INGLES_PLAN, con_idioma

    assert con_idioma("prompt", {"idioma": "en"}).endswith(IDIOMA_INGLES_PLAN)
    assert con_idioma("prompt", {"idioma": "es"}) == "prompt"
    assert con_idioma("prompt", {}) == "prompt"
