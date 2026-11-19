"""Harness a mano del asesor que hace cosas (ADR-0017), con el modelo de verdad.

    uv run python -m evals.asesor agente [N ...]    el agente que prepara cambios: 7 encargos (3 del plan de estudio), y
                                                    qué decide en cada vuelta (corto: encargos 1 y 5, tope 18 llamadas;
                                                    --nivel completo: los 7, tope 70)
    uv run python -m evals.asesor chat              de punta a punta por la API: si el asesor sabe cuándo ofrecer un cambio
                                                    (corto: 3 mensajes, tope 15; completo: 7, tope 45)
    uv run python -m evals.asesor plan              el plan de estudio y la agenda, PUNTUADO por código y SIN base
                                                    (corto: 3 mensajes y 3 encargos, tope 15; completo: 9 y 9, tope 90)
    uv run python -m evals.asesor plan --solo decidir|agente

Es un harness a mano, como `evals.tono` y `evals.fidelidad`: llama a `claude -p` de verdad y GASTA CUOTA. Cada modo
tiene un tope duro de llamadas (`--max-llamadas`); al llegar, corta limpio y dice cuántas ha hecho.
Los modos `agente` y `chat` usan la base de PRUEBAS (`ajustes.db_url_pruebas`), nunca la real, y la VACÍAN antes de
empezar: borran las tablas `notas` y `proyectos` (y `conversaciones` en el modo `chat`) y siembran un proyecto de
ejemplo. En el modo `agente` borran también `temas` y `planes` (con lo que cuelga de ellos) y siembran un plan de
Cálculo para el 19-11-2026. Esos dos no deciden aprobado o suspenso: imprimen lo que hace el asesor para que lo leas tú.
El modo `plan` no toca ninguna base (el plan va en memoria) y sí puntúa: ver más abajo; guarda la ejecución para
`evals.regresion`.
"""

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import date

import httpx
from sqlalchemy import text

from magister.api.app import app
from magister.asesor import agente as ag
from magister.config import ajustes
from magister.datos import sesion
from magister.datos.notas import Nota
from magister.datos.proyectos import Decision, Proyecto
from magister.flujo.grafo import iniciar
from magister.proyectos import roadmap as rm

MOMENTO = "2026-11-19T10:00:00+00:00"


def paso(t, que, antes, hecho, minutos=45):
    return rm.PasoGen(titulo=t, que_haces=que, antes=antes, hecho_si=hecho, minutos=minutos)


def roadmap() -> dict:
    r = rm.RoadmapGen(
        resumen="Un agente que lee tu cuenta AWS de pruebas y propone un plan de ahorro sin tocar nada.",
        que_es="Un agente de auditoría de costes.", por_que="Demuestra que sabes hacer agentes seguros.",
        glosario=[rm.Termino(termino=t, definicion="…") for t in ("Agente", "Plan", "Cuenta")],
        arquitectura="Agente, herramientas de lectura y plan.",
        niveles=[
            rm.NivelGen(titulo="Solo lee", objetivo="Lee la cuenta y propone un plan de ahorro sin tocar nada.",
                        priming="Primero mirar, sin poder romper nada.", bloques=[
                rm.BloqueGen(titulo="La cuenta", priming="Una cuenta de pruebas blindada antes de escribir código.", pasos=[
                    paso("Crea la cuenta y blíndala", "Crea la cuenta de AWS, activa MFA en root y crea un usuario administrador.",
                         "El usuario root no se puede limitar: por eso se trabaja con otro usuario.", "aws sts get-caller-identity devuelve tu usuario administrador"),
                    paso("Alarmas de gasto", "Crea un presupuesto de 5 dólares con aviso por correo.",
                         "AWS cobra por uso: un presupuesto avisa antes de que se dispare.", "El presupuesto aparece en Billing y llega el correo de confirmación")]),
                rm.BloqueGen(titulo="Leer recursos", priming="Las herramientas de solo lectura del agente.", pasos=[
                    paso("Lista instancias con boto3", "Escribe una función que devuelve las instancias EC2 con tipo y estado.",
                         "boto3 es el SDK de AWS para Python; describe_instances devuelve las instancias.", "python listar.py imprime las instancias de la cuenta"),
                    paso("Lee la CPU de CloudWatch", "Escribe get_cpu_stats: CPU media y máxima de una instancia en 14 días.",
                         "CloudWatch guarda las métricas; CPUUtilization es la de CPU.", "get_cpu_stats devuelve dos números para una instancia que existe")]),
            ]),
            rm.NivelGen(titulo="Aprobar y aplicar", objetivo="Aplica el plan en dry-run tras tu aprobación y lo registra.",
                        priming="Después, tocar con permiso.",
                        bloques=[rm.BloqueGen(titulo="Plan y arnés", priming="El plan se aprueba fuera del agente antes de aplicarlo.")]),
        ],
        riesgos=[rm.Riesgo(riesgo="Coste", mitigacion="Un presupuesto con avisos."), rm.Riesgo(riesgo="Borrar algo", mitigacion="Primero en dry-run.")])
    return rm.montar(r)


