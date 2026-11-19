"""El agente del asesor: convierte su encargo («reordena el nivel 1 y añade los tests con moto») en acciones validadas.

Un bucle corto decidir → leer → decidir. En cada vuelta el modelo devuelve, por `estructurar`, UNA de tres cosas:
lecturas (herramientas de solo lectura), los cambios, o que no se puede. Lo que el prompt pide, el código lo exige:

- Tope de vueltas (`MAGISTER_ASESOR_VUELTAS`) y de lecturas por vuelta; en la última vuelta solo vale proponer.
- Una lectura ya hecha no se repite; `buscar_notas` necesita consulta.
- Los cambios pasan `cambios.simular` contra el proyecto de verdad; lo que no vale vuelve al modelo con el porqué.

Lo normal es una sola vuelta: el roadmap, el diario y el plan activo (sus lecciones y las sesiones de los próximos
14 días) ya van en el prompt. El modelo no escribe nada: el arnés aplica la propuesta solo si la apruebas.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from magister.asesor import herramientas
from magister.asesor.cambios import Cambios, Resultado, dia, leccion_hecha, simular
from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar
from magister.config import ajustes

MAX_TURNO = 14_000  # un documento pegado entero cabe; el resto de la conversación, recortado
MAX_CONVERSACION = 32_000
TURNOS = 8
DIAS_PLAN = 14  # las sesiones de los próximos 14 días van en el prompt; más allá, con ver_calendario
DIAS_ATRAS = 7  # y las pendientes de la última semana (las que se quedaron sin hacer)
MAX_RANGO = 14  # ver_calendario: como mucho 14 días por lectura


class Lectura(BaseModel):
    herramienta: Literal["buscar_notas", "ver_plan_estudio", "ver_calendario"]
    consulta: str | None = Field(None, max_length=200, description="buscar_notas: las palabras que buscas")
    desde: date | None = Field(None, description="ver_calendario: el primer día, AAAA-MM-DD")
    hasta: date | None = Field(None, description=f"ver_calendario: el último (como mucho {MAX_RANGO} días después)")


class Paso(BaseModel):
    """Lo que decide el agente en una vuelta: exactamente una de las tres salidas."""

    falta: str = Field(description="En una frase: qué te falta saber para proponer, o por qué ya puedes")
    leer: list[Lectura] = Field(default_factory=list, max_length=3)
    cambios: Cambios | None = None
    no_se_puede: str | None = Field(None, description="Si el encargo no se puede hacer con estas acciones: por qué, "
                                                      "en una frase para el alumno")


class NoSePuede(Exception):
    """El agente ha decidido que el encargo no cabe en lo que puede hacer (el motivo es para el alumno)."""


def _clave(x: Lectura | dict) -> tuple[str, str, str, str]:
    d = x.model_dump(mode="json") if isinstance(x, Lectura) else x
    return d["herramienta"], (d.get("consulta") or "").strip().lower(), d.get("desde") or "", d.get("hasta") or ""


def _errores_calendario(x: Lectura) -> list[str]:
    if x.desde is None:
        return ["ver_calendario necesita `desde` (y `hasta`, si es más de un día)."]
    hasta = x.hasta or x.desde
    if hasta < x.desde or (hasta - x.desde).days >= MAX_RANGO:
        return [f"ver_calendario: `hasta` va de `desde` a {MAX_RANGO - 1} días después como mucho."]
    return []


def reglas_paso(p: Paso, hechas: list[dict], ultima: bool, proyecto: dict | None, momento: str,
                plan: dict | None = None, hoy: date | None = None) -> list[str]:
    """Lo que tiene que cumplir la decisión de una vuelta. Sin modelo: se prueba sola."""
    salidas = [bool(p.leer), p.cambios is not None, bool((p.no_se_puede or "").strip())]
    if sum(salidas) != 1:
        return ["Devuelve exactamente una de las tres: `leer` (lecturas), `cambios` o `no_se_puede`."]
    if p.cambios is not None:
        return simular(p.cambios, proyecto, momento, plan, hoy).errores
    if not p.leer:
        return []
    if ultima:
        return ["Ya no quedan lecturas: devuelve `cambios` con lo que sabes (o `no_se_puede`)."]
    errores = []
    if len(p.leer) > ajustes.asesor_lecturas:
        errores.append(f"Como mucho {ajustes.asesor_lecturas} lecturas por vuelta.")
    ya = {_clave(x) for x in hechas}
    for x in p.leer:
        if x.herramienta == "buscar_notas" and len((x.consulta or "").strip()) < 3:
            errores.append("buscar_notas necesita en `consulta` las palabras que buscas.")
        elif x.herramienta == "ver_calendario" and (e := _errores_calendario(x)):
            errores += e
        elif _clave(x) in ya:
            errores.append(f"Ya has leído {herramientas.descripcion(x.model_dump(mode='json'))}: está en <lecturas>. "
                           "Propón o lee otra cosa.")
        ya.add(_clave(x))
    return errores


def texto_plan(plan: dict | None, hoy: date) -> str:
    """El plan activo como lo ve el modelo: sus lecciones con su estado y las sesiones cercanas con sus ids."""
    if not plan:
        return "(no hay ningún plan de estudio activo: las acciones del plan no valen; apuntar_evento sí)"
    desde, hasta = hoy - timedelta(days=DIAS_ATRAS), hoy + timedelta(days=DIAS_PLAN - 1)
    titulos = {x["clave"]: x["titulo"] for x in plan["lecciones"]}
    horas, inicios = plan.get("horas_por_dia") or [None] * 7, plan.get("inicio_por_dia") or [None] * 7
    sesiones = [{**{k: x[k] for k in ("id", "clave", "fecha", "inicio", "horas", "estado")}, "dia": dia(x["fecha"]),
                 "titulo": titulos.get(x["clave"], "")}
                for x in plan["sesiones"]
                if (hoy.isoformat() <= x["fecha"] <= hasta.isoformat())
                or (desde.isoformat() <= x["fecha"] < hoy.isoformat() and x["estado"] == "pendiente")]
    return json.dumps({
        "plan_id": plan["plan_id"], "tema": plan.get("tema"),
        "horario": [{"dia": n, "horas": h, "desde": i} for n, h, i in
                    zip(("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"), horas, inicios)],
        "lecciones": [{"clave": x["clave"], "titulo": x["titulo"], "horas": x["horas"], "depende_de": x.get("depende_de") or [],
                       "hecha": leccion_hecha(plan, x), "apuntes": x.get("apuntes") or "sin preparar"}
                      for x in plan["lecciones"]],
        "sesiones": sesiones,
        "agenda": [e for e in plan.get("eventos", []) if hoy.isoformat() <= e["fecha"] <= hasta.isoformat()],
    }, ensure_ascii=False, indent=1)


def texto_proyecto(proyecto: dict | None) -> str:
    """El proyecto como lo ve el modelo: ids, lo hecho y cada paso entero (para poder cambiarlo o moverlo)."""
    if not proyecto or not proyecto.get("roadmap"):
        return "(no hay ningún proyecto en pantalla: las acciones del proyecto no valen)"
    r, hechos = proyecto["roadmap"], set(proyecto.get("hechos") or [])
    niveles = [{
        "id": n["id"], "numero": n["numero"], "titulo": n["titulo"], "objetivo": n["objetivo"], "priming": n["priming"],
        "detallado": bool(n.get("detallado")),
        "bloques": [{"id": b["id"], "titulo": b["titulo"], "priming": b["priming"],
                     "pasos": [{**{k: p[k] for k in ("id", "titulo", "que_haces", "antes", "hecho_si", "minutos")},
                                "hecho": p["id"] in hechos} for p in b["pasos"]]} for b in n["bloques"]],
    } for n in r.get("niveles", [])]
    return json.dumps({"nombre": proyecto.get("nombre"), "resumen": r.get("resumen"), "niveles": niveles},
                      ensure_ascii=False, indent=1)


def texto_conversacion(turnos: list[dict]) -> str:
    """Los últimos turnos, del más reciente hacia atrás hasta el tope (el documento pegado suele estar cerca)."""
    lineas: list[str] = []
    total = 0
    for t in reversed(turnos[-TURNOS:]):
        quien = "Alumno" if t["rol"] == "usuario" else "Asesor"
        linea = f"{quien}: {t['contenido'][:MAX_TURNO]}"
        if total + len(linea) > MAX_CONVERSACION:
            break
        lineas.append(linea)
        total += len(linea)
    return "\n\n".join(reversed(lineas)) or "(vacía)"


def _entrada(encargo: str, turnos: list[dict], leido: list[tuple[dict, str]], vuelta: int, vueltas: int) -> str:
    partes = [f"<conversacion>\n{texto_conversacion(turnos)}\n</conversacion>", f"<encargo>\n{encargo}\n</encargo>"]
    if leido:
        bloques = "\n".join(f'<lectura herramienta="{x["herramienta"]}" consulta="{x.get("consulta") or ""}"'
                            + (f' desde="{x.get("desde")}" hasta="{x.get("hasta") or x.get("desde")}"' if x.get("desde") else "")
                            + f">\n{texto}\n</lectura>" for x, texto in leido)
        partes.append(f"<lecturas>\n{bloques}\n</lecturas>")
    if vuelta >= vueltas:
        partes.append("Ya no puedes leer más: devuelve `cambios` (o `no_se_puede`).")
    else:
        partes.append(f"Vuelta {vuelta} de {vueltas}. Si ya tienes lo que hace falta, devuelve `cambios` ahora.")
    return "\n\n".join(partes)


async def preparar(encargo: str, turnos: list[dict], proyecto: dict | None, proyecto_id: int | None, hoy: date,
                   momento: str, plan: dict | None = None) -> AsyncIterator[tuple[str, object]]:
    """Va entregando ("leyendo", [lecturas]) en cada vuelta de lectura y, al final, ("listo", (cambios, cómo quedaría,
    nombre@versión del prompt, lecturas hechas)). Lanza NoSePuede o ErrorEstructura. `plan`: el plan activo
    (`arnes.leer_plan`), o None."""
    plantilla = cargar("asesor_cambio")
    sistema = plantilla.rellenar(hoy=f"{hoy.isoformat()} ({dia(hoy)})", proyecto=texto_proyecto(proyecto),
                                 diario=await herramientas.diario(proyecto_id) if proyecto else "(no hay proyecto)",
                                 plan=texto_plan(plan, hoy), lecturas_por_vuelta=ajustes.asesor_lecturas)
    plan_id = plan["plan_id"] if plan else None
    leido: list[tuple[dict, str]] = []
    vueltas = max(1, ajustes.asesor_vueltas)
    for vuelta in range(1, vueltas + 1):
        hechas = [x for x, _ in leido]
        paso = await estructurar(sistema, _entrada(encargo, turnos, leido, vuelta, vueltas), Paso,
                                 reglas=lambda p: reglas_paso(p, hechas, vuelta >= vueltas, proyecto, momento, plan, hoy))
        if paso.cambios is not None:
            yield "listo", (paso.cambios, simular(paso.cambios, proyecto, momento, plan, hoy), plantilla.etiqueta, hechas)
            return
        if paso.no_se_puede:
            raise NoSePuede(paso.no_se_puede.strip())
        pedidas = [x.model_dump(mode="json", exclude_none=True) for x in paso.leer]
        yield "leyendo", pedidas
        textos = await asyncio.gather(*(herramientas.leer(x["herramienta"], proyecto_id, x.get("consulta"), plan_id=plan_id,
                                                          desde=x.get("desde"), hasta=x.get("hasta")) for x in pedidas))
        leido += list(zip(pedidas, textos))
    raise NoSePuede("no he llegado a una propuesta")  # no debería pasar: la última vuelta solo admite proponer
