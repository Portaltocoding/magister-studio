"""Las alertas de latencia y tono: miden lo que ve el alumno y solo con la rúbrica actual."""

import pytest
from sqlalchemy import text

from magister.datos.sesion import nueva_sesion
from magister.observar import alertas
from magister.tono.juez import rubrica


async def _mensajes(ms: list[int]) -> None:
    async with nueva_sesion() as s, s.begin():
        cid = await s.scalar(text("insert into conversaciones (titulo) values ('x') returning id"))
        for m in ms:
            await s.execute(text("insert into mensajes (conversacion_id, rol, contenido, ms_primer_token) values (:c, 'tutor', 'r', :m)"),
                            {"c": cid, "m": m})


async def _notas(valores: list[float], version: str | None) -> None:
    async with nueva_sesion() as s, s.begin():
        for i, v in enumerate(valores):
            await s.execute(text("insert into puntuaciones (traza_id, nombre, valor, version) values (:t, 'tono_juez', :v, :ver)"),
                            {"t": f"{version}-{i}", "v": v, "ver": version})


@pytest.mark.anyio
async def test_latencia_lo_que_ves_y_con_minimo(cliente) -> None:
    await _mensajes([60000] * 3)  # pocas respuestas: no basta para avisar
    assert not [a for a in await alertas.evaluar() if a[0] == "latencia"]
    async with nueva_sesion() as s, s.begin():
        await s.execute(text("delete from mensajes"))
    await _mensajes([60000] + [7000] * 19)  # una sola lenta entre veinte no mueve el p95
    assert not [a for a in await alertas.evaluar() if a[0] == "latencia"]
    await _mensajes([30000] * 10)
    (latencia,) = [a for a in await alertas.evaluar() if a[0] == "latencia"]
    assert "primera palabra" in latencia[1]


@pytest.mark.anyio
async def test_tono_solo_con_la_rubrica_actual(cliente) -> None:
    await _notas([0.0] * 20, None)  # notas de antes de cambiar la rúbrica
    await _notas([0.0] * 20, "rubrica-vieja")
    assert not [a for a in await alertas.evaluar() if a[0] == "tono"]
    await _notas([1.0] * 4 + [0.0] * 6, rubrica()[1])
    (tono,) = [a for a in await alertas.evaluar() if a[0] == "tono"]
    assert "40%" in tono[1] and "de 10" in tono[1]