DOC = ("Mi documento: Día 2, boto3 + moto. Con el decorador @mock_aws (moto 5), boto3 habla con un AWS falso en memoria: coste cero y "
       "riesgo cero. Hecho cuando un test con moto encuentra un disco suelto que tú has creado. Día 5, plan + harness: apply en "
       "dry-run y audit log en JSONL de solo añadir; aplicar un plan sin aprobar falla y aplicarlo dos veces no hace nada.")

ESCENARIOS = [
    ("sin lecturas (el contenido está en la conversación)",
     "Añadir al nivel n1 un bloque nuevo para probar sin coste, con lo que falta del documento que ha pegado: los tests con moto y el dry-run con registro de auditoría.",
     [{"rol": "usuario", "contenido": DOC}, {"rol": "usuario", "contenido": "puedes añadir todo esto al proyecto?"}]),
    ("debería buscar en notas",
     "Añadir al bloque n1-b2 un paso con lo que apuntó en sus notas sobre las métricas de CPU en moto.",
     [{"rol": "usuario", "contenido": "añade lo que apunté en mis notas sobre las métricas de CPU con moto"}]),
    ("reestructurar sin lecturas",
     "Reordenar el bloque n1-b1: las alarmas de gasto antes de crear la cuenta no, al revés no: poner «Alarmas de gasto» primero. Renombrar el bloque n1-b2 a «Herramientas de lectura» y mover el nivel de aplicar tal cual.",
     [{"rol": "usuario", "contenido": "pon las alarmas de gasto lo primero y llama al segundo bloque Herramientas de lectura"}]),
    ("no se puede",
     "Borrar el proyecto entero y crear otro nuevo sobre Kubernetes.",
     [{"rol": "usuario", "contenido": "borra este proyecto y créame uno de kubernetes"}]),
    # Los del plan de estudio (el 19-11-2026 es jueves; el sábado no tiene horas). El cuarto elemento: con el plan.
    ("plan: mover una sesión",
     "Mover la sesión de L3 (Integrales) del viernes 20 al lunes 23.",
     [{"rol": "usuario", "contenido": "el viernes no puedo, pásame integrales al lunes"}], True),
    ("plan: marcar, preparar y apuntar",
     "Marcar L1 (Límites) como hecha, preparar los apuntes de L2 y apuntar el examen parcial de cálculo el viernes 27 a las 10:00.",
     [{"rol": "usuario", "contenido": "límites ya lo tengo, prepárame derivadas y apúntame el parcial del viernes 27 a las 10"}], True),
    ("plan: no cabe (el sábado no estudia y L3 depende de L2)",
     "Mover la sesión de L2 (Derivadas) al sábado 21 por la mañana.",
     [{"rol": "usuario", "contenido": "pásame derivadas al sábado por la mañana"}], True),
]


async def sembrar_plan() -> dict | None:
    """Un plan de Cálculo como el de los tests: 2 h de lunes a viernes desde las 17:00; L2 depende de L1 y L3 de L2."""
    from magister.asesor import arnes
    from magister.datos import plan as dp

    lecciones = [{"clave": c, "titulo": t, "objetivos": ["Explicar algo"], "conceptos": [{"id": f"c-{c.lower()}", "nombre": t}],
                  "horas": h, "depende_de": d} for c, t, h, d in (("L1", "Límites", 1, []), ("L2", "Derivadas", 1, ["L1"]),
                                                                  ("L3", "Integrales", 2, ["L2"]))]
    sesiones = [{"clave": "L1", "fecha": "2026-11-19", "inicio": "17:00", "horas": 1},
                {"clave": "L2", "fecha": "2026-11-19", "inicio": "18:00", "horas": 1},
                {"clave": "L3", "fecha": "2026-11-20", "inicio": "17:00", "horas": 2}]
    perfil = {"horas_por_dia": [2, 2, 2, 2, 2, 0, 0], "inicio_por_dia": ["17:00"] * 5 + [None, None]}
    _, plan_id = await dp.guardar_plan("Cálculo", None, perfil, {"razonamiento": "x", "lecciones": lecciones}, sesiones, None, None)
    return await arnes.leer_plan(plan_id, date(2026, 11, 19))


