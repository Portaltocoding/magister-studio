import pytest
from sqlalchemy import text

from magister.datos import sesion
from magister.observar import mapa_modelos as mm


pytestmark = pytest.mark.anyio


def fila(**kw) -> dict:
    base = dict(funcion="generar", prompt_nombre="apuntes_bloque", modelo_pedido="sonnet", modelo_respondido="claude-sonnet-x",
                tokens_entrada=100, tokens_salida=50, tokens_cache_lectura=0, tokens_cache_escritura=0, coste_equivalente=0.1,
                ttft_ms=1000, total_ms=5000, reintentos=0, respaldo=False, error=None, tono_juez=None, feedback_usuario=None)
    return base | kw


def _t(**kw) -> dict:
    return mm.construir([fila(**kw) for _ in range(12)], 30)


def test_percentil() -> None:
    assert mm.percentil([], 0.5) is None
    assert mm.percentil([1, 2, 3, 4, 5], 0.5) == 3
    assert mm.percentil([0, 10], 0.95) == pytest.approx(9.5)


def test_resumen() -> None:
    r = mm.resumen([fila(tokens_entrada=100, tokens_cache_lectura=300, error="x", tono_juez=1.0),
                    fila(tokens_entrada=400, reintentos=2, tono_juez=0.0, feedback_usuario=1.0)])
    assert r["llamadas"] == 2 and r["coste_total"] == 0.2 and r["coste_medio"] == 0.1
    assert r["tokens_entrada_medios"] == 400 and r["cache_leida"] == pytest.approx(300 / 800, abs=1e-3)
    assert r["tasa_error"] == 0.5 and r["reintentos_medios"] == 1
    assert r["calidad"]["tono_juez"] == 0.5 and r["calidad"]["n_feedback_usuario"] == 1


def test_construir_agrupa_por_tarea_y_plantilla() -> None:
    m = mm.construir([fila(), fila(prompt_nombre="juez_tono", funcion="juez", modelo_pedido="haiku")], 30)
    tareas = {t["tarea"]: t for t in m["tareas"]}
    assert tareas["generar"]["llamadas"] == 1 and tareas["juez"]["llamadas"] == 1 and tareas["explicar"]["llamadas"] == 0
    assert {p["plantilla"] for p in m["plantillas"]} == {"apuntes_bloque", "juez_tono"}
    assert tareas["extraer"]["modelo_configurado"] == "haiku"


def test_recomienda_cache_con_prompt_grande() -> None:
    r = [x for x in _t(tokens_entrada=9000)["recomendaciones"] if x["tipo"] == "cache"]
    assert r and "9000" in r[0]["numero"] and r[0]["objeto"] == "apuntes_bloque"
    assert not [x for x in _t(tokens_entrada=1000)["recomendaciones"] if x["tipo"] == "cache"]
    assert not [x for x in _t(tokens_entrada=1000, tokens_cache_lectura=9000)["recomendaciones"] if x["tipo"] == "cache"]


def test_recomienda_haiku_en_tarea_de_fondo_con_calidad_alta(monkeypatch) -> None:
    monkeypatch.setattr(mm, "modelo_configurado", lambda t: "sonnet")
    assert [x for x in _t(tono_juez=1.0)["recomendaciones"] if x["tipo"] == "bajar_modelo" and x["objeto"] == "generar"]
    assert not [x for x in _t(tono_juez=0.5)["recomendaciones"] if x["tipo"] == "bajar_modelo"]


def test_recomienda_por_latencia_solo_en_interactivas() -> None:
    lento = dict(ttft_ms=20000, total_ms=90000)
    assert [x for x in _t(funcion="conversar", prompt_nombre="conversar", **lento)["recomendaciones"] if x["tipo"] == "latencia"]
    assert not [x for x in _t(**lento)["recomendaciones"] if x["tipo"] == "latencia"]


def test_recomienda_revisar_si_la_calidad_es_baja(monkeypatch) -> None:
    monkeypatch.setattr(mm, "modelo_configurado", lambda t: "sonnet")
    r = [x for x in _t(tono_juez=0.0)["recomendaciones"] if x["tipo"] == "calidad_baja"]
    assert r and "0%" in r[0]["numero"]


def test_recomienda_por_errores_y_desvio() -> None:
    m = _t(error="boom", modelo_respondido="otro")
    assert {"errores", "desvio"} <= {x["tipo"] for x in m["recomendaciones"]}
    assert m["recomendaciones"][0]["gravedad"] == "alta"


async def test_mapa_desde_la_base_y_ruta(cliente) -> None:
    async with sesion.nueva_sesion() as s, s.begin():
        for i, (dias, tono) in enumerate([(1, 1.0), (2, 0.0), (90, 1.0)]):
            await s.execute(text(
                "insert into llamadas (traza_id, funcion, motor, modelo_pedido, modelo_respondido, tokens_entrada, tokens_salida, "
                "coste_equivalente, total_ms, ttft_ms, prompt_nombre, creada) values (:t, 'generar', 'cli', 'sonnet', 'claude-sonnet-x', "
                "100, 10, 0.5, 4000, 900, 'apuntes_bloque', now() - make_interval(days => :d))"), {"t": f"t{i}", "d": dias})
            await s.execute(text("insert into puntuaciones (traza_id, nombre, valor) values (:t, 'tono_juez', :v)"), {"t": f"t{i}", "v": tono})
    r = await cliente.get("/api/modelos/mapa")
    assert r.status_code == 200
    g = next(t for t in r.json()["tareas"] if t["tarea"] == "generar")
    assert g["llamadas"] == 2 and g["coste_total"] == 1.0 and g["calidad"]["tono_juez"] == 0.5
    assert g["ttft_p50_ms"] == 900 and g["total_p95_ms"] == 4000
    anual = (await cliente.get("/api/modelos/mapa", params={"dias": 365})).json()
    assert next(t for t in anual["tareas"] if t["tarea"] == "generar")["llamadas"] == 3
    assert (await cliente.get("/api/modelos/mapa", params={"dias": 0})).status_code == 422
