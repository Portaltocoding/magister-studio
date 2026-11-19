"""El agente del asesor: convierte su encargo («reordena el nivel 1 y añade los tests con moto») en acciones validadas.

Un bucle corto decidir → leer → decidir. En cada vuelta el modelo devuelve, por `estructurar`, UNA de tres cosas:
lecturas (herramientas de solo lectura), los cambios, o que no se puede. Lo que el prompt pide, el código lo exige:

- Tope de vueltas (`MAGISTER_ASESOR_VUELTAS`) y de lecturas por vuelta; en la última vuelta solo vale proponer.
- Una lectura ya hecha no se repite; `buscar_notas` necesita consulta.
- Los cambios pasan `cambios.simular` contra el proyecto de verdad; lo que no vale vuelve al modelo con el porqué.

Lo normal es una sola vuelta: el roadmap y el diario ya van en el prompt. El modelo no escribe nada: el arnés aplica
la propuesta solo si la apruebas.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from magister.asesor import herramientas
from magister.asesor.cambios import Cambios, Resultado, simular
from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar
from magister.config import ajustes

MAX_TURNO = 14_000  # un documento pegado entero cabe; el resto de la conversación, recortado
MAX_CONVERSACION = 32_000
TURNOS = 8


class Lectura(BaseModel):
    herramienta: Literal["buscar_notas", "ver_plan_estudio"]
    consulta: str | None = Field(None, max_length=200, description="buscar_notas: las palabras que buscas")


class Paso(BaseModel):
    """Lo que decide el agente en una vuelta: exactamente una de las tres salidas."""

    falta: str = Field(description="En una frase: qué te falta saber para proponer, o por qué ya puedes")
    leer: list[Lectura] = Field(default_factory=list, max_length=3)
    cambios: Cambios | None = None
    no_se_puede: str | None = Field(None, description="Si el encargo no se puede hacer con estas acciones: por qué, "
                                                      "en una frase para el alumno")


class NoSePuede(Exception):
    """El agente ha decidido que el encargo no cabe en lo que puede hacer (el motivo es para el alumno)."""


def _clave(x: Lectura | dict) -> tuple[str, str]:
    d = x.model_dump() if isinstance(x, Lectura) else x
    return d["herramienta"], (d.get("consulta") or "").strip().lower()


def reglas_paso(p: Paso, hechas: list[dict], ultima: bool, proyecto: dict | None, momento: str) -> list[str]:
    """Lo que tiene que cumplir la decisión de una vuelta. Sin modelo: se prueba sola."""
    salidas = [bool(p.leer), p.cambios is not None, bool((p.no_se_puede or "").strip())]
    if sum(salidas) != 1:
        return ["Devuelve exactamente una de las tres: `leer` (lecturas), `cambios` o `no_se_puede`."]
    if p.cambios is not None:
        return simular(p.cambios, proyecto, momento).errores
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
        elif _clave(x) in ya:
            errores.append(f"Ya has leído {herramientas.descripcion(x.model_dump())}: está en <lecturas>. Propón o lee otra cosa.")
        ya.add(_clave(x))
    return errores


def texto_proyecto(proyecto: dict | None) -> str:
    """El proyecto como lo ve el modelo: ids, lo hecho y cada paso entero (para poder cambiarlo o moverlo)."""
    if not proyecto or not proyecto.get("roadmap"):
        return "(no hay ningún proyecto en pantalla: solo se puede guardar_nota)"
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
        bloques = "\n".join(f'<lectura herramienta="{x["herramienta"]}" consulta="{x.get("consulta") or ""}">\n{texto}\n</lectura>'
                            for x, texto in leido)
        partes.append(f"<lecturas>\n{bloques}\n</lecturas>")
    if vuelta >= vueltas:
        partes.append("Ya no puedes leer más: devuelve `cambios` (o `no_se_puede`).")
    else:
        partes.append(f"Vuelta {vuelta} de {vueltas}. Si ya tienes lo que hace falta, devuelve `cambios` ahora.")
    return "\n\n".join(partes)


async def preparar(encargo: str, turnos: list[dict], proyecto: dict | None, proyecto_id: int | None, hoy: date,
                   momento: str) -> AsyncIterator[tuple[str, object]]:
    """Va entregando ("leyendo", [lecturas]) en cada vuelta de lectura y, al final, ("listo", (cambios, cómo quedaría,
    nombre@versión del prompt, lecturas hechas)). Lanza NoSePuede o ErrorEstructura."""
    plantilla = cargar("asesor_cambio")
    sistema = plantilla.rellenar(hoy=hoy.isoformat(), proyecto=texto_proyecto(proyecto),
                                 diario=await herramientas.diario(proyecto_id) if proyecto else "(no hay proyecto)",
                                 lecturas_por_vuelta=ajustes.asesor_lecturas)
    leido: list[tuple[dict, str]] = []
    vueltas = max(1, ajustes.asesor_vueltas)
    for vuelta in range(1, vueltas + 1):
        hechas = [x for x, _ in leido]
        paso = await estructurar(sistema, _entrada(encargo, turnos, leido, vuelta, vueltas), Paso,
                                 reglas=lambda p: reglas_paso(p, hechas, vuelta >= vueltas, proyecto, momento))
        if paso.cambios is not None:
            yield "listo", (paso.cambios, simular(paso.cambios, proyecto, momento), plantilla.etiqueta, hechas)
            return
        if paso.no_se_puede:
            raise NoSePuede(paso.no_se_puede.strip())
        pedidas = [x.model_dump() for x in paso.leer]
        yield "leyendo", pedidas
        textos = await asyncio.gather(*(herramientas.leer(x["herramienta"], proyecto_id, x.get("consulta")) for x in pedidas))
        leido += list(zip(pedidas, textos))
    raise NoSePuede("no he llegado a una propuesta")  # no debería pasar: la última vuelta solo admite proponer