async def correr_agente(solo: list[str]) -> None:
    print(f"motor={ajustes.motor} modelo={ajustes.modelo} vueltas={ajustes.asesor_vueltas}")
    sesion.configurar(ajustes.db_url_pruebas)
    async with sesion.nueva_sesion() as s, s.begin():
        await s.execute(text("TRUNCATE notas, proyectos, temas, planes RESTART IDENTITY CASCADE"))
        p = Proyecto(nombre="Copiloto cloud agéntico", idea="Un agente que audita AWS.", estado="listo", roadmap=roadmap())
        s.add(p)
        await s.flush()
        pid = p.id
        s.add(Decision(proyecto_id=pid, titulo="Todo contra moto en el nivel 1", decision="Nada contra AWS real hasta el nivel 2."))
        s.add(Nota(texto="Ojo: moto no genera métricas de CPU por sí solo. Hay que sembrarlas con cloudwatch.put_metric_data y "
                         "fechas pasadas, y poner credenciales falsas (AWS_ACCESS_KEY_ID=testing) para que nada salga a AWS real."))
        s.add(Nota(texto="Receta de lentejas: sofrito, chorizo y 40 minutos."))
    proyecto = {"nombre": "Copiloto cloud agéntico", "roadmap": roadmap(), "hechos": [], "hechos_en": {}}
    plan = await sembrar_plan()

    original = ag.estructurar

    async def espiado(sistema, entrada, Modelo, reglas=None, **kw):
        intentos: list = []
        t0 = time.perf_counter()
        try:
            salida = await original(sistema, entrada, Modelo, reglas=reglas, intentos=intentos, **kw)
        finally:
            for i in intentos:
                print(f"    intento rechazado: {i.errores[:3]}")
        que = "cambios" if salida.cambios else "leer" if salida.leer else "no_se_puede"
        print(f"    vuelta: {que} en {time.perf_counter() - t0:.0f}s · falta: {salida.falta[:140]}")
        return salida

    ag.estructurar = espiado
    try:
        for i, (nombre, encargo, turnos, *con_plan) in enumerate(ESCENARIOS, 1):
            if solo and str(i) not in solo:
                continue
            print(f"\n=== {i}. {nombre}\n    encargo: {encargo}")
            t0 = time.perf_counter()
            try:
                async for que, dato in ag.preparar(encargo, turnos, proyecto, pid, date(2026, 11, 19), MOMENTO,
                                                   plan if con_plan else None):
                    if que == "leyendo":
                        print(f"    LEE: {dato}")
                    else:
                        cambios, resultado, _, lecturas = dato
                        print(f"    RESUMEN: {cambios.resumen}")
                        for linea in resultado.lineas:
                            print(f"    - {linea.texto}\n        ({linea.motivo})")
                        for a in cambios.acciones:
                            for x in a.pasos:
                                print(f"        paso «{x.titulo}» {x.minutos} min · hecho si: {x.hecho_si[:110]}")
            except ag.NoSePuede as e:
                print(f"    NO SE PUEDE: {e}")
            except Exception as e:  # noqa: BLE001
                print(f"    FALLO: {type(e).__name__}: {e}")
            print(f"    total {time.perf_counter() - t0:.0f}s")
    finally:
        ag.estructurar = original
        await sesion.cerrar()



def pantalla(r: dict) -> str:
    lineas = ["Copiloto cloud agéntico", "0 de 4 pasos"]
    for n in r["niveles"]:
        lineas.append(f"Nivel {n['numero']} · {n['titulo']}\n{n['objetivo']}")
        for b in n["bloques"]:
            lineas.append(b["titulo"])
            lineas += [f"{p['titulo']}\n{p['que_haces']}\nHecho si: {p['hecho_si']}" for p in b["pasos"]]
    return "\n".join(lineas)


def eventos(texto: str) -> list[tuple[str, dict]]:
    salida = []
    for bloque in texto.replace("\r\n", "\n").split("\n\n"):
        campos = dict(x.split(": ", 1) for x in bloque.splitlines() if ": " in x)
        if "event" in campos:
            salida.append((campos["event"], json.loads(campos["data"])))
    return salida


# (qué se espera, mensaje). Van seguidos, en la misma conversación.
GUION = [
    ("SIN cambio", "Explícame esta pantalla"),
    ("SIN cambio, quizá lo ofrece", f"le falta algo a este proyecto comparado con este plan? {DOC}"),
    ("CON cambio", "puedes añadir todo esto al proyecto ?"),
    ("pega + pregunta, o CON cambio", "pon las alarmas de gasto lo primero de todo"),
    ("CON cambio (reestructurar)", "sí, muévelo igualmente"),
    ("SIN cambio: dice dónde se hace", "bórrame este proyecto"),
    ("SIN cambio", "qué es IAM?"),
]


