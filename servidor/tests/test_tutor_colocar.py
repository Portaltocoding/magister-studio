"""El modo foco: cada comprobación pregunta por una idea de SU bloque (`colocar_preguntas`, sin base)."""

from magister.api.rutas_tutor import colocar_preguntas

BLOQUES = [
    {"clave": "b1", "conceptos": ["c-a", "c-b"]},
    {"clave": "b2", "conceptos": ["c-c"]},
    {"clave": "b3", "conceptos": ["c-b", "c-d", "c-e"]},
]


def test_se_queda_en_su_donde_si_su_concepto_esta_alli() -> None:
    r = colocar_preguntas([("p1", "b1", "¿A?", "c-a")], BLOQUES)
    assert r == {"b1": {"pregunta_id": "p1", "enunciado": "¿A?", "concepto_id": "c-a"}}


def test_va_al_bloque_de_su_concepto_si_donde_no_lo_tiene() -> None:
    """Antes la pregunta sobre c-c caía en b1 (su `donde`) y b1 preguntaba por una idea de b2."""
    r = colocar_preguntas([("p1", "b1", "¿C?", "c-c"), ("p2", "b1", "¿A?", "c-a")], BLOQUES)
    assert r["b2"]["pregunta_id"] == "p1"
    assert r["b1"]["pregunta_id"] == "p2"


def test_concepto_en_varios_bloques_gana_el_de_menos_conceptos() -> None:
    # c-b está en b1 (2 conceptos) y en b3 (3): con un `donde` que no lo tiene, va a b1.
    r = colocar_preguntas([("p1", "b2", "¿B?", "c-b")], BLOQUES)
    assert list(r) == ["b1"]
    # Con `donde` = b3, que sí lo tiene, se respeta el `donde`.
    assert list(colocar_preguntas([("p1", "b3", "¿B?", "c-b")], BLOQUES)) == ["b3"]


def test_a_igualdad_de_tamano_gana_el_primero() -> None:
    bloques = [{"clave": "b1", "conceptos": ["c-x"]}, {"clave": "b2", "conceptos": ["c-x"]}]
    assert list(colocar_preguntas([("p1", None, "¿X?", "c-x")], bloques)) == ["b1"]


def test_en_cada_bloque_gana_la_primera_y_cada_pregunta_ocupa_uno() -> None:
    # p1 tiene dos conceptos (dos filas): ocupa solo b1, con el concepto que está en b1.
    filas = [("p1", "b1", "¿AC?", "c-c"), ("p1", "b1", "¿AC?", "c-a"), ("p2", "b1", "¿A otra vez?", "c-a"),
             ("p3", "b2", "¿C?", "c-c")]
    r = colocar_preguntas(filas, BLOQUES)
    assert r["b1"] == {"pregunta_id": "p1", "enunciado": "¿AC?", "concepto_id": "c-a"}
    assert r["b2"]["pregunta_id"] == "p3"
    assert "b3" not in r


def test_sin_contrato_se_queda_en_su_donde() -> None:
    r = colocar_preguntas([("p1", "b2", "¿?", "c-z"), ("p2", None, "¿?", "c-y")], [])
    assert r["b2"]["concepto_id"] == "c-z"
    assert r[""]["pregunta_id"] == "p2"
