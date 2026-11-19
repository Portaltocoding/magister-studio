"""Harness a mano del asesor que hace cosas (ADR-0017), con el modelo de verdad.

    uv run python -m evals.asesor agente [N ...]    el agente que prepara cambios: 7 encargos (3 del plan de estudio), y
                                                    qué decide en cada vuelta
    uv run python -m evals.asesor chat              de punta a punta por la API: si el asesor sabe cuándo ofrecer un cambio

Es un harness a mano, como `evals.tono` y `evals.fidelidad`: llama a `claude -p` de verdad y GASTA CUOTA.
Usa la base de PRUEBAS (`ajustes.db_url_pruebas`), nunca la real, y la VACÍA antes de empezar: borra las
tablas `notas` y `proyectos` (y `conversaciones` en el modo `chat`) y siembra un proyecto de ejemplo. En el modo
`agente` borra también `temas` y `planes` (con lo que cuelga de ellos) y siembra un plan de Cálculo para el 19-11-2026.
No decide aprobado o suspenso: imprime lo que hace el asesor para que lo leas tú.
"""

import argparse
import asyncio
import json
import sys
import time
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


async def correr_chat() -> None:
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
            for esperado, mensaje in GUION:
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


def main() -> None:
    ap = argparse.ArgumentParser(description="Harness a mano del asesor con el modelo de verdad (gasta cuota; usa la base de pruebas).")
    sub = ap.add_subparsers(dest="modo", required=True)
    pa = sub.add_parser("agente", help=f"el agente que prepara cambios, con {len(ESCENARIOS)} encargos")
    pa.add_argument("escenarios", nargs="*", choices=[str(i) for i in range(1, len(ESCENARIOS) + 1)], help="números de escenario (por defecto, todos)")
    sub.add_parser("chat", help="de punta a punta por la API")
    if len(sys.argv) == 1:
        ap.print_help()
        return
    args = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(correr_agente(args.escenarios) if args.modo == "agente" else correr_chat())


if __name__ == "__main__":
    main()
