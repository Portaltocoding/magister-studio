"""La eval de cuándo buscar fuentes (evals/cuando_research.py), sin modelo: el banco, el recuento y el seguro de --gastar."""

import pytest

from evals import cuando_research as cr
from magister.plan.esquemas import NECESIDADES


def test_el_banco_tiene_unas_30_lecciones_de_los_tres_valores() -> None:
    casos = cr.cargar_banco()
    assert 25 <= len(casos) <= 40 and len({c["id"] for c in casos}) == len(casos)
    assert {c["espera"] for c in casos} == set(NECESIDADES)
    assert all(c["objetivos"] and c["titulo"] and c["tema"] and c["porque"] for c in casos)


def test_recuento_aparta_los_fallos_caros() -> None:
    casos = [{"id": "a", "espera": "no"}, {"id": "b", "espera": "conviene"}, {"id": "c", "espera": "imprescindible"},
             {"id": "d", "espera": "imprescindible"}, {"id": "e", "espera": "no"}]
    r = cr.recuento(casos, {"a": "no", "b": "conviene", "c": "no", "d": None, "e": "imprescindible"})
    assert r["n"] == 5 and r["aciertos"] == 2 and r["tasa"] == 0.4
    assert r["caros"] == ["c"] and r["de_mas"] == ["e"] and r["sin_respuesta"] == ["d"]
    # Filas: esperada; columnas: dicha (no, conviene, imprescindible). La que no respondió no entra en la tabla.
    assert r["tabla"] == [[1, 0, 1], [0, 1, 0], [1, 0, 0]]
    lo, hi = r["ic"]
    assert lo < 0.4 < hi
    todo_bien = cr.recuento(casos, {c["id"]: c["espera"] for c in casos})
    assert todo_bien["aciertos"] == 5 and todo_bien["caros"] == [] and todo_bien["kappa"] == 1.0


def test_lotes_y_llamadas_previstas() -> None:
    assert cr.llamadas_previstas(30, 10) == 3 and cr.llamadas_previstas(31, 10) == 4 and cr.llamadas_previstas(0) == 0
    assert [len(x) for x in cr.lotes(list(range(23)), 10)] == [10, 10, 3]


def test_las_reglas_piden_una_entrada_por_leccion() -> None:
    def salida(numeros: list[int]) -> cr.Etiquetas:
        return cr.Etiquetas(etiquetas=[cr.EtiquetaLeccion(n=n, necesita_fuentes="no", fuentes_por_que="Porque sí.")
                                       for n in numeros])

    reglas = cr.reglas_de(3)
    assert reglas(salida([1, 2, 3])) == [] and reglas(salida([3, 1, 2])) == []
    assert reglas(salida([1, 2])) and reglas(salida([1, 1, 2])) and reglas(salida([1, 2, 3, 4]))


def test_la_entrada_numera_cada_leccion() -> None:
    texto = cr.entrada_de([{"tema": "T", "titulo": "Uno", "objetivos": ["a", "b"]}, {"tema": "T", "titulo": "Dos", "objetivos": ["c"]}])
    assert texto.startswith("1. Tema: T\n   Título: Uno") and "\n\n2. Tema: T\n   Título: Dos" in texto and "   - b" in texto


def test_sin_gastar_no_llama_al_modelo(monkeypatch, capsys) -> None:
    from magister.cerebro import estructura

    async def no_llames(*a, **k):
        raise AssertionError("no debía llamar al modelo")

    monkeypatch.setattr(estructura, "estructurar", no_llames)
    assert cr.main([]) == 2
    salida = capsys.readouterr().out
    assert "3 llamadas al modelo" in salida and "--gastar" in salida


@pytest.mark.anyio
async def test_etiquetar_con_el_motor_eco(monkeypatch) -> None:
    from magister.cerebro.estructura import eco

    casos = [{"id": "x", "tema": "T", "titulo": "Uno", "objetivos": ["a"]},
             {"id": "y", "tema": "T", "titulo": "Dos", "objetivos": ["b"]}]
    eco.vaciar()
    eco.encolar(cr.Etiquetas, [{"etiquetas": [{"n": 2, "necesita_fuentes": "imprescindible", "fuentes_por_que": "Caduca."},
                                              {"n": 1, "necesita_fuentes": "no", "fuentes_por_que": "Es básico."}]}])
    assert await cr.etiquetar(casos) == {"x": "no", "y": "imprescindible"}
    eco.vaciar()
