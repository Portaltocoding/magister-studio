"""El Carlos sintético: escribe intentos simulados en la base de simulación, nunca en la tuya.

    uv run python -m magister.aprender.simular --conceptos 200 --dias 120 --nuevos 4 --semilla 7
    uv run python -m magister.aprender.simular --saltar-dias 10

Dificultad lognormal por concepto; memoria con la curva de potencia de FSRS-6
(R = (1 + F·t/S)^C con F = 19/81 y C = -0,5); la estabilidad sube al acertar (más si R era
bajo) y baja al fallar. Programado con Leitner. La probabilidad verdadera va a `oraculo`.
"""

import argparse
import asyncio
import math
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from magister.aprender.estado import EstadoConcepto
from magister.aprender.programador import Leitner
from magister.config import ajustes

F, C = 19 / 81, -0.5
INICIO = datetime(2026, 1, 5, 18, 0, tzinfo=timezone.utc)


def recuerdo(t_dias: float, estabilidad: float) -> float:
    return (1 + F * t_dias / estabilidad) ** C


async def _preparar(conexion) -> None:
    await conexion.execute(text("create table if not exists oraculo (intento_id uuid primary key, p double precision)"))
    await conexion.execute(text("truncate intentos, oraculo"))
    await conexion.execute(text("delete from planes where version = 0 and razonamiento = 'simulado'"))


async def simular(n_conceptos: int, dias: int, nuevos_por_dia: int, semilla: int) -> int:
    rng = random.Random(semilla)
    motor = create_async_engine(ajustes.db_url_sim)
    leitner = Leitner()
    async with motor.begin() as c:
        await _preparar(c)
        tema = (await c.execute(text(
            "insert into temas (nombre) values ('simulado') on conflict (nombre) do update set nombre = excluded.nombre returning id"))).scalar()
        plan = (await c.execute(text(
            "insert into planes (tema_id, version, estado, perfil, razonamiento) values (:t, 0, 'propuesto', '{}', 'simulado') returning id"
        ), {"t": tema})).scalar()
        await c.execute(text("insert into lecciones (plan_id, clave, titulo, objetivos, horas, orden) values (:p, 'L1', 'Simulada', '{}', 1, 0)"),
                        {"p": plan})
        for i in range(n_conceptos):
            await c.execute(text("insert into conceptos (plan_id, id, nombre, leccion_clave) values (:p, :i, :n, 'L1')"),
                            {"p": plan, "i": f"c{i}", "n": f"Concepto {i}"})
        dificultad = [rng.lognormvariate(0, 0.5) for _ in range(n_conceptos)]
        estabilidad = [2.0 / d for d in dificultad]
        repasos: list[list] = [[] for _ in range(n_conceptos)]
        proxima: dict[int, datetime] = {}
        introducidos = 0
        filas, oraculo = [], []
        for dia in range(dias):
            hoy = INICIO + timedelta(days=dia)
            for _ in range(nuevos_por_dia):
                if introducidos < n_conceptos:
                    proxima[introducidos] = hoy
                    introducidos += 1
            for k in sorted(i for i, f in proxima.items() if f <= hoy + timedelta(hours=23)):
                momento = hoy + timedelta(minutes=rng.randint(0, 90))
                t = (momento - repasos[k][-1][0]).total_seconds() / 86400 if repasos[k] else 0.0
                p = recuerdo(t, estabilidad[k]) if repasos[k] else 0.5 / dificultad[k] ** 0.5
                p = min(0.99, max(0.01, p))
                acierto = rng.random() < p
                nota = rng.choice(["bien", "perfecta"]) if acierto else rng.choice(["fallo", "fallo", "parcial"])
                if acierto:
                    estabilidad[k] *= 1 + (2.5 / dificultad[k]) * (1.2 - p)
                else:
                    estabilidad[k] = max(0.3, estabilidad[k] * 0.4)
                repasos[k].append((momento, nota))
                iid = uuid.uuid4()
                filas.append({"id": iid, "p": plan, "c": f"c{k}", "m": momento, "n": nota, "conf": rng.choice([0.25, 0.5, 0.75, 0.95]),
                              "clave": f"sim-{iid}"})
                oraculo.append({"i": iid, "p": p})
                _, prox = leitner.siguiente(EstadoConcepto(f"c{k}", momento, repasos[k][:-1]), nota, momento)
                proxima[k] = prox
        await c.execute(text(
            "insert into intentos (id, plan_id, concepto_id, momento, tipo, respuesta, confianza, nota_corrector, version_programador, "
            "clave_idempotencia) values (:id, :p, :c, :m, 'espaciado', 'simulada', :conf, :n, 'leitner-1-3-7-16-35', :clave)"), filas)
        await c.execute(text("insert into oraculo (intento_id, p) values (:i, :p)"), oraculo)
    await motor.dispose()
    return len(filas)


async def saltar(dias: int) -> None:
    motor = create_async_engine(ajustes.db_url_sim)
    async with motor.begin() as c:
        await c.execute(text("update intentos set momento = momento - make_interval(days => :d)"), {"d": dias})
    await motor.dispose()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--conceptos", type=int, default=200)
    ap.add_argument("--dias", type=int, default=120)
    ap.add_argument("--nuevos", type=int, default=4)
    ap.add_argument("--semilla", type=int, default=7)
    ap.add_argument("--saltar-dias", type=int)
    a = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    if a.saltar_dias:
        asyncio.run(saltar(a.saltar_dias))
        print(f"Movidos {a.saltar_dias} días hacia atrás")
    else:
        n = asyncio.run(simular(a.conceptos, a.dias, a.nuevos, a.semilla))
        print(f"{n} intentos simulados en {ajustes.db_url_sim.rsplit('/', 1)[-1]}")


if __name__ == "__main__":
    main()

