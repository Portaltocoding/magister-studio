import json
from datetime import date, time
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from magister.plan.calendario import Calendario, NoCabe, ReglasCalendario, a_hora, calendarizar
from magister.plan.dependencias import comprobar, orden
from magister.plan.esquemas import Perfil, Plan
from magister.plan.perfil import huecos
from magister.plan.reglas import ReglasPlan, capacidad, presupuesto, reglas_plan

FIJOS = Path(__file__).parent / "fijos"
HOY = date(2026, 11, 9)
SEMANA = [1.5, 1.5, 1.5, 1.5, 1.5, 0, 0]
INICIOS = [time(18)] * 5 + [None, None]


def fijo(nombre: str, modelo):
    return modelo.model_validate(json.loads((FIJOS / nombre).read_text(encoding="utf-8")))


# Perfil y huecos


def test_huecos_vacio_medias_y_completo() -> None:
    assert huecos(Perfil()) == ["tema", "objetivo", "nivel", "horas_por_dia", "plazo"]
    assert huecos(Perfil(tema="redes", nivel="nada")) == ["objetivo", "horas_por_dia", "plazo"]
    assert huecos(fijo("Perfil.json", Perfil)) == []
    assert huecos(Perfil(tema="x", objetivo="y", nivel="nada", horas_por_dia=SEMANA, sin_plazo=True)) == []


# Reglas


def test_capacidad_y_presupuesto() -> None:
    p = fijo("Perfil.json", Perfil)
    assert capacidad(p, HOY) == 33
    assert presupuesto(p, HOY, 0.15) == 28.70


def test_reglas_exceso_y_maximo() -> None:
    p = fijo("Perfil.json", Perfil)
    aplicar = reglas_plan(p, HOY, ReglasPlan())
    assert aplicar(fijo("plan_ok.json", Plan)) == []
    assert aplicar(fijo("plan_medido.json", Plan)) == ["33 h para un presupuesto de 28,7 h"]
    assert any("máximo por lección" in e for e in aplicar(fijo("plan_leccion_9h.json", Plan)))


# Dependencias


def test_ciclo_nombra_las_dos_claves() -> None:
    plan = fijo("plan_ok.json", Plan)
    plan.lecciones[0].depende_de = ["L2"]
    errores = comprobar(plan)
    assert len(errores) == 1 and "L1" in errores[0] and "L2" in errores[0]


def test_orden_desempata_por_posicion() -> None:
    o = orden(fijo("plan_medido.json", Plan))
    assert o.index("L2") < o.index("L10")
    assert o[0] == "L1" and o[-1] == "L12"


# Calendario: los casos de «Probar el calendarizador»


def cal(reglas: ReglasCalendario, desde=HOY, plazo=None):
    return calendarizar(fijo("plan_medido.json", Plan), SEMANA, INICIOS, desde, plazo, {}, reglas)


def test_base() -> None:
    c = cal(ReglasCalendario())
    assert isinstance(c, Calendario) and c.dias == 22 and c.fin == date(2026, 12, 8)


def test_dia_nuevo_por_leccion() -> None:
    c = cal(ReglasCalendario(dia_nuevo_por_leccion=True))
    assert isinstance(c, Calendario) and c.dias == 23


def test_con_holgura_no_cabe() -> None:
    c = cal(ReglasCalendario(holgura=0.15), plazo=date(2026, 12, 8))
    assert isinstance(c, NoCabe) and c.horas_faltan == 4.95


def test_atraso() -> None:
    c = cal(ReglasCalendario(), desde=date(2026, 11, 12))
    assert isinstance(c, Calendario) and c.fin == date(2026, 12, 11)


def test_plan_ok_en_ocho_dias() -> None:
    plan = fijo("plan_ok.json", Plan)
    c = calendarizar(plan, SEMANA, INICIOS, HOY, date(2026, 12, 8), {}, ReglasCalendario(0.15))
    assert isinstance(c, Calendario) and c.dias == 8 and c.fin == date(2026, 11, 18)
    assert c.sesiones[0].inicio == time(18) and a_hora("18:00") == time(18)


def test_hechas_no_se_reprograman() -> None:
    plan = fijo("plan_ok.json", Plan)
    c = calendarizar(plan, SEMANA, INICIOS, HOY, None, {"L1": 3, "L2": 1.5}, ReglasCalendario())
    assert isinstance(c, Calendario)
    assert "L1" not in {s.clave for s in c.sesiones}
    assert sum(s.horas for s in c.sesiones if s.clave == "L2") == 1.5


# Propiedades


@st.composite
def planes(draw):
    n = draw(st.integers(1, 20))
    lecciones = []
    for i in range(n):
        previas = [f"L{j + 1}" for j in range(i)]
        deps = draw(st.lists(st.sampled_from(previas), unique=True, max_size=3)) if previas else []
        lecciones.append(
            {
                "clave": f"L{i + 1}",
                "titulo": f"Lección {i + 1}",
                "objetivos": ["Explicar algo"],
                "conceptos": [{"id": f"c{i + 1}", "nombre": "c"}],
                "horas": draw(st.sampled_from([0.5, 1, 1.5, 2, 2.5, 3, 4])),
                "depende_de": deps,
            }
        )
    draw(st.randoms()).shuffle(lecciones)
    return Plan.model_validate({"razonamiento": "x", "lecciones": lecciones})


@settings(max_examples=150, deadline=None)
@given(
    plan=planes(),
    disp=st.lists(st.sampled_from([0, 0.5, 1, 1.5, 2, 3]), min_size=7, max_size=7).filter(lambda d: sum(d) > 0),
    horas_inicio=st.lists(st.one_of(st.none(), st.integers(6, 20)), min_size=7, max_size=7),
)
def test_propiedades(plan, disp, horas_inicio) -> None:
    inicios = [time(h) if h is not None else None for h in horas_inicio]
    c = calendarizar(plan, disp, inicios, HOY, None, {}, ReglasCalendario())
    assert isinstance(c, Calendario)
    por_dia: dict[date, float] = {}
    for s in c.sesiones:
        por_dia[s.fecha] = por_dia.get(s.fecha, 0) + s.horas
    for d, h in por_dia.items():
        assert h <= disp[d.weekday()] + 1e-6
    for s in c.sesiones:
        if s.inicio is not None:
            inicio = inicios[s.fecha.weekday()]
            assert inicio is not None
            fin_franja = inicio.hour * 60 + inicio.minute + disp[s.fecha.weekday()] * 60
            assert s.inicio.hour * 60 + s.inicio.minute + s.horas * 60 <= fin_franja + 1e-6
    primera: dict[str, int] = {}
    ultima: dict[str, int] = {}
    for i, s in enumerate(c.sesiones):
        primera.setdefault(s.clave, i)
        ultima[s.clave] = i
    for lec in plan.lecciones:
        for d in lec.depende_de:
            assert ultima[d] < primera[lec.clave]
    assert abs(sum(s.horas for s in c.sesiones) - plan.total_horas) < 0.05


def test_nombre_corto_del_tema() -> None:
    from magister.datos.plan import nombre_corto

    largo = ("Conceptos que un fullstack senior debe dominar (mapa de bloques: red/web, backend y APIs, bases de datos, "
             "arquitectura, frontend, seguridad, DevOps, calidad)")
    assert nombre_corto(largo) == "Conceptos que un fullstack senior debe dominar"
    assert nombre_corto("Redes") == "Redes" and len(nombre_corto("palabra " * 20)) <= 60
