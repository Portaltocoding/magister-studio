"""Los criterios de un buen plan como funciones puras. Ninguna llama al modelo.

Firma común: (caso, perfil, plan, calendario) -> Resultado(ok, detalle).
"""

import unicodedata
from dataclasses import dataclass
from datetime import date, timedelta

from magister.plan.calendario import Calendario, NoCabe
from magister.plan.dependencias import comprobar
from magister.plan.esquemas import Perfil, Plan
from magister.plan.reglas import ReglasPlan, error_capacidad, presupuesto

VERBOS_NO_OBSERVABLES = {"entender", "comprender", "conocer", "saber", "aprender", "familiarizarse", "ver"}
TOLERANCIA_PLAZO = 3  # días; «un mes» no es exacto (criterio general)


@dataclass
class Resultado:
    ok: bool
    detalle: str = ""


def _norm(texto: str) -> str:
    sin = unicodedata.normalize("NFKD", texto.lower())
    return "".join(c for c in sin if not unicodedata.combining(c)).strip()


# Plan


def esquema(caso, perfil, plan, cal) -> Resultado:
    if plan is None:
        return Resultado(False, "sin plan")
    try:
        Plan.model_validate(plan.model_dump())
    except Exception as e:  # noqa: BLE001
        return Resultado(False, str(e))
    return Resultado(True)


def capacidad_con_holgura(caso, perfil: Perfil, plan: Plan | None, cal, hoy: date, reglas: ReglasPlan) -> Resultado:
    if plan is None:
        return Resultado(False, "sin plan")
    e = error_capacidad(plan, presupuesto(perfil, hoy, reglas.holgura))
    return Resultado(e is None, e or "")


def dependencias_y_conceptos(caso, perfil, plan: Plan | None, cal) -> Resultado:
    if plan is None:
        return Resultado(False, "sin plan")
    errores = comprobar(plan)
    return Resultado(not errores, "; ".join(errores))


def dias_dentro_de_capacidad(caso, perfil: Perfil, plan, cal: Calendario | None) -> Resultado:
    if not isinstance(cal, Calendario):
        return Resultado(False, "sin calendario")
    horas = perfil.horas_por_dia or [0] * 7
    por_dia: dict[date, float] = {}
    for s in cal.sesiones:
        por_dia[s.fecha] = por_dia.get(s.fecha, 0) + s.horas
    malos = [d.isoformat() for d, h in por_dia.items() if h > horas[d.weekday()] + 1e-6]
    return Resultado(not malos, ", ".join(malos))


def orden_en_calendario(caso, perfil, plan: Plan | None, cal: Calendario | None) -> Resultado:
    if plan is None or not isinstance(cal, Calendario):
        return Resultado(False, "sin calendario")
    primera: dict[str, int] = {}
    ultima: dict[str, int] = {}
    for i, s in enumerate(cal.sesiones):
        primera.setdefault(s.clave, i)
        ultima[s.clave] = i
    malos = [
        f"{lec.clave} antes que {d}"
        for lec in plan.lecciones
        for d in lec.depende_de
        if d in ultima and lec.clave in primera and ultima[d] > primera[lec.clave]
    ]
    return Resultado(not malos, "; ".join(malos))


def verbos_observables(caso, perfil, plan: Plan | None, cal) -> Resultado:
    if plan is None:
        return Resultado(False, "sin plan")
    malos = [
        f"{lec.clave}: «{o}»"
        for lec in plan.lecciones
        for o in lec.objetivos
        if _norm(o.split()[0]) in VERBOS_NO_OBSERVABLES
    ]
    return Resultado(not malos, "; ".join(malos))


def horas_por_leccion(caso, perfil, plan: Plan | None, cal, reglas: ReglasPlan) -> Resultado:
    if plan is None:
        return Resultado(False, "sin plan")
    malos = [lec.clave for lec in plan.lecciones if not (0.5 <= lec.horas <= reglas.horas_max_leccion)]
    return Resultado(not malos, ", ".join(malos))


def comportamiento(caso: dict, final: str) -> Resultado:
    """`final` es cabe (hubo propuesta), no_cabe (negociar) o pregunta (preguntar)."""
    esperado = caso.get("espera", "cabe")
    return Resultado(final == esperado, f"esperaba {esperado}, hizo {final}")


# Perfil


def perfil_exacto(caso: dict, perfil: Perfil, hoy: date) -> dict[str, Resultado]:
    esperado = caso.get("perfil_esperado") or {}
    r: dict[str, Resultado] = {}
    for campo in ("nivel", "horas_por_dia", "inicio_por_dia"):
        if campo in esperado:
            real = getattr(perfil, campo)
            r[campo] = Resultado(real == esperado[campo], f"{real} frente a {esperado[campo]}")
    if "plazo_dias" in esperado:
        objetivo = hoy + timedelta(days=esperado["plazo_dias"] - 1)
        ok = perfil.plazo is not None and abs((perfil.plazo - objetivo).days) <= TOLERANCIA_PLAZO
        r["plazo"] = Resultado(ok, f"{perfil.plazo} frente a {objetivo}")
    if "tema" in caso:
        r["tema"] = Resultado(_norm(caso["tema"]) in _norm(perfil.tema or ""), str(perfil.tema))
    return r


def no_cabe_es_correcto(cal) -> bool:
    return isinstance(cal, NoCabe)