async def correr_chat(n: int | None = None) -> None:
    """`n`: solo los n primeros mensajes del guion (el nivel corto)."""
    print(f"motor={ajustes.motor}")
    sesion.configurar(ajustes.db_url_pruebas)
    iniciar(None)
    try:
        async with sesion.nueva_sesion() as s, s.begin():
            await s.execute(text("TRUNCATE notas, proyectos, conversaciones RESTART IDENTITY CASCADE"))
            p = Proyecto(nombre="Copiloto cloud agéntico", idea="Un agente que audita AWS.", estado="listo", roadmap=roadmap())
            s.add(p)
            await s.flush()
            pid = p.id
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://prueba", timeout=600) as c:
            cid = (await c.post("/api/conversaciones", json={"titulo": "Asesor · Proyectos", "tipo": "asesor"})).json()["id"]
            for esperado, mensaje in GUION[:n]:
                r = (await c.get(f"/api/proyectos/{pid}")).json()["roadmap"]
                contexto = (f"Sección: Proyectos · Copiloto cloud agéntico\nRuta: #/proyectos/{pid}\n<pantalla>\n{pantalla(r)}\n</pantalla>\n"
                            "<rutas>\n#/hoy #/proyectos #/repaso #/notas\nPasos en pantalla: "
                            + "; ".join(f"paso:{x['id']} «{x['titulo']}»" for n in r["niveles"] for b in n["bloques"] for x in b["pasos"])
                            + "\n</rutas>")
                t0 = time.perf_counter()
                resp = await c.post(f"/api/conversaciones/{cid}/mensajes",
                                    json={"contenido": mensaje, "asesor": True, "contexto": contexto, "proyecto_id": pid})
                evs = eventos(resp.text)
                texto = "".join(d["t"] for e, d in evs if e == "delta")
                print(f"\n>>> {mensaje[:90]}   [esperado: {esperado}] ({time.perf_counter() - t0:.0f}s)")
                print("    " + texto.replace("\n", "\n    "))
                for e, d in evs:
                    if e == "cambio":
                        print("    == TARJETA:", *[f"\n       - {x['texto']}" for x in d["lineas"]], f"\n       consultado: {d['consultado']}")
                        aplicado = (await c.post(f"/api/cambios/{d['id']}/aplicar")).json()
                        print(f"    == aplicado: {aplicado['estado']} nuevos={aplicado['nuevos']}")
                    elif e in ("cambio_fallido", "error"):
                        print(f"    == {e}: {d}")
    finally:
        await sesion.cerrar()


# --- Modo `plan`: el plan de estudio y la agenda, puntuado por código y sin base ------------------------------------
#
# Dos partes, las dos con un plan de Cálculo en memoria (nada de base: las lecturas del agente se sirven desde aquí):
#
# 1. decidir: el chat del asesor (el mismo prompt de sistema que en la app, `sistema_de_estudio` con `asesor`) ante un
#    mensaje. El código mira si acaba en un bloque ```cambio (`cambios.encargo_de`): cuando lo que pide está claro y
#    cabe, tiene que ofrecerlo; cuando falta algo (qué sesión, a qué día), choca con su horario o no está en la lista,
#    tiene que preguntar o decir dónde se hace, sin bloque. Una llamada por mensaje.
# 2. agente: el que prepara el cambio. El código mira que la salida sea la esperada (cambios o no_se_puede), que estén
#    las acciones esperadas con sus campos (sesión, día, hora, clave, tipo de evento), que no sobre ninguna (nada de
#    preparar apuntes «de propina»), que lea el calendario cuando el día queda fuera de las dos semanas que ya ve, y
#    cuántas veces intentó algo fuera de la lista cerrada (`TipoAccion`; el esquema lo rechaza y cuesta un reintento).

HOY_PLAN = date(2026, 11, 19)  # jueves; el sábado y el domingo no estudia
MOMENTO_PLAN = "2026-11-19T10:00:00+00:00"


def plan_fijo() -> dict:
    """Como el que lee `arnes.leer_plan`: L2 depende de L1, L3 de L2 y L4 de L3. L4 cae a más de 14 días (para verla
    hay que leer el calendario). L1 ya tiene apuntes."""
    lecciones = [("L1", "Límites", 1, [], "listos"), ("L2", "Derivadas", 1, ["L1"], None), ("L3", "Integrales", 2, ["L2"], None),
                 ("L4", "Aplicaciones de la integral", 2, ["L3"], None)]
    sesiones = [(1, "L1", "2026-11-19", "17:00", 1), (2, "L2", "2026-11-19", "18:00", 1), (3, "L3", "2026-11-20", "17:00", 2),
                (4, "L4", "2026-12-09", "17:00", 2)]
    return {
        "plan_id": 1, "tema_id": 1, "tema": "Cálculo", "horas_por_dia": [2, 2, 2, 2, 2, 0, 0],
        "inicio_por_dia": ["17:00"] * 5 + [None, None],
        "lecciones": [{"clave": c, "titulo": t, "horas": h, "depende_de": d, "apuntes": a} for c, t, h, d, a in lecciones],
        "sesiones": [{"id": i, "clave": c, "fecha": f, "inicio": h, "horas": n, "estado": "pendiente"} for i, c, f, h, n in sesiones],
        "eventos": [],
    }


