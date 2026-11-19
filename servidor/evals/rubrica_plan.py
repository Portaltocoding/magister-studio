"""Rúbrica de los planes de estudio y de los roadmaps de proyecto que genera Magister.

Lo que se puede mirar por código, por código (sin modelo, con tests):

- Plan: orden de prerrequisitos (dependencias declaradas y conceptos, y que el calendario no ponga una lección antes de
  la suya: `evals.comprobaciones`), carga razonable (ningún día por encima de sus horas, ninguna sesión de más de
  SESION_MAX horas, cada lección entre 0,5 h y el máximo), objetivos con verbos observables (accionables) y cobertura
  de mínimos: los términos de `debe_cubrir` del banco, puestos a mano, salen en el plan.
- Roadmap: cada paso completo y comprobable (`proyectos.roadmap.errores_paso`: qué haces, antes, hecho si y de 10 a
  240 minutos), bloques de 2 a 6 pasos y sin pasar de CARGA_BLOQUE minutos, niveles con objetivos distintos y la
  misma cobertura de mínimos.

El juez (plantilla `juez_plan`, tarea `juez`) solo para lo que el código no ve: si cubre lo esencial del objetivo, si
el orden tiene sentido más allá de lo declarado y si cada paso se puede empezar sin preguntar. Da un veredicto por
criterio con una cita literal; si su salida no valida, falta un criterio o una cita no está en el texto, es
`FalloJuez` (no cuenta), nunca un suspenso.

Genera con el modelo de verdad (gasta cuota): `planificar` para los planes y `proyecto_roadmap` para los roadmaps,
cada uno con sus reintentos. Solo a mano.

    uv run python -m evals.rubrica_plan                       corto: 1 plan y 1 roadmap, con juez (unas 4 llamadas, tope 10)
    uv run python -m evals.rubrica_plan --nivel completo      4 planes y 2 roadmaps (unas 12 llamadas, tope 36)
    uv run python -m evals.rubrica_plan --sin-juez            solo lo que mira el código (la mitad de llamadas)

Sin cuota: `MAGISTER_MOTOR=eco` (el plan sale de tests/fijos y el juez del eco no tiene fijo: FalloJuez).
"""

import argparse
import re
import unicodedata
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

from evals import comprobaciones as c
from evals import regresion, tope
from evals.comprobaciones import Resultado

BANCO = Path(__file__).parent / "banco" / "rubrica-plan-v1.yaml"
HOY = date(2026, 11, 19)
SESION_MAX = 3.0  # horas: una sesión más larga no se sostiene de una sentada
CARGA_BLOQUE = 600  # minutos: un bloque de más de 10 h no es un bloque
CORTO = {"planes": ["derivadas"], "roadmaps": ["agente-aws"]}
TOPES = {"corto": 10, "completo": 36}
CRITERIOS = ("cobertura", "orden", "accionable")


# --- Cobertura de mínimos y textos ----------------------------------------------------------------------------------


def normal(t: str) -> str:
    t = unicodedata.normalize("NFKD", (t or "").lower())
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    return " ".join(re.sub(r"[^a-z0-9ñ\-]+", " ", t).split())


def cobertura_terminos(terminos: list[str], texto: str) -> tuple[int, int, list[str]]:
    """(cubiertos, total, los que faltan). «a|b»: vale cualquiera; se busca como inicio de palabra («aprob» vale por
    «aprobación»), sin tildes ni mayúsculas."""
    plano = " " + normal(texto)
    faltan = [t for t in terminos if not any(f" {normal(x)}" in plano for x in t.split("|"))]
    return len(terminos) - len(faltan), len(terminos), faltan


def texto_plan(plan: dict, sesiones: list[dict] | None = None) -> str:
    """El plan como lo ve el alumno (y el juez): lecciones con horas, dependencias, objetivos y conceptos."""
    lineas = []
    for lec in plan.get("lecciones", []):
        deps = ", ".join(lec.get("depende_de") or []) or "ninguna"
        lineas.append(f"{lec['clave']}. {lec['titulo']} ({lec['horas']:g} h; depende de: {deps})")
        lineas += [f"  - {o}" for o in lec.get("objetivos") or []]
        conceptos = ", ".join(x["nombre"] for x in lec.get("conceptos") or [])
        if conceptos:
            lineas.append(f"  Conceptos: {conceptos}")
    if sesiones:
        lineas.append("Calendario: " + "; ".join(f"{s['fecha']} {s['clave']} {s['horas']:g} h" for s in sesiones))
    return "\n".join(lineas)


