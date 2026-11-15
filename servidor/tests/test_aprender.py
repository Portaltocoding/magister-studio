"""Parte V: estado sin mirar el futuro, programadores, corrector, fugas y el flujo de práctica."""

import inspect
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from magister.aprender import columnas
from magister.aprender.corrector import Correccion, Error, comprobar
from magister.aprender.estado import EstadoConcepto, estado_de
from magister.aprender.programador import FSRS, Leitner

T0 = datetime(2026, 11, 1, 18, tzinfo=timezone.utc)


def test_estado_ignora_futuro_y_reintentos() -> None:
    intentos = [(T0, "bien", None, "espaciado"), (T0 + timedelta(days=2), "fallo", "bien", "espaciado"),
                (T0 + timedelta(days=3), "fallo", None, "reintento"), (T0 + timedelta(days=10), "fallo", None, "espaciado")]
    e = estado_de("c", T0 + timedelta(days=5), intentos)
    assert (e.aciertos, e.fallos) == (2, 0)  # la nota del usuario manda; el futuro y el reintento no cuentan
    assert e.dias_desde == 3


@pytest.mark.parametrize("prog", [Leitner(), FSRS()])
def test_protocolo_programador(prog) -> None:
    e = EstadoConcepto("c", T0)
    for nota in ["bien", "fallo", "perfecta", "parcial"]:
        p = prog.p_recordar(e, e.momento)
        assert 0 <= p <= 1
        e, fecha = prog.siguiente(e, nota, e.momento)
        assert fecha > e.repasos[-1][0]
        e = EstadoConcepto("c", fecha, e.repasos)
    assert prog.version


def test_leitner_cajas() -> None:
    lt = Leitner()
    e = EstadoConcepto("c", T0, [(T0, "bien"), (T0 + timedelta(days=1), "bien")])
    assert lt.caja(e) == 2 and lt.proxima(e) == T0 + timedelta(days=4)
    e.repasos.append((T0 + timedelta(days=4), "fallo"))
    assert lt.caja(e) == 1


def test_corrector_determinista() -> None:
    c = comprobar(Correccion(nota="fallo"), ["texto"])
    assert c.nota == "parcial"  # un fallo sin decir qué falta no vale
    c = comprobar(Correccion(nota="fallo", errores=[Error(afirmacion="x", por_que="y", cita="no está")]), ["El índice ordena claves."])
    assert c.errores[0].cita == "" and c.errores[0].cita_descartada


def test_columnas_no_leen_confianza_latencia_ni_oraculo() -> None:
    fuente = inspect.getsource(columnas)
    for prohibida in ("confianza", "latencia", "oraculo"):
        assert prohibida not in fuente.split('"""', 2)[-1]


def test_la_prueba_de_fugas_detecta_la_fuga() -> None:
    """Añadir la tasa del concepto en todo el registro (futuro incluido) dispara el AUC: el test lo detecta."""
    import random

    from evals.estadistica import auc

    rng = random.Random(1)
    conceptos = {f"c{i}": rng.random() for i in range(60)}
    filas = [(c, int(rng.random() < p)) for c, p in conceptos.items() for _ in range(20)]
    tasa_total = {c: sum(y for k, y in filas if k == c) / sum(1 for k, _ in filas if k == c) for c in conceptos}
    assert auc([tasa_total[c] for c, _ in filas], [y for _, y in filas]) > 0.75
    # La versión honesta (solo el pasado) no puede ver el resultado de la fila.
    vistos: dict[str, list[int]] = {}
    honesta = []
    for c, y in filas:
        previos = vistos.setdefault(c, [])
        honesta.append((sum(previos) + 2.5) / (len(previos) + 5))
        previos.append(y)
    assert auc(honesta, [y for _, y in filas]) < auc([tasa_total[c] for c, _ in filas], [y for _, y in filas])


pytestmark = pytest.mark.anyio
FIJOS = Path(__file__).parent / "fijos"


async def preparar_preguntas() -> int:
    from magister.datos.material import Pregunta, PreguntaConcepto
    from magister.datos.plan import guardar_plan
    from magister.datos.sesion import nueva_sesion

    plan = json.loads((FIJOS / "Plan.json").read_text(encoding="utf-8"))
    perfil = json.loads((FIJOS / "Perfil.json").read_text(encoding="utf-8"))
    _, plan_id = await guardar_plan("bases de datos", None, perfil, plan, [], "x", "eco")
    async with nueva_sesion() as s, s.begin():
        s.add(Pregunta(id="p1", plan_id=plan_id, leccion_clave="L1", tipo="conceptual", enunciado="¿Qué es una clave primaria?",
                       fantasma="La columna que identifica cada fila sin repetirse ni ser nula.", donde="b1", estado="activa"))
        await s.flush()
        s.add(PreguntaConcepto(pregunta_id="p1", plan_id=plan_id, concepto_id="clave-primaria"))
    return plan_id


async def test_practica_de_punta_a_punta(cliente) -> None:
    from magister.cerebro.estructura import eco
    from sse import eventos_sse

    await preparar_preguntas()
    cola = (await cliente.get("/api/practica/cola")).json()
    assert [c["concepto_id"] for c in cola] == ["clave-primaria"] and cola[0]["nuevo"]
    s = (await cliente.get("/api/practica/siguiente")).json()
    assert s["pregunta_id"] == "p1"
    eco.encolar(Correccion, [{"nota": "parcial", "ideas_ausentes": ["que no puede ser nula"], "errores": []}])
    cuerpo = {"pregunta_id": "p1", "concepto_id": "clave-primaria", "respuesta": "Identifica cada fila", "confianza": 0.75,
              "clave": "intento-de-prueba-1"}
    r = await cliente.post("/api/practica/intentos", json=cuerpo)
    ev = eventos_sse(r.text)
    assert ev[0] == ("nota", {"nota": "parcial", "ideas_ausentes": ["que no puede ser nula"], "errores": []})
    assert ev[-1][0] == "fin" and ev[-1][1]["proxima_fecha"]
    # La misma clave no vuelve a corregir: devuelve el intento existente.
    otra = eventos_sse((await cliente.post("/api/practica/intentos", json=cuerpo)).text)
    assert otra[-1][1]["intento_id"] == ev[-1][1]["intento_id"]
    assert (await cliente.patch(f"/api/practica/intentos/{ev[-1][1]['intento_id']}", json={"nota_usuario": "bien"})).status_code == 200
    conceptos = (await cliente.get("/api/progreso/conceptos")).json()
    cp = next(c for c in conceptos if c["concepto_id"] == "clave-primaria")
    assert cp["aciertos"] == 1 and cp["repasos"][0]["nota"] == "bien"
    assert (await cliente.get("/api/progreso/resumen")).json()["intentos"] == 1
    _ = columnas