def calendario_de(plan: dict, desde: date, hasta: date) -> str:
    """Lo que devolvería `herramientas.ver_calendario`, con el mismo formato, desde el plan en memoria."""
    from magister.asesor.cambios import dia

    titulos = {x["clave"]: x["titulo"] for x in plan["lecciones"]}
    por_dia: dict[str, list[str]] = {}
    for x in plan["sesiones"]:
        if desde.isoformat() <= x["fecha"] <= hasta.isoformat():
            hora = f" a las {x['inicio']}" if x["inicio"] else ""
            por_dia.setdefault(x["fecha"], []).append(
                f"sesión {x['id']}: {x['clave']} «{titulos.get(x['clave'], '')}»{hora}, {x['horas']:g} h ({x['estado']})")
    for e in plan["eventos"]:
        if desde.isoformat() <= e["fecha"] <= hasta.isoformat():
            por_dia.setdefault(e["fecha"], []).append(f"{e['tipo']} «{e['titulo']}»")
    lineas = [f"- {dia(f)} ({f}): " + "; ".join(v) for f, v in sorted(por_dia.items())]
    return "\n".join(lineas) or f"(nada entre el {dia(desde)} y el {dia(hasta)})"


def lector(plan: dict):
    """Sustituye a `herramientas.leer` en el modo plan: todo sale del plan en memoria."""

    async def leer(herramienta, proyecto_id, consulta, plan_id=None, desde=None, hasta=None) -> str:
        if herramienta == "ver_calendario":
            inicio = date.fromisoformat(desde)
            return calendario_de(plan, inicio, date.fromisoformat(hasta) if hasta else inicio)
        if herramienta == "ver_plan_estudio":
            return "\n".join(f"- {x['clave']} {x['titulo']}" for x in plan["lecciones"])
        return "(no hay notas sobre eso)"

    return leer


@dataclass
class EscenarioPlan:
    id: str
    encargo: str
    turnos: list[dict]
    salida: str  # cambios o no_se_puede
    acciones: list[dict] = field(default_factory=list)  # cada una, los campos que tienen que coincidir
    exactas: bool = True  # sin acciones de más
    prohibidas: frozenset[str] = frozenset({"preparar_leccion"})  # salvo que se esperen
    lee: str | None = None  # la lectura que tiene que hacer antes de proponer
    porque: str = ""


def _u(texto: str) -> list[dict]:
    return [{"rol": "usuario", "contenido": texto}]


ESCENARIOS_PLAN = [
    EscenarioPlan("mover", "Mover la sesión de L3 (Integrales) del viernes 20 al lunes 23.", _u("el viernes no puedo, pásame integrales al lunes"),
                  "cambios", [{"tipo": "mover_sesion", "sesion_id": 3, "fecha": "2026-11-23"}], porque="lo normal: una sesión, un día que cabe"),
    EscenarioPlan("marcar", "Marcar L1 (Límites) como hecha.", _u("límites ya lo tengo, márcalo como hecho"),
                  "cambios", [{"tipo": "marcar_leccion", "clave": "L1", "hecho": True}], porque="marcar sin preparar nada de propina"),
    EscenarioPlan("preparar", "Preparar los apuntes de L2 (Derivadas).", _u("prepárame los apuntes de derivadas"),
                  "cambios", [{"tipo": "preparar_leccion", "clave": "L2"}], prohibidas=frozenset(), porque="lo pide: gasta cuota"),
    EscenarioPlan("apuntar", "Apuntar el examen parcial de cálculo el viernes 27 a las 10:00.", _u("apúntame el parcial del viernes 27 a las 10"),
                  "cambios", [{"tipo": "apuntar_evento", "fecha": "2026-11-27", "hora": "10:00", "tipo_evento": "examen"}]),
    EscenarioPlan("tres", "Marcar L1 (Límites) como hecha, preparar los apuntes de L2 y apuntar el examen parcial de cálculo el viernes 27 a las 10:00.",
                  _u("límites ya lo tengo, prepárame derivadas y apúntame el parcial del viernes 27 a las 10"), "cambios",
                  [{"tipo": "marcar_leccion", "clave": "L1", "hecho": True}, {"tipo": "preparar_leccion", "clave": "L2"},
                   {"tipo": "apuntar_evento", "fecha": "2026-11-27", "tipo_evento": "examen"}], prohibidas=frozenset()),
    EscenarioPlan("lejos", "Mover la sesión de L4 (Aplicaciones de la integral) del miércoles 9 de diciembre al jueves 10 de diciembre.",
                  _u("la sesión de aplicaciones del 9 de diciembre pásala al día 10"), "cambios",
                  [{"tipo": "mover_sesion", "sesion_id": 4, "fecha": "2026-12-10"}], lee="ver_calendario",
                  porque="la sesión no está en las dos semanas que ve: tiene que leer el calendario para saber su id"),
    EscenarioPlan("sabado", "Mover la sesión de L2 (Derivadas) al sábado 21 por la mañana.", _u("pásame derivadas al sábado por la mañana"),
                  "no_se_puede", porque="el sábado no tiene horas y cambiar el horario no está en la lista: no inventa otro día"),
    EscenarioPlan("fuera", "Borrar el plan de Cálculo y cambiar el horario para estudiar también los sábados.",
                  _u("borra el plan de cálculo y ponme a estudiar los sábados"), "no_se_puede",
                  porque="ni borrar un plan ni cambiar el horario están en la lista cerrada"),
    EscenarioPlan("vago", "Mover una sesión a otro día.", _u("muéveme una sesión"), "no_se_puede",
                  porque="discutible: sin saber cuál ni a qué día, no debe elegir por su cuenta"),
]