def texto_roadmap(r: dict) -> str:
    lineas = [r.get("resumen", ""), f"Arquitectura: {r.get('arquitectura', '')}"]
    for n in r.get("niveles", []):
        lineas.append(f"Nivel {n['numero']}: {n['titulo']}. Objetivo: {n['objetivo']}")
        for b in n["bloques"]:
            lineas.append(f"  Bloque: {b['titulo']}. {b['priming']}")
            for p in b["pasos"]:
                lineas.append(f"    Paso: {p['titulo']} ({p['minutos']} min). Qué haces: {p['que_haces']} Antes: {p['antes']} "
                              f"Hecho si: {p['hecho_si']}")
    return "\n".join(x for x in lineas if x)


# --- Comprobaciones por código --------------------------------------------------------------------------------------


def comprobar_plan(caso: dict, perfil, plan, sesiones: list[dict], reglas) -> dict[str, Resultado]:
    """`perfil` y `plan`: los modelos de `plan.esquemas`; `sesiones`: las de calendarizar (dicts)."""
    from magister.plan.calendario import Calendario, Sesion

    cal = Calendario([Sesion(date.fromisoformat(s["fecha"]), None, s["clave"], s["horas"]) for s in sesiones]) if sesiones else None
    largas = [f"{s['fecha']} {s['clave']} {s['horas']:g} h" for s in sesiones if s["horas"] > SESION_MAX + 1e-6]
    k, n, faltan = cobertura_terminos(caso.get("debe_cubrir") or [], texto_plan(plan.model_dump()))
    return {
        "orden_dependencias": c.dependencias_y_conceptos(caso, perfil, plan, cal),
        "orden_calendario": c.orden_en_calendario(caso, perfil, plan, cal),
        "carga_dia": c.dias_dentro_de_capacidad(caso, perfil, plan, cal),
        "carga_sesion": Resultado(bool(sesiones) and not largas, "; ".join(largas) or ("" if sesiones else "sin calendario")),
        "horas_leccion": c.horas_por_leccion(caso, perfil, plan, cal, reglas),
        "accionable": c.verbos_observables(caso, perfil, plan, cal),
        "cobertura_minimos": Resultado(not faltan, f"{k}/{n}; faltan: {', '.join(faltan)}" if faltan else f"{k}/{n}"),
    }


def comprobar_roadmap(caso: dict, r: dict) -> dict[str, Resultado]:
    """`r`: el roadmap montado (`proyectos.roadmap.montar`). Solo cuentan los pasos de los niveles detallados."""
    from magister.proyectos.roadmap import PasoGen, errores_paso

    pasos = [p for n in r.get("niveles", []) for b in n["bloques"] for p in b["pasos"]]
    malos = [e for p in pasos for e in errores_paso(PasoGen(**{k: p[k] for k in PasoGen.model_fields}))]
    bloques_mal, cargados = [], []
    for n in r.get("niveles", []):
        for b in n["bloques"]:
            if n.get("detallado") and not 2 <= len(b["pasos"]) <= 6:
                bloques_mal.append(f"«{b['titulo']}» con {len(b['pasos'])} pasos")
            total = sum(p["minutos"] for p in b["pasos"])
            if total > CARGA_BLOQUE:
                cargados.append(f"«{b['titulo']}» {total} min")
    objetivos = [normal(n["objetivo"]) for n in r.get("niveles", [])]
    k, total, faltan = cobertura_terminos(caso.get("debe_cubrir") or [], texto_roadmap(r))
    return {
        "pasos_accionables": Resultado(bool(pasos) and not malos, "; ".join(malos[:4]) or ("" if pasos else "sin pasos")),
        "tamano_bloques": Resultado(not bloques_mal, "; ".join(bloques_mal)),
        "carga_bloque": Resultado(not cargados, "; ".join(cargados)),
        "niveles_distintos": Resultado(len(set(objetivos)) == len(objetivos), "dos niveles con el mismo objetivo"
                                       if len(set(objetivos)) != len(objetivos) else ""),
        "cobertura_minimos": Resultado(not faltan, f"{k}/{total}; faltan: {', '.join(faltan)}" if faltan else f"{k}/{total}"),
    }


# --- El juez --------------------------------------------------------------------------------------------------------


