"""Los criterios de la v0.5 que se comprueban con datos.

    uv run python -m evals.criterios_v05

- Todo intento espaciado lleva `p_predicha`.
- El ECE del modelo en walk-forward es menor que 0,05 (último fichero de predicciones).
- Ningún día del calendario pasa de tus horas.
"""

import asyncio
import csv
import sys
from pathlib import Path

from sqlalchemy import text

from evals.estadistica import calibracion
from magister.datos.sesion import cerrar, nueva_sesion


async def principal() -> int:
    fallos = 0
    async with nueva_sesion() as s:
        sin_p = await s.scalar(text("select count(*) from intentos where tipo = 'espaciado' and p_predicha is null"))
        total = await s.scalar(text("select count(*) from intentos where tipo = 'espaciado'"))
        dias = (await s.execute(text(
            "select s.fecha, sum(s.horas), max((p.perfil->'horas_por_dia'->>(extract(isodow from s.fecha)::int - 1))::float) "
            "from sesiones s join planes p on p.id = s.plan_id where p.estado = 'aceptado' group by s.fecha"))).all()
    print(f"{'bien' if not sin_p else 'MAL '} · intentos espaciados con p_predicha: {total - sin_p} de {total}")
    fallos += bool(sin_p)
    pasados = [d for d, h, cap in dias if cap is not None and h > cap + 1e-6]
    print(f"{'bien' if not pasados else 'MAL '} · días por encima de tus horas: {len(pasados)}")
    fallos += bool(pasados)
    ficheros = sorted((Path(__file__).parent / "olvido").glob("predicciones-*.csv"))
    if ficheros:
        filas = [r for r in csv.DictReader(ficheros[-1].open(encoding="utf-8")) if r["modelo"] == "logistica_calibrada"]
        if filas:
            tramos = calibracion([float(r["p"]) for r in filas], [int(r["y"]) for r in filas])
            n = sum(t[2] for t in tramos)
            ece = sum(abs(a - b) * k for a, b, k in tramos) / n
            print(f"{'bien' if ece < 0.05 else 'MAL '} · ECE del modelo en walk-forward: {ece:.3f} ({ficheros[-1].name})")
            fallos += ece >= 0.05
    else:
        print("(sin predicciones del modelo: corre `python -m evals.olvido walkforward`)")
    await cerrar()
    return fallos


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    sys.exit(1 if asyncio.run(principal()) else 0)