@dataclass
class MensajePlan:
    id: str
    mensaje: str
    cambio: bool  # True: tiene que acabar en un bloque ```cambio; False: preguntar, avisar o decir dónde se hace
    porque: str = ""


MENSAJES_PLAN = [
    MensajePlan("mover", "el viernes no puedo, pásame integrales al lunes", True),
    MensajePlan("marcar", "márcame límites como hecha", True),
    MensajePlan("apuntar", "apúntame el parcial de cálculo del viernes 27 a las 10", True),
    MensajePlan("preparar", "prepárame los apuntes de derivadas", True, "lo pide; al ofrecerlo dice que gasta cuota"),
    MensajePlan("que_sesion", "muéveme una sesión", False, "no dice cuál ni a qué día: pregunta"),
    MensajePlan("sabado", "pásame derivadas al sábado", False, "el sábado no estudia: lo dice y propone otro día"),
    MensajePlan("borrar", "bórrame el plan de cálculo", False, "no está en la lista: dice dónde se hace"),
    MensajePlan("horario", "cámbiame el horario para estudiar los sábados", False, "no está en la lista: «Mi horario»"),
    MensajePlan("pregunta", "qué tengo mañana?", False, "una pregunta, no un cambio"),
]

CORTO_ESCENARIOS = ["mover", "marcar", "sabado"]
CORTO_MENSAJES = ["mover", "que_sesion", "borrar"]


def contexto_plan(plan: dict) -> str:
    """Lo que la mascota tiene «en pantalla» en el calendario: la semana del plan. Lo escribe esta eval, no la web:
    se parece, pero no es byte a byte lo que manda la app."""
    from magister.asesor.cambios import dia

    titulos = {x["clave"]: x["titulo"] for x in plan["lecciones"]}
    semana = [f"{dia(x['fecha'])} {x['inicio']}: {x['clave']} {titulos[x['clave']]} ({x['horas']:g} h)"
              for x in plan["sesiones"] if x["fecha"] <= "2026-12-02"]
    return ("Sección: Calendario\nRuta: #/calendario\n<pantalla>\nCalendario · Cálculo\n" + "\n".join(semana)
            + "\nHorario: de lunes a viernes, 2 h desde las 17:00; sábado y domingo, nada.\n</pantalla>\n"
            "<rutas>\n#/hoy #/roadmap #/calendario #/repaso #/notas\n</rutas>")


def puntuar_mensaje(m: MensajePlan, texto: str | None) -> dict:
    """Sin respuesta (cortada por el tope o un fallo) no puntúa."""
    from magister.asesor.cambios import encargo_de

    if texto is None:
        return {}
    ofrece = encargo_de(texto) is not None
    return {"decide_bien": ofrece == m.cambio, "ofrece": ofrece}


def _igual(esperado, real) -> bool:
    if isinstance(esperado, str) and isinstance(real, str):
        return esperado.strip().lower() == real.strip().lower()
    return esperado == real