class Criterio(BaseModel):
    criterio: Literal["cobertura", "orden", "accionable"]
    razon: str = Field(description="Primero la razón, en una o dos frases")
    cumple: bool = Field(description="Después el veredicto")
    cita: str = Field(description="Un trozo literal del plan o del roadmap, de 3 a 20 palabras")


class JuicioPlan(BaseModel):
    criterios: list[Criterio] = Field(min_length=3, max_length=3)


def validar_juicio(j: JuicioPlan, texto: str):
    """El juicio si vale; si no, `FalloJuez` con el porqué (nunca un suspenso)."""
    from magister.tono.juez import FalloJuez

    nombres = [x.criterio for x in j.criterios]
    if sorted(nombres) != sorted(CRITERIOS):
        return FalloJuez(f"criterios {nombres}: tiene que haber uno de cada ({', '.join(CRITERIOS)})")
    plano = normal(texto)
    for x in j.criterios:
        cita = normal(x.cita)
        if len(cita.split()) < 3 or cita not in plano:
            return FalloJuez(f"la cita de {x.criterio} no aparece literal en el texto: «{x.cita[:60]}»")
    return j


async def juzgar(objetivo: str, texto: str, que: str):
    from magister.cerebro.estructura import ErrorEstructura, estructurar
    from magister.cerebro.prompts import cargar
    from magister.tono.juez import FalloJuez

    entrada = f"OBJETIVO:\n{objetivo}\n\n{que.upper()}:\n<texto>\n{texto}\n</texto>\n\nDevuelve los tres criterios."
    try:
        j = await estructurar(cargar("juez_plan").texto, entrada, JuicioPlan, reintentos=1, tarea="juez")
    except ErrorEstructura as e:
        return FalloJuez(f"sin veredicto válido: {e}")
    return validar_juicio(j, texto)


# --- Generar y medir ------------------------------------------------------------------------------------------------


def cargar_banco(ruta: Path = BANCO) -> dict:
    with open(ruta, encoding="utf-8") as f:
        banco = yaml.safe_load(f)
    for x in banco.get("planes", []) + banco.get("roadmaps", []):
        if not x.get("debe_cubrir"):
            raise ValueError(f"{x.get('id')}: le falta debe_cubrir")
    return banco


def perfil_de(caso: dict, hoy: date = HOY) -> dict:
    horas = caso["horas_por_dia"]
    return {"tema": caso["tema"], "objetivo": caso["objetivo"], "nivel": caso["nivel"], "horas_por_dia": horas,
            "inicio_por_dia": ["18:00" if h else None for h in horas], "plazo": (hoy + timedelta(days=caso["plazo_dias"])).isoformat(),
            "sin_plazo": False, "preferencias": None, "notas": None}


async def un_plan(caso: dict, con_juez: bool) -> dict:
    from magister.flujo.comun import reglas_plan
    from magister.flujo.nodos.calendarizar import calendarizar
    from magister.flujo.nodos.planificar import planificar
    from magister.plan.esquemas import Perfil, Plan

    estado = {"perfil": perfil_de(caso), "hoy": HOY.isoformat()}
    r = await planificar(estado)
    if not r.get("plan"):
        return {"id": caso["id"], "sin_salida": r.get("salida"), "errores": (r.get("errores") or [])[-3:]}
    cal = await calendarizar({**estado, "plan": r["plan"]})
    sesiones = cal.get("sesiones") or []
    plan = Plan.model_validate(r["plan"])
    res = comprobar_plan(caso, Perfil.model_validate(estado["perfil"]), plan, sesiones, reglas_plan())
    juicio = await juzgar(caso["objetivo"], texto_plan(r["plan"], sesiones), "plan") if con_juez else None
    return {"id": caso["id"], "codigo": res, "juicio": juicio}


async def un_roadmap(caso: dict, con_juez: bool) -> dict:
    from magister.cerebro.estructura import ErrorEstructura
    from magister.proyectos.roadmap import generar_roadmap

    try:
        r = await generar_roadmap({k: caso.get(k) for k in ("nombre", "idea", "objetivo", "sabes", "ritmo")}, [])
    except ErrorEstructura as e:
        return {"id": caso["id"], "sin_salida": "roadmap", "errores": [str(e)[:200]]}
    res = comprobar_roadmap(caso, r)
    juicio = await juzgar(f"{caso['idea']} Para qué: {caso['objetivo']}", texto_roadmap(r), "roadmap") if con_juez else None
    return {"id": caso["id"], "codigo": res, "juicio": juicio}


