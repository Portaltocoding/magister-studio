import pytest

from magister.cerebro import prompts


def test_incluir_mete_el_trozo_comun(tmp_path, monkeypatch):
    (tmp_path / "nucleo.md").write_text("Explica con un ejemplo.\n", encoding="utf-8")
    monkeypatch.setattr(prompts, "COMUN", tmp_path)
    assert prompts._expandir("Antes\n@incluir nucleo\nDespués {hueco}") == "Antes\nExplica con un ejemplo.\nDespués {hueco}"


def test_incluir_un_trozo_que_no_existe_falla(tmp_path, monkeypatch):
    monkeypatch.setattr(prompts, "COMUN", tmp_path)
    with pytest.raises(prompts.ErrorPlantilla):
        prompts._expandir("@incluir nada")


def test_incluir_solo_cuenta_en_su_propia_linea(tmp_path, monkeypatch):
    monkeypatch.setattr(prompts, "COMUN", tmp_path)
    assert prompts._expandir("di «@incluir x» tal cual") == "di «@incluir x» tal cual"


def test_un_trozo_puede_incluir_otro(tmp_path, monkeypatch):
    (tmp_path / "dentro.md").write_text("núcleo", encoding="utf-8")
    (tmp_path / "fuera.md").write_text("antes\n@incluir dentro\ndespués", encoding="utf-8")
    monkeypatch.setattr(prompts, "COMUN", tmp_path)
    assert prompts._expandir("@incluir fuera") == "antes\nnúcleo\ndespués"


def test_un_trozo_que_se_incluye_a_si_mismo_falla(tmp_path, monkeypatch):
    (tmp_path / "bucle.md").write_text("@incluir bucle", encoding="utf-8")
    monkeypatch.setattr(prompts, "COMUN", tmp_path)
    with pytest.raises(prompts.ErrorPlantilla):
        prompts._expandir("@incluir bucle")


def test_los_prompts_que_explican_llevan_el_nucleo_expandido():
    for nombre in ("responder", "conversar", "apuntes_bloque", "guion"):
        p = prompts._del_fichero(nombre)
        assert "@incluir" not in p.texto
        assert "problema, intento ingenuo" in p.texto


def test_ningun_trozo_comun_tiene_llaves():
    # Las llaves sueltas romperían `rellenar` (str.format) en cada plantilla que lo incluya.
    for f in prompts.COMUN.glob("*.md"):
        assert "{" not in f.read_text(encoding="utf-8") and "}" not in f.read_text(encoding="utf-8"), f.name


def test_todas_las_plantillas_cargan():
    assert all(p.version and "@incluir" not in p.texto for p in prompts.ficheros())


def test_incluir_funciona_con_finales_de_linea_de_windows(tmp_path, monkeypatch):
    (tmp_path / "nucleo.md").write_text("Explica con un ejemplo.", encoding="utf-8")
    monkeypatch.setattr(prompts, "COMUN", tmp_path)
    assert prompts._expandir("Antes\r\n@incluir nucleo\r\nDespués".replace("\r\n", "\n")) == "Antes\nExplica con un ejemplo.\nDespués"
    assert prompts._expandir("@incluir nucleo\r") == "Explica con un ejemplo."