def puntuar_escenario(e: EscenarioPlan, r: dict) -> dict:
    """`r`: {"salida": "cambios" | "no_se_puede" | "fallo", "acciones": [acción en JSON], "lecturas": [lectura],
    "fuera_de_lista": intentos rechazados por un tipo fuera de la lista}. Todo por código."""
    acciones = r.get("acciones") or []
    salida_ok = r["salida"] == e.salida
    if e.salida == "cambios":
        faltan = [x for x in e.acciones if not any(all(_igual(v, a.get(k)) for k, v in x.items()) for a in acciones)]
        esperados = {x["tipo"] for x in e.acciones}
        sobran = [a["tipo"] for a in acciones if a["tipo"] not in esperados] if e.exactas else []
        prohibidas = [a["tipo"] for a in acciones if a["tipo"] in e.prohibidas and a["tipo"] not in esperados]
        accion_ok = salida_ok and not faltan and not sobran and not prohibidas
    else:
        faltan, sobran, prohibidas = [], [], []
        accion_ok = salida_ok  # «no actúa»: ninguna acción
    puntos = {"salida_correcta": salida_ok, "accion_correcta": accion_ok, "sin_fuera_de_lista": r.get("fuera_de_lista", 0) == 0,
              "faltan": faltan, "sobran": sobran + prohibidas}
    if e.lee:
        puntos["lee_cuando_toca"] = any(x.get("herramienta") == e.lee for x in r.get("lecturas") or [])
    return puntos


def _fuera_de_lista(errores: list[str]) -> bool:
    """Un intento que el esquema rechazó por un tipo de acción que no existe."""
    return any(re.search(r"(^|\.)acciones\.\d+\.tipo:", x) for x in errores)


async def correr_escenario_plan(e: EscenarioPlan, plan: dict) -> dict:
    """Corre el agente de verdad (o el eco) sobre el plan en memoria, sin base: las lecturas salen de `lector`."""
    from magister.asesor import herramientas
    from magister.cerebro.estructura import ErrorEstructura

    original_leer, original_estructurar = herramientas.leer, ag.estructurar
    fuera = 0
    lecturas: list[dict] = []

    async def espiado(sistema, entrada, Modelo, reglas=None, **kw):
        nonlocal fuera
        intentos: list = []
        try:
            return await original_estructurar(sistema, entrada, Modelo, reglas=reglas, intentos=intentos, **kw)
        finally:
            fuera += sum(1 for i in intentos if _fuera_de_lista(i.errores))

    herramientas.leer = lector(plan)
    ag.estructurar = espiado
    try:
        async for que, dato in ag.preparar(e.encargo, e.turnos, None, None, HOY_PLAN, MOMENTO_PLAN, plan):
            if que == "leyendo":
                lecturas += dato
            else:
                cambios, *_ = dato
                return {"salida": "cambios", "acciones": [a.model_dump(mode="json", exclude_none=True) for a in cambios.acciones],
                        "lecturas": lecturas, "fuera_de_lista": fuera}
    except ag.NoSePuede as x:
        return {"salida": "no_se_puede", "motivo": str(x), "lecturas": lecturas, "fuera_de_lista": fuera}
    except ErrorEstructura as x:
        return {"salida": "fallo", "motivo": str(x), "lecturas": lecturas, "fuera_de_lista": fuera}
    finally:
        herramientas.leer, ag.estructurar = original_leer, original_estructurar
    return {"salida": "fallo", "motivo": "sin propuesta", "lecturas": lecturas, "fuera_de_lista": fuera}


async def responder_mensaje(m: MensajePlan, plan: dict) -> str:
    from magister.cerebro.modelo import Turno, generar
    from magister.cerebro.prompts import cargar
    from magister.flujo.comun import sistema_de_estudio

    estado = {"asesor": True, "contexto": contexto_plan(plan), "hoy": HOY_PLAN.isoformat()}
    sistema = await sistema_de_estudio(cargar("conversar").texto, estado)
    return "".join([t async for t in generar(sistema, [Turno("usuario", m.mensaje)], tarea="asesor")])


async def correr_plan(nivel: str, t, solo: str | None = None) -> dict:
    """Devuelve las puntuaciones por caso; para en limpio al llegar al tope."""
    from evals import tope

    plan = plan_fijo()
    puntos: dict[str, dict] = {}
    if solo in (None, "decidir"):
        print("== decidir (el chat: ¿ofrece el cambio o pregunta?)")
        for m in tope.del_nivel(MENSAJES_PLAN, nivel, CORTO_MENSAJES):
            if not t.cabe(1):
                t.cortado = True
                break
            try:
                texto = await responder_mensaje(m, plan)
            except tope.TopeAlcanzado:
                break
            p = puntuar_mensaje(m, texto)
            puntos[f"decidir/{m.id}"] = p
            print(f"  {'bien' if p['decide_bien'] else 'MAL '} {m.id:<11} esperaba {'cambio' if m.cambio else 'sin cambio'}, "
                  f"{'ofrece cambio' if p['ofrece'] else 'no ofrece'} · «{texto.strip()[:90]}»")
    if solo in (None, "agente") and not t.cortado:
        print("== agente (prepara el cambio sobre el plan)")
        for e in tope.del_nivel(ESCENARIOS_PLAN, nivel, CORTO_ESCENARIOS):
            if not t.cabe(1):
                t.cortado = True
                break
            try:
                r = await correr_escenario_plan(e, plan)
            except tope.TopeAlcanzado:
                break
            p = puntuar_escenario(e, r)
            puntos[f"agente/{e.id}"] = p
            hecho = r["salida"] if r["salida"] != "cambios" else ", ".join(
                f"{a['tipo']}({', '.join(f'{k}={v}' for k, v in a.items() if k not in ('tipo', 'motivo'))})" for a in r["acciones"])
            marca = "bien" if p["accion_correcta"] and p.get("lee_cuando_toca", True) else "MAL "
            print(f"  {marca} {e.id:<9} {hecho[:150]}" + (f" · faltan {p['faltan']}" if p["faltan"] else "")
                  + (f" · sobran {p['sobran']}" if p["sobran"] else "") + (f" · fuera de lista {r['fuera_de_lista']}" if r["fuera_de_lista"] else "")
                  + (f" · lecturas {[x.get('herramienta') for x in r['lecturas']]}" if r["lecturas"] else ""))
    return puntos


