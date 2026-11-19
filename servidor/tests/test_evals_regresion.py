"""Regresión de prompts (evals/regresion.py) y la estadística nueva de comparar ejecuciones. Sin base, red ni modelo.

    uv run pytest --noconftest tests/test_evals_regresion.py
"""

from datetime import datetime, timezone

import pytest

from evals import estadistica as est
from evals import regresion as rg
from evals.tope import Tope


def test_newcombe_ejemplo_del_articulo():
    # Newcombe (1998), ejemplo: 56/70 frente a 48/80 → 0,200 [0,0524, 0,3339].
    d, lo, hi = est.newcombe(48, 80, 56, 70)
    assert d == pytest.approx(0.2)
    assert lo == pytest.approx(0.0524, abs=5e-4)
    assert hi == pytest.approx(0.3339, abs=5e-4)


def test_newcombe_sin_casos():
    with pytest.raises(ValueError):
        est.newcombe(0, 0, 1, 2)


def test_bootstrap_diferencia():
    d, lo, hi = est.bootstrap_diferencia([1.0, 1.0, 1.0], [2.0, 2.0, 2.0], 500)
    assert (d, lo, hi) == (1.0, 1.0, 1.0)
    d, lo, hi = est.bootstrap_diferencia([0.0, 1.0, 0.0, 1.0], [1.0, 1.0, 0.0, 1.0], 2000)
    assert d == pytest.approx(0.25) and lo < d < hi
    with pytest.raises(ValueError):
        est.bootstrap_diferencia([], [1.0])


def test_binomial_dos_colas():
    assert est.binomial_dos_colas(0, 0) == 1.0
    assert est.binomial_dos_colas(5, 5) == 1.0
    assert est.binomial_dos_colas(8, 0) == pytest.approx(2 / 256)


def _ej(metricas, prompts=None, nivel="corto", momento="2026-11-19T10:00:00+00:00", **kw):
    e = rg.ejecucion("demo", nivel, prompts or {"p": "aaaaaaaaaaaa"}, metricas, Tope(10, nivel, hechas=3),
                     banco="b1", momento=datetime.fromisoformat(momento))
    return {**e, **kw}


def test_proporcion_valida():
    with pytest.raises(ValueError):
        rg.proporcion({"x": (3, 2)})


def test_resumir_proporcion_y_media():
    r = rg.resumir(rg.proporcion({"a": (1, 2), "b": (2, 2)}))
    assert (r["k"], r["n"]) == (3, 4) and r["valor"] == pytest.approx(0.75)
    assert r["ic"] == pytest.approx(est.margen_wilson(3, 4)[1:])
    r = rg.resumir(rg.media({"a": 2.0}))
    assert r == {"valor": 2.0, "ic": (2.0, 2.0), "n": 1}


def test_comparar_dice_que_prompts_cambian_y_avisa():
    a = _ej({"m": rg.proporcion({"x": (1, 1)})}, {"p": "aaaaaaaaaaaa", "q": "111111111111"})
    b = _ej({"m": rg.proporcion({"y": (1, 1)})}, {"p": "bbbbbbbbbbbb", "r": "222222222222"}, nivel="completo",
            momento="2026-11-20T10:00:00+00:00", cortado=True)
    c = rg.comparar(a, b)
    assert c["prompts"]["cambiados"] == [("p", "aaaaaaaaaaaa", "bbbbbbbbbbbb")]
    assert c["prompts"]["nuevos"] == [("r", "222222222222")]
    assert c["prompts"]["quitados"] == [("q", "111111111111")]
    assert any("nivel" in x for x in c["avisos"]) and any("tope" in x for x in c["avisos"])
    assert c["metricas"]["m"]["metodo"].startswith("independientes (Newcombe)")


def test_comparar_pareado_binario_con_mcnemar():
    casos = [f"c{i}" for i in range(10)]
    a = _ej({"ok": rg.proporcion({c: (0, 1) for c in casos})})
    b = _ej({"ok": rg.proporcion({c: (1, 1) for c in casos})})
    m = rg.comparar(a, b)["metricas"]["ok"]
    assert m["metodo"].startswith("pareado")
    assert m["discordantes"] == (10, 0)
    assert m["p_mcnemar"] == pytest.approx(2 / 1024)
    assert m["dif"] == pytest.approx(1.0) and m["veredicto"] == "mejora"


def test_mejor_bajo_invierte_el_veredicto():
    casos = [f"c{i}" for i in range(8)]
    a = _ej({"caros": rg.proporcion({c: (0, 1) for c in casos}, mejor="bajo")})
    b = _ej({"caros": rg.proporcion({c: (1, 1) for c in casos}, mejor="bajo")})
    assert rg.comparar(a, b)["metricas"]["caros"]["veredicto"] == "empeora"


def test_sin_cambio_claro_si_el_intervalo_cruza_cero():
    a = _ej({"m": rg.media({"a": 1.0, "b": 2.0, "c": 3.0})})
    b = _ej({"m": rg.media({"a": 2.0, "b": 1.0, "c": 3.0})})
    m = rg.comparar(a, b)["metricas"]["m"]
    assert m["veredicto"] == "sin cambio claro" and m["pares"] == 3


def test_no_compara_evals_distintas():
    a = _ej({})
    with pytest.raises(ValueError):
        rg.comparar(a, {**a, "eval": "otra"})


def test_guardar_leer_y_las_ultimas(tmp_path):
    viejo = _ej({"m": rg.media({"a": 1.0})}, momento="2026-11-19T10:00:00+00:00")
    nuevo = _ej({"m": rg.media({"a": 2.0})}, momento="2026-11-20T09:00:00+00:00")
    rn = rg.guardar(nuevo, tmp_path)
    rv = rg.guardar(viejo, tmp_path)
    assert rg.ejecuciones("demo", tmp_path) == [rv, rn]
    assert rg.leer(rn)["llamadas"] == 3 and rg.leer(rn)["tope"] == 10
    texto = rg.informe(rg.comparar(viejo, nuevo), viejo, nuevo)
    assert "Ningún prompt cambia" in texto and "m" in texto


def test_versiones_son_las_del_fichero():
    from magister.cerebro import prompts

    v = rg.versiones(["cuando_research", "research_juez"])
    assert v == {n: prompts._del_fichero(n).version for n in ("cuando_research", "research_juez")}
    assert all(len(x) == 12 for x in v.values())


def test_main_comparar_sin_dos_ejecuciones(capsys):
    assert rg.main(["comparar", "--eval", "no-existe-nunca"]) == 2


def test_momento_por_defecto_en_utc():
    e = rg.ejecucion("demo", "corto", {}, {})
    assert datetime.fromisoformat(e["momento"]).tzinfo == timezone.utc
