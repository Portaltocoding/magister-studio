"""Vídeos dentro del roadmap: qué lecciones los llevan (las más duras, tantas como pidas), tu preferencia y la
automatización, que ya no hace vídeo de todo."""

from datetime import date

import pytest

from magister.plan import videos as v


def _l(clave, horas=2.0, conceptos=2, depende=0, respuestas=0, fallos=0, con_video=False):
    return v.LeccionVideo(clave, f"Lección {clave}", horas, conceptos, depende, respuestas, fallos, con_video)


def test_elige_las_mas_duras_y_tantas_como_pidas() -> None:
    lecciones = [_l("L1", 1, 1), _l("L2", 4, 3, 2), _l("L3", 2, 2), _l("L4", 1.5, 5, 1), _l("L5", 1, 1)]
    assert [r.clave for r in v.elegir(lecciones, "pocos")] == ["L2"]
    assert [r.clave for r in v.elegir(lecciones, "normal")] == ["L2", "L4"]
    assert len(v.elegir(lecciones, "muchos")) == 3 and v.elegir(lecciones, "ninguno") == []
    assert v.elegir(lecciones, "pocos")[0].razon == "es la lección más larga del plan"
    # Con un plan de una lección, «pocos» sigue siendo uno.
    assert len(v.elegir([_l("L1")], "pocos")) == 1


def test_lo_que_fallas_pesa_mas_que_lo_largo() -> None:
    lecciones = [_l("L1", 4, 4, 2), _l("L2", 1, 1, respuestas=10, fallos=8), _l("L3", 2, 2, respuestas=2, fallos=2)]
    elegida = v.elegir(lecciones, "pocos")[0]
    assert elegida.clave == "L2" and elegida.razon == "fallas 8 de 10 preguntas de sus conceptos"
    # Dos respuestas no bastan para saber qué fallas: L3 se mide por lo demás.
    assert v.dureza(lecciones[2], 4, 4, 2) == v.dureza(_l("L3", 2, 2), 4, 4, 2)


def test_mas_y_menos_mueven_un_paso() -> None:
    assert v.mover("normal", "mas") == "muchos" and v.mover("muchos", "mas") == "muchos"
    assert v.mover("pocos", "menos") == "ninguno" and v.mover("raro", "menos") == "pocos"


def test_la_automatizacion_solo_hace_video_de_las_elegidas() -> None:
    from magister.trabajos.automatizar import PREDETERMINADAS, elegir_tarea

    lecciones = [
        {"plan_id": 1, "clave": "L1", "titulo": "a", "fecha": None, "tipos": {"apuntes"}, "video": False},
        {"plan_id": 1, "clave": "L2", "titulo": "b", "fecha": None, "tipos": {"apuntes"}, "video": True, "minutos": 10, "estilo": "examen"},
    ]
    config = {**PREDETERMINADAS, "video_al_preparar": {"activa": True, "estilo": "clase", "minutos": 6}}
    lec, tipos, pref = elegir_tarea(config, lecciones, date(2026, 11, 18))
    assert lec["clave"] == "L2" and tipos == ["guion"] and pref["video"] == {"estilo": "examen", "minutos": 10}
    lecciones[1]["video"] = False
    assert elegir_tarea(config, lecciones, date(2026, 11, 18)) is None


@pytest.mark.anyio
async def test_rutas_de_recomendados_y_preferencias(cliente) -> None:
    from tests.test_material import plan_aceptado

    plan_id = await plan_aceptado()
    r = (await cliente.get(f"/api/planes/{plan_id}/videos/recomendados")).json()
    assert r["cuantos"] == "normal" and r["minutos"] == 6 and r["lecciones"]
    assert all({"clave", "titulo", "razon", "con_video"} <= set(x) for x in r["lecciones"])
    p = (await cliente.put("/api/videos/preferencias", json={"hacia": "menos", "minutos": 3})).json()
    assert p["cuantos"] == "pocos" and p["minutos"] == 3
    menos = (await cliente.get(f"/api/planes/{plan_id}/videos/recomendados")).json()
    assert len(menos["lecciones"]) <= len(r["lecciones"])
    assert (await cliente.put("/api/videos/preferencias", json={"cuantos": "ninguno"})).json()["cuantos"] == "ninguno"
    assert (await cliente.get(f"/api/planes/{plan_id}/videos/recomendados")).json()["lecciones"] == []
    assert (await cliente.put("/api/videos/preferencias", json={"minutos": 7})).status_code == 422
