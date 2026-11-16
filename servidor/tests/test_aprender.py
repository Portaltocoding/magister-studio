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
        # La lección ya se estudió: sus conceptos entran en el repaso.
        from datetime import date

        from magister.datos.plan import SesionFila

        s.add(SesionFila(plan_id=plan_id, leccion_clave="L1", fecha=date(2026, 1, 5), horas=1.0, estado="hecha"))
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



def test_solo_el_primer_intento_del_dia_es_un_repaso():
    from datetime import datetime, timezone

    from magister.aprender.estado import estado_de

    d = lambda h, dia=1: datetime(2026, 11, dia, h, tzinfo=timezone.utc)  # noqa: E731
    e = estado_de("x", d(23, 5), [(d(9), "fallo", None, "espaciado"), (d(10), "bien", None, "espaciado"),
                                   (d(9, 3), "bien", None, "espaciado"), (d(11, 3), "fallo", None, "reintento")])
    assert [n for _, n in e.repasos] == ["fallo", "bien"]


def test_lo_recien_aprendido_vuelve_pronto():
    from datetime import datetime, timedelta, timezone

    from magister.aprender.estado import EstadoConcepto
    from magister.aprender.programador import FSRS

    t0 = datetime(2026, 11, 1, 9, tzinfo=timezone.utc)
    f = FSRS()
    uno = EstadoConcepto("x", t0, [(t0, "perfecta")])
    assert f.proxima(uno) <= t0 + timedelta(days=3)
    dos = EstadoConcepto("x", t0, [(t0, "perfecta"), (t0 + timedelta(days=3), "perfecta")])
    assert f.proxima(dos) <= t0 + timedelta(days=12)


def test_ajuste_personal_con_escalones():
    from datetime import datetime, timedelta, timezone

    from magister.aprender.personal import _ajustar_iniciales, _calcular

    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    pocos = [[(t0, "bien"), (t0 + timedelta(days=3), "bien")]] * 3
    assert _calcular(pocos, None)["hecho"] is False
    # Alguien que recuerda mucho mejor de lo que espera FSRS: la estabilidad inicial de «bien» sube y es monótona.
    muchos = [[(t0, "bien"), (t0 + timedelta(days=20), "bien"), (t0 + timedelta(days=60), "bien")] for _ in range(12)]
    w = _ajustar_iniciales(muchos)
    from fsrs.scheduler import DEFAULT_PARAMETERS

    assert w[2] > DEFAULT_PARAMETERS[2] and w[0] <= w[1] <= w[2] <= w[3]
    r = _calcular(muchos, None)
    assert r["hecho"] and r["perdida_despues"] < r["perdida_antes"] and r["etapa"] == "inicial"



def test_la_red_aprende_lo_que_fsrs_no_ve():
    """Un alumno inventado que de noche recuerda mucho peor (FSRS no mira la hora): la red lo aprende, gana a FSRS
    en lo que no ha visto y pasa a mandar. Con pocos datos, ni se entrena."""
    import random
    from datetime import datetime, timedelta, timezone

    from magister.aprender.programador import FSRS
    from magister.aprender.red import calcular

    rng = random.Random(7)
    t0 = datetime(2026, 1, 1, 9, tzinfo=timezone.utc)
    series = []
    for i in range(70):
        t = t0 + timedelta(hours=i)
        serie = []
        for k in range(5):
            momento = t.replace(hour=rng.choice([9, 23]))
            acierta = rng.random() < (0.95 if momento.hour == 9 else 0.3)
            serie.append((momento, "bien" if acierta else "fallo", 0.75, 20000))
            t += timedelta(days=2 + k * 2)
        series.append(serie)
    r = calcular(series, FSRS())
    assert r["estado"] == "activa" and r["perdida_red"] < r["perdida_fsrs"], r
    assert calcular(series[:5], FSRS())["estado"] == "sin_datos"


def test_la_red_recien_creada_es_fsrs():
    from datetime import datetime, timedelta, timezone

    from magister.aprender.estado import EstadoConcepto
    from magister.aprender.programador import FSRS
    from magister.aprender.red import ProgramadorRed, _crear

    t0 = datetime(2026, 1, 1, 9, tzinfo=timezone.utc)
    e = EstadoConcepto("x", t0, [(t0, "bien")], [{"confianza": 0.75, "latencia_ms": 9000}])
    f = FSRS()
    pr = ProgramadorRed(f, _crear(), {"tasa": 0.7, "huella": "x"})
    ahora = t0 + timedelta(days=4)
    assert abs(pr.p_recordar(e, ahora) - f.p_recordar(e, ahora)) < 1e-3
    assert pr.proxima(e) <= f.proxima(e)
