"""La eval de recuperación: lo que juzga y resume es código puro, así que se prueba sin modelos ni base."""

from evals import recuperacion as rc


def test_la_seccion_de_un_fragmento_es_el_ultimo_encabezado_anterior() -> None:
    texto = "# Delusion\nintro\n## 4.2 Are delusions beliefs?\ncuerpo\n## Bibliography\nrefs"
    assert rc.seccion_de(texto, texto.index("cuerpo")) == "4.2 Are delusions beliefs?"
    assert rc.seccion_de(texto, 2) == "Delusion" and rc.seccion_de("sin encabezados", 5) == ""


def test_juzgar_una_pregunta_con_respuesta_y_una_de_otro_tema() -> None:
    caso = {"pregunta": "¿…?", "documento": "Delusion", "seccion": "Are delusions beliefs"}
    bien = [{"titulo": "Otro", "seccion": ""}, {"titulo": "Delusion", "seccion": "4.2 Are delusions beliefs?"}]
    assert rc.juzgar(caso, bien, True) == {"tipo": "propia", "bien": True, "con_fuentes": True, "documento": True, "seccion": True}
    # Lo encuentra pero el sistema dice «sin fuentes»: no vale.
    assert rc.juzgar(caso, bien, False)["bien"] is False
    # El documento sale, la sección no.
    otra = [{"titulo": "Delusion", "seccion": "2.1 Defining delusion"}]
    assert rc.juzgar(caso, otra, True) == {"tipo": "propia", "bien": True, "con_fuentes": True, "documento": True, "seccion": False}
    assert rc.juzgar({"pregunta": "¿…?", "sin_fuentes": True}, bien, True) == {"tipo": "ajena", "bien": False}


def test_el_resumen_y_los_minimos() -> None:
    propia = lambda ok, esc: {"tipo": "propia", "bien": ok, "con_fuentes": ok, "documento": ok, "seccion": ok, "escalon": esc, "ms": 100.0}  # noqa: E731
    ajena = lambda ok: {"tipo": "ajena", "bien": ok, "escalon": "nada", "ms": 50.0}  # noqa: E731
    r = rc.resumen([propia(True, "densa"), propia(True, "reranker"), propia(False, "nada"), ajena(True), ajena(False)])
    assert r["con_fuentes"] == 0.667 and r["falsas"] == 0.5
    assert r["escalones"] == {"densa": 1, "reranker": 1, "nada": 1}
    fallos = " ".join(rc.cumple(r))
    assert "encuentra fuentes" in fallos and "otros temas" in fallos
    assert rc.cumple(rc.resumen([propia(True, "densa")] * 9 + [propia(False, "nada")] + [ajena(True)] * 5)) == []


def test_el_banco_de_preguntas_esta_bien_formado() -> None:
    import yaml

    banco = yaml.safe_load(rc.BANCO.read_text(encoding="utf-8"))["preguntas"]
    assert len(banco) >= 15 and sum(1 for c in banco if c.get("sin_fuentes")) >= 4
    assert all(c.get("sin_fuentes") or c.get("documento") for c in banco)
