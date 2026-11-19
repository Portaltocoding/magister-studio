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
    async with nueva_sesion() as s, s.begin():
        await s.execute(text("delete from mensajes"))
    # Lo del 19-11-2026: 14 respuestas, mediana de 8 s y dos de 70 s. El p95 pasa de 20 s, pero son dos casos sueltos.
    await _mensajes([70000, 69000] + [8000] * 12)
    assert not [a for a in await alertas.evaluar() if a[0] == "latencia"]
    await _mensajes([30000] * 10)
    (latencia,) = [a for a in await alertas.evaluar() if a[0] == "latencia"]
    assert "primera palabra" in latencia[1] and "mediana" in latencia[1] and "12 de más de 20 s" in latencia[1]


@pytest.mark.anyio
async def test_tono_solo_con_la_rubrica_actual(cliente) -> None:
    await _notas([0.0] * 20, None)  # notas de antes de cambiar la rúbrica
    await _notas([0.0] * 20, "rubrica-vieja")
    assert not [a for a in await alertas.evaluar() if a[0] == "tono"]
    await _notas([1.0] * 4 + [0.0] * 6, rubrica()[1])
    (tono,) = [a for a in await alertas.evaluar() if a[0] == "tono"]
    assert "40%" in tono[1] and "de 10" in tono[1]


@pytest.mark.anyio
async def test_una_abierta_por_nombre_al_dia_y_se_cierra_sola(cliente) -> None:
    async def abiertas() -> list[tuple[str, str]]:
        async with nueva_sesion() as s:
            return [tuple(f) for f in (await s.execute(text("select nombre, detalle from alertas where not resuelta order by id"))).all()]

    await alertas.escribir("freno_llamadas", "el freno ha saltado")
    await _mensajes([30000] * 10)
    await alertas.comprobar()
    await _mensajes([40000] * 10)
    await alertas.comprobar()
    latencia = [d for n, d in await abiertas() if n == "latencia"]
    assert len(latencia) == 1 and "de 20 respuestas" in latencia[0]  # la misma alerta, con la cifra de ahora
    async with nueva_sesion() as s, s.begin():
        await s.execute(text("delete from mensajes"))
    await alertas.comprobar()
    # Ya no se cumple: se cierra. La del freno no es de las que se evalúan aquí y se queda.
    assert await abiertas() == [("freno_llamadas", "el freno ha saltado")]
