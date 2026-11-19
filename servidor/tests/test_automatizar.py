"""Automatizaciones: lo que ya se intentó hoy y no salió no se vuelve a encolar en cada vuelta."""

from datetime import date, datetime

import pytest

from magister.trabajos.automatizar import PREDETERMINADAS, elegir_tarea

HOY = date(2026, 11, 18)


def _lecciones() -> list[dict]:
    return [
        {"plan_id": 1, "clave": "L1", "titulo": "a", "fecha": HOY, "tipos": set()},
        {"plan_id": 1, "clave": "L2", "titulo": "b", "fecha": HOY, "tipos": set()},
    ]


PREPARAR = {**PREDETERMINADAS, "preparar_siguiente": {"activa": True, "dias_antes": 1}}


def test_elegir_tarea_se_salta_las_descartadas() -> None:
    lecciones = _lecciones()
    assert elegir_tarea(PREPARAR, lecciones, HOY)[0]["clave"] == "L1"
    assert elegir_tarea(PREPARAR, lecciones, HOY, frozenset({(1, "L1", "apuntes")}))[0]["clave"] == "L2"
    assert elegir_tarea(PREPARAR, lecciones, HOY, frozenset({(1, "L1", "apuntes"), (1, "L2", "apuntes")})) is None
    # Descartar las diapositivas de una lección no la quita de las demás reglas.
    lecciones[0]["tipos"] = {"apuntes"}
    config = {**PREDETERMINADAS, "diapositivas_al_preparar": {"activa": True}, "video_al_preparar": {"activa": True}}
    lec, tipos, _ = elegir_tarea(config, lecciones, HOY, frozenset({(1, "L1", "diapositivas")}))
    assert lec["clave"] == "L1" and tipos == ["guion"]


@pytest.mark.anyio
@pytest.mark.parametrize("estado", ["fallido", "cancelado", "hecho"])
async def test_lo_que_no_salio_hoy_no_se_reencola(base, monkeypatch, estado) -> None:
    from magister.trabajos import automatizar, cola

    async def leer():
        return PREPARAR

    async def lecciones(_hoy, _dias):
        return _lecciones()

    monkeypatch.setattr(automatizar, "leer", leer)
    monkeypatch.setattr(automatizar, "_lecciones", lecciones)
    ahora = datetime(2026, 11, 18, 12)
    clave = cola.clave_idempotencia(automatizacion=True, plan_id=1, leccion="L1", tipos=["apuntes", "preguntas"],
                                    dia=HOY.isoformat())
    tid, _ = await cola.encolar("material", 1, "L1", {"tipos": ["apuntes", "preguntas"]}, clave)
    if estado == "cancelado":
        assert await cola.cancelar(tid)
    else:
        await cola.terminar(tid, estado, "no salió" if estado == "fallido" else None)

    texto = await automatizar.una_vuelta(ahora)
    # L1 se queda como estaba y se pasa a la siguiente lección.
    assert texto == "Puesto en cola: preparar L2 · b"
    assert (await cola.leer(tid))["estado"] == estado
    registro = [x["texto"] for x in await automatizar.ver_registro()]
    aviso = "No he podido preparar L1 · a: lo dejo por hoy."
    assert (aviso in registro) is (estado != "cancelado")

    # Con L2 ya hecha, la siguiente vuelta no reabre nada ni repite el aviso.
    t2 = await cola.coger("t1")
    await cola.terminar(t2.id, "hecho")
    assert await automatizar.una_vuelta(ahora) is None
    assert (await cola.leer(tid))["estado"] == estado
    registro = [x["texto"] for x in await automatizar.ver_registro()]
    assert registro.count(aviso) == (1 if estado != "cancelado" else 0)
