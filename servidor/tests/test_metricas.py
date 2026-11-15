from evals.metricas import media_y_error, ndcg_en, pasaje_en, rango_reciproco, recall_en


def test_recall_y_mrr_ejemplo_de_cinco_consultas() -> None:
    # Cinco consultas con un relevante cada una, en los rangos 1, 3, fuera, 2 y 5.
    consultas = [([7, 1, 2], 7), ([1, 2, 7], 7), ([1, 2, 3, 4, 5, 6], 7), ([1, 7], 7), ([1, 2, 3, 4, 7], 7)]
    recall5 = sum(recall_en(r, {b}, 5) for r, b in consultas) / 5
    mrr = sum(rango_reciproco(r, {b}) for r, b in consultas) / 5
    assert recall5 == 0.8
    assert round(mrr, 2) == 0.41  # (1 + 1/3 + 0 + 1/2 + 1/5) / 5


def test_ndcg_y_pasaje() -> None:
    assert ndcg_en([7, 1], {7}) == 1.0
    assert 0 < ndcg_en([1, 7], {7}) < 1
    assert pasaje_en([(1, 0, 50), (2, 100, 200)], (2, 150, 160)) == 1.0
    assert pasaje_en([(2, 0, 100)], (2, 150, 160)) == 0.0


def test_media_y_error() -> None:
    m, e = media_y_error([1, 0, 1, 1])
    assert m == 0.75 and round(e, 3) == 0.25
