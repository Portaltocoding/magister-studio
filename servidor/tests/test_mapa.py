from magister.material.estudio import ALTO_MAPA, ANCHO_MAPA, RelacionMapa, _ancho_nodo, colocar_mapa


def _r(de: str, a: str, etiqueta: str = "usa") -> RelacionMapa:
    return RelacionMapa(de=de, a=a, etiqueta=etiqueta)


def test_quita_repetidos_y_uniones_a_conceptos_que_no_existen():
    mapa = colocar_mapa(
        ["RAG", "Embeddings", "rag", "Base vectorial"],
        [_r("RAG", "Embeddings"), _r("rag", "embeddings"), _r("RAG", "Fantasma"), _r("Embeddings", "Embeddings"),
         _r("Embeddings", "Base vectorial", "se guardan en")],
    )
    assert [n["texto"] for n in mapa["nodos"]] == ["RAG", "Embeddings", "Base vectorial"]
    assert mapa["flechas"] == [{"de": "c0", "a": "c1", "etiqueta": "usa"}, {"de": "c1", "a": "c2", "etiqueta": "se guardan en"}]


def test_la_idea_central_arriba_y_cada_nivel_debajo():
    mapa = colocar_mapa(["Centro", "Hijo 1", "Hijo 2", "Nieto", "Suelto"],
                        [_r("Centro", "Hijo 1"), _r("Hijo 2", "Centro"), _r("Hijo 1", "Nieto")])
    y = {n["texto"]: n["y"] for n in mapa["nodos"]}
    assert y["Centro"] < y["Hijo 1"] == y["Hijo 2"] < y["Nieto"] < y["Suelto"]


def test_todo_cabe_en_el_lienzo_sin_solaparse():
    conceptos = [f"Concepto número {k}" for k in range(12)]
    mapa = colocar_mapa(conceptos, [_r(conceptos[0], c) for c in conceptos[1:]])
    nodos = mapa["nodos"]
    for n in nodos:
        assert 0 <= n["x"] and n["x"] + _ancho_nodo(n["texto"]) <= ANCHO_MAPA
        assert 0 <= n["y"] and n["y"] + 32 <= ALTO_MAPA
    for i, a in enumerate(nodos):
        for b in nodos[i + 1:]:
            if a["y"] == b["y"]:
                izq, der = sorted((a, b), key=lambda n: n["x"])
                assert izq["x"] + _ancho_nodo(izq["texto"]) <= der["x"]
