"""Las alertas: se evalúan al arrancar la API y cada hora; escriben en `alertas` las que saltan.

    uv run python -m magister.observar.alertas

| Alerta | Salta si (últimas 24 h) | Runbook |
|---|---|---|
| errores | más del 5 % de llamadas con error (mínimo 10) | docs/runbooks/errores.md |
| latencia | p95 de lo que tardas en ver la primera palabra del tutor > 20 s (mínimo 10 respuestas) | docs/runbooks/latencia.md |
| negativas | más del 2 % de respuestas con negativa | docs/runbooks/negativas.md |
| tono | menos del 70 % de aprobados del juez online en 7 días con la rúbrica actual (mínimo 10) | docs/runbooks/tono.md |
"""

import asyncio
import sys

from sqlalchemy import text

from magister.datos.sesion import nueva_sesion
from magister.tono.juez import rubrica

# La latencia mide lo que ves tú (desde que envías hasta la primera palabra), no solo lo que piensa el modelo: avisa
# cuando algo nuestro se atasca, no de cada respuesta en la que el modelo piensa un rato.
UMBRALES = {"errores": 0.05, "latencia_ms": 20000, "latencia_min": 10, "negativas": 0.02, "tono": 0.70}


async def evaluar() -> list[tuple[str, str]]:
    saltan: list[tuple[str, str]] = []
    async with nueva_sesion() as s:
        n, err = (await s.execute(text(
            "select count(*), count(*) filter (where error is not null) from llamadas where creada > now() - interval '24 hours'"))).one()
        if n >= 10 and err / n > UMBRALES["errores"]:
            saltan.append(("errores", f"{err} de {n} llamadas con error en 24 h"))
        n, p95 = (await s.execute(text(
            "select count(*), percentile_cont(0.95) within group (order by ms_primer_token) from mensajes "
            "where creado_en > now() - interval '24 hours' and rol = 'tutor' and ms_primer_token is not null"))).one()
        if n >= UMBRALES["latencia_min"] and p95 and p95 > UMBRALES["latencia_ms"]:
            saltan.append(("latencia", f"la primera palabra tarda {p95 / 1000:.1f} s (p95 de {n} respuestas en 24 h)"))
        n, neg = (await s.execute(text(
            "select count(*), coalesce(sum(valor), 0) from puntuaciones where nombre = 'negativa' and creada > now() - interval '24 hours'"))).one()
        if n >= 20 and neg / n > UMBRALES["negativas"]:
            saltan.append(("negativas", f"{int(neg)} negativas de {n} respuestas"))
        # Solo las notas puestas con la rúbrica de ahora: al cambiarla, las de antes ya no dicen nada.
        n, ok = (await s.execute(text(
            "select count(*), coalesce(sum(valor), 0) from puntuaciones where nombre = 'tono_juez' "
            "and creada > now() - interval '7 days' and version = :v"), {"v": rubrica()[1]})).one()
        if n >= 10 and ok / n < UMBRALES["tono"]:
            saltan.append(("tono", f"el juez aprueba {ok / n:.0%} de {n} explicaciones en 7 días"))
    return saltan


async def escribir(nombre: str, detalle: str) -> None:
    async with nueva_sesion() as s, s.begin():
        ya = await s.scalar(text("select 1 from alertas where nombre = :n and not resuelta and creada > now() - interval '24 hours'"),
                            {"n": nombre})
        if not ya:
            await s.execute(text("insert into alertas (nombre, detalle) values (:n, :d)"), {"n": nombre, "d": detalle})


async def comprobar() -> list[tuple[str, str]]:
    saltan = await evaluar()
    for nombre, detalle in saltan:
        await escribir(nombre, detalle)
    return saltan


async def bucle(cada_s: int = 3600) -> None:
    while True:
        try:
            await comprobar()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(cada_s)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    for n, d in asyncio.run(comprobar()) or [("ninguna", "todo en orden")]:
        print(f"{n}: {d}")