def metricas(filas: list[dict]) -> dict:
    """Por comprobación y por criterio del juez: sí o no por caso. Lo que no generó nada cuenta como fallo de todas las
    de código («genera»); un FalloJuez no cuenta en las del juez."""
    from magister.tono.juez import FalloJuez

    m: dict[str, dict] = {"genera": regresion.proporcion({f["clave"]: (int("codigo" in f), 1) for f in filas})}
    nombres = sorted({k for f in filas for k in f.get("codigo", {})})
    for nombre in nombres:
        m[f"codigo.{nombre}"] = regresion.proporcion({f["clave"]: (int(f["codigo"][nombre].ok), 1)
                                                      for f in filas if nombre in f.get("codigo", {})})
    juzgadas = [f for f in filas if f.get("juicio") is not None]
    if juzgadas:
        m["juez_valido"] = regresion.proporcion({f["clave"]: (int(not isinstance(f["juicio"], FalloJuez)), 1) for f in juzgadas})
        for crit in CRITERIOS:
            m[f"juez.{crit}"] = regresion.proporcion({
                f["clave"]: (int(next(x.cumple for x in f["juicio"].criterios if x.criterio == crit)), 1)
                for f in juzgadas if not isinstance(f["juicio"], FalloJuez)})
    return {k: v for k, v in m.items() if v["por_caso"]}


def imprimir(f: dict) -> None:
    from magister.tono.juez import FalloJuez

    if "codigo" not in f:
        print(f"  {f['clave']}: SIN SALIDA ({f.get('sin_salida')}) {f.get('errores')}")
        return
    mal = {k: r.detalle for k, r in f["codigo"].items() if not r.ok}
    print(f"  {f['clave']}: código {len(f['codigo']) - len(mal)}/{len(f['codigo'])}" + (f" · falla {mal}" if mal else ""))
    j = f.get("juicio")
    if isinstance(j, FalloJuez):
        print(f"    juez: FalloJuez ({j.motivo[:120]})")
    elif j is not None:
        for x in j.criterios:
            print(f"    juez {x.criterio}: {'sí' if x.cumple else 'NO'} · {x.razon[:120]} · «{x.cita[:60]}»")


async def principal(args) -> None:
    from magister.config import ajustes

    t = args.tope
    banco = cargar_banco(args.banco)
    planes = tope.del_nivel(banco.get("planes", []), args.nivel, CORTO["planes"] if args.banco == BANCO else 1)
    roadmaps = tope.del_nivel(banco.get("roadmaps", []), args.nivel, CORTO["roadmaps"] if args.banco == BANCO else 1)
    print(f"rubrica_plan · nivel {args.nivel} · {len(planes)} planes y {len(roadmaps)} roadmaps · juez "
          f"{'no' if args.sin_juez else 'sí'} · motor={ajustes.motor} modelo={ajustes.modelo}")
    filas = []
    trabajos = [("plan", x, un_plan) for x in planes] + [("roadmap", x, un_roadmap) for x in roadmaps]
    for que, caso, hacer in trabajos:
        if not t.cabe(1 if args.sin_juez else 2):
            t.cortado = True
            break
        try:
            f = await hacer(caso, not args.sin_juez)
        except tope.TopeAlcanzado:
            break
        f["clave"] = f"{que}/{caso['id']}"
        filas.append(f)
        imprimir(f)
    if not filas:
        return
    print()
    for nombre, m in metricas(filas).items():
        r = regresion.resumir(m)
        print(f"{nombre:<30} {r['k']}/{r['n']} ({r['valor']:.0%}, IC 95 % {r['ic'][0]:.0%}-{r['ic'][1]:.0%})")
    prompts = ["planificar", "proyecto_roadmap"] + ([] if args.sin_juez else ["juez_plan"])
    ej = regresion.ejecucion("rubrica_plan", args.nivel, regresion.versiones(prompts), metricas(filas), t,
                             regresion.huella(args.banco), extra={"sin_juez": args.sin_juez})
    print(f"\nGuardada para comparar: {regresion.guardar(ej)}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Rúbrica de planes y roadmaps generados (gasta cuota).")
    ap.add_argument("--banco", type=Path, default=BANCO)
    ap.add_argument("--sin-juez", action="store_true", help="solo las comprobaciones por código")
    tope.argumentos(ap, **TOPES)
    args = ap.parse_args(argv)
    args.tope = tope.de_args(args)
    tope.correr(principal(args), args.tope)


if __name__ == "__main__":
    main()