def metricas_plan(puntos: dict[str, dict]) -> dict:
    from evals import regresion

    def de(clave: str, prefijo: str) -> dict:
        return regresion.proporcion({c: (int(p[clave]), 1) for c, p in puntos.items() if c.startswith(prefijo) and clave in p})

    m = {"decide_bien": de("decide_bien", "decidir/"), "salida_correcta": de("salida_correcta", "agente/"),
         "accion_correcta": de("accion_correcta", "agente/"), "sin_fuera_de_lista": de("sin_fuera_de_lista", "agente/"),
         "lee_cuando_toca": de("lee_cuando_toca", "agente/")}
    return {k: v for k, v in m.items() if v["por_caso"]}


def informe_plan(puntos: dict[str, dict]) -> str:
    from evals import regresion

    lineas = []
    for nombre, m in metricas_plan(puntos).items():
        r = regresion.resumir(m)
        lineas.append(f"{nombre:<20} {r['k']}/{r['n']} ({r['valor']:.0%}, IC 95 % {r['ic'][0]:.0%}-{r['ic'][1]:.0%})")
    return "\n".join(lineas) or "(nada que contar)"


async def principal_plan(args) -> None:
    from evals import regresion

    print(f"motor={ajustes.motor} modelo={ajustes.modelo} vueltas={ajustes.asesor_vueltas} nivel={args.nivel} (sin base)")
    puntos = await correr_plan(args.nivel, args.tope, args.solo)
    print("\n" + informe_plan(puntos))
    if puntos:
        ej = regresion.ejecucion("asesor_plan", args.nivel, regresion.versiones(["asesor_cambio", "conversar"]),
                                 metricas_plan(puntos), args.tope)
        print(f"Guardada para comparar: {regresion.guardar(ej)}")


# Topes por modo y nivel. Agente: hasta `asesor_vueltas` vueltas por encargo, cada una con sus reintentos.
TOPES = {"agente": (18, 70), "chat": (15, 45), "plan": (15, 90)}
CORTO_AGENTE = ["1", "5"]
CORTO_CHAT = 3


def main() -> None:
    from evals import tope

    ap = argparse.ArgumentParser(description="Harness a mano del asesor con el modelo de verdad (gasta cuota).")
    sub = ap.add_subparsers(dest="modo", required=True)
    pa = sub.add_parser("agente", help=f"el agente que prepara cambios, con {len(ESCENARIOS)} encargos (base de pruebas)")
    pa.add_argument("escenarios", nargs="*", choices=[str(i) for i in range(1, len(ESCENARIOS) + 1)],
                    help="números de escenario (por defecto, los del nivel)")
    tope.argumentos(pa, *TOPES["agente"])
    pc = sub.add_parser("chat", help="de punta a punta por la API (base de pruebas)")
    tope.argumentos(pc, *TOPES["chat"])
    pp = sub.add_parser("plan", help="plan de estudio y agenda, puntuado por código y sin base")
    pp.add_argument("--solo", choices=["decidir", "agente"])
    tope.argumentos(pp, *TOPES["plan"])
    if len(sys.argv) == 1:
        ap.print_help()
        return
    args = ap.parse_args()
    args.tope = t = tope.de_args(args)
    if args.modo == "agente":
        solo = args.escenarios or (CORTO_AGENTE if args.nivel == "corto" else [])
        tope.correr(correr_agente(solo), t)
    elif args.modo == "chat":
        tope.correr(correr_chat(CORTO_CHAT if args.nivel == "corto" else None), t)
    else:
        tope.correr(principal_plan(args), t)


if __name__ == "__main__":
    main()
