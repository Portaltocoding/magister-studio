"""Las comprobaciones por código del guion gráfico (evals/video.py). Sin base, red ni modelo.

    uv run pytest --noconftest tests/test_evals_video.py
"""

import copy
import json
from pathlib import Path

import pytest

from evals import video as v
from magister.material import guion_grafico as gg

FIJO = Path(__file__).parent / "fijos" / "GuionGraficoModelo.json"


def _montado() -> dict:
    with open(FIJO, encoding="utf-8") as f:
        return gg.montar(gg.GuionGraficoModelo.model_validate(json.load(f)))


def _reglas(h) -> set[str]:
    return {x.regla for x in h}


def test_el_fijo_no_tiene_errores():
    h = v.comprobar(_montado())
    assert v.errores(h) == [], [str(x) for x in h]


def test_tambien_lo_que_escribe_el_modelo_sin_montar():
    with open(FIJO, encoding="utf-8") as f:
        crudo = json.load(f)
    assert v.errores(v.comprobar(crudo)) == []


def test_trozos_como_en_tipos_ts():
    # Frases por punto seguido de mayúscula o cifra; respiros tras «,», «;» o «:» con espacio. La coma decimal no corta.
    assert v.frases("Uno. Dos y tres. 4 más.") == ["Uno.", "Dos y tres.", "4 más."]
    assert v.frases("vale 3.5 metros. y sigue") == ["vale 3.5 metros. y sigue"]
    assert v.respiros("mil, dos mil; y 121,353: fin") == ["mil,", "dos mil;", "y 121,353:", "fin"]
    assert v.trozos("Hola, mundo. Adiós.") == ["Hola,", "mundo.", "Adiós."]


def test_segundos_estimados_como_duracion_tramo():
    assert v.segundos_estimados("") == 5.0
    assert v.segundos_estimados(" ".join(["p"] * 150)) == pytest.approx(61.2)
    assert v.segundos_estimados(" ".join(["p"] * 150), ritmo=2) == pytest.approx(31.2)


def test_narracion_vacia_larga_y_con_formulas():
    g = _montado()
    g["tramos"][1]["narracion"] = "  "
    g["tramos"][2]["narracion"] = " ".join(["palabra"] * (gg.MAX_PALABRAS_TRAMO + 1))
    g["tramos"][3]["narracion"] = "Calcula $x^2$ ahora mismo con calma y sin prisa ninguna por favor."
    r = _reglas(v.errores(v.comprobar(g)))
    assert {"narracion_vacia", "narracion_larga", "formula_en_voz"} <= r


def test_duracion_total_frente_a_los_minutos():
    g = _montado()
    assert "duracion_total" in _reglas(v.comprobar(g, minutos=20))
    minutos = v.duracion_total(g) / 60
    assert "duracion_total" not in _reglas(v.comprobar(g, minutos=minutos))


def test_medidas_de_la_voz():
    g = _montado()
    buenas = [[max(0.4, v.palabras(z) / 2.5) for z in v.trozos(t["narracion"])] for t in g["tramos"]]
    assert v.comprobar_voz(g, medidas=buenas) == []
    malas = copy.deepcopy(buenas)
    malas[0] = malas[0][:-1]  # una medida de menos: la web cae a la estimación
    malas[1][0] = None  # un trozo sin audio
    malas[2] = [s / 10 for s in malas[2]]  # diez veces más deprisa
    r = _reglas(v.comprobar_voz(g, medidas=malas))
    assert {"medidas_desalineadas", "trozo_sin_audio", "ritmo_voz"} <= r
    assert "medidas_de_menos" in _reglas(v.comprobar_voz(g, medidas=buenas[:-1]))


def test_referencias_que_no_existen():
    g = _montado()
    g["tramos"][0]["escena"]["actual"] = 99
    fig = next(t["escena"] for t in g["tramos"] if t["escena"]["tipo"] == "figura")
    fig["elementos"].append({"tipo": "segmento", "de": "A", "a": "Z"})
    g["tramos"].append({"concepto": "Código", "tesis": "lo que se ve", "narracion": "Una frase con unas cuantas palabras más.",
                        "escena": {"tipo": "por_dentro", "codigo": {"fichero": "a.py", "lineas": ["x = 1"], "resaltar": [3]},
                                   "memoria": {"titulo": "m", "filas": []}, "pantalla": {"titulo": "p", "lineas": []},
                                   "flujo": []}})
    g["tramos"].append({"concepto": "Árbol", "tesis": "el camino", "narracion": "Bajamos por el árbol hasta la hoja buscada.",
                        "escena": {"tipo": "arbol", "niveles": [[["5"]], [["1"], ["7"]]], "camino": [0, 4], "hoja": "7"}})
    r = _reglas(v.errores(v.comprobar(g)))
    assert {"idea_inexistente", "punto_inexistente", "linea_inexistente", "nodo_inexistente"} <= r


def test_escenas_vacias_y_desbordadas():
    t = lambda escena, concepto="Idea": {"concepto": concepto, "tesis": "una tesis corta",  # noqa: E731
                                          "narracion": "Una narración normal con bastantes palabras para no ser corta.",
                                          "escena": escena}
    g = {"titulo": "x", "tramos": [
        t({"tipo": "tablero", "partes": [{"nombre": "A", "ideas": [{"nombre": "uno", "que": "algo"}]}], "actual": 0}),
        t({"tipo": "pregunta", "pregunta": " "}),
        t({"tipo": "tabla", "nombre": "t", "columnas": ["a", "b"], "filas": [["1"]] + [["1", "2"]] * 8}),
        t({"tipo": "consulta", "sql": ["SELECT " + "columna, " * 12 + "x FROM t"], "salida": []}),
        t({"tipo": "barras", "escala": "log", "barras": [{"etiqueta": "a", "valor": 0, "texto": "0"},
                                                         {"etiqueta": "b", "valor": 10, "texto": "10"}]}),
        t({"tipo": "formula", "formulas": [{"tex": "\\frac{a}{b"}]}),
        t({"tipo": "holograma"}),
        t({"tipo": "pasos", "pasos": [{"texto": "uno"}, {"texto": "dos"}]},
          concepto="Un concepto con un nombre larguísimo que no cabe de ninguna manera"),
    ]}
    h = v.comprobar(g)
    errores = _reglas(v.errores(h))
    assert {"pregunta_vacia", "celdas", "log_sin_positivos", "latex_roto", "escena_desconocida"} <= errores
    assert {"tabla_larga", "consulta_ancha", "sin_salida", "titulo_largo"} <= _reglas(h)


def test_llaves():
    assert v._llaves_equilibradas("\\frac{a}{b}") and v._llaves_equilibradas("\\{x\\}")
    assert not v._llaves_equilibradas("}{") and not v._llaves_equilibradas("{")


def test_main_sin_guiones(tmp_path, monkeypatch, capsys):
    from magister.config import ajustes

    monkeypatch.setattr(ajustes, "salidas", str(tmp_path))
    assert v.main([]) == 0
    ruta = tmp_path / "1-L1" / "guion_grafico-3.json"
    ruta.parent.mkdir()
    ruta.write_text(json.dumps(_montado(), ensure_ascii=False), encoding="utf-8")
    assert v.main([]) == 0
    assert "0 de 1 guiones con errores" in capsys.readouterr().out
