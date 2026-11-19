"""Lo que el asesor puede cambiar, como datos: una lista cerrada de acciones, y su simulación en código puro.

`simular` hace los cambios sobre una copia del proyecto y dice qué fallaría. La usan las reglas de `estructurar` (lo
que no vale vuelve al modelo para que lo corrija) y el arnés al aplicar (la puerta está en código, no en el prompt).

Los ids de niveles, bloques y pasos no cambian nunca al mover nada (lo hecho y el diario van por id); los nuevos se
numeran después del mayor que haya existido. Los niveles se nombran por id (n2): su número cambia al reestructurar.

El plan de estudio activo (el de Roadmap, Calendario y Hoy) tiene sus propias acciones: mover una sesión, marcar una
lección, preparar sus apuntes y apuntar algo en la agenda. Se simulan igual, sobre una copia de sus sesiones.
"""

import copy
import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from magister.plan.calendario import a_hora, horas_utiles
from magister.plan.reglas import fmt
from magister.proyectos.roadmap import BloqueGen, PasoGen, errores_paso, ids_de

TipoAccion = Literal[
    # Añadir partes
    "anadir_pasos", "nuevo_bloque", "nuevo_nivel",
    # Reestructurar
    "mover_paso", "mover_bloque", "cambiar_paso", "cambiar_bloque", "cambiar_nivel",
    "quitar_paso", "quitar_bloque", "quitar_nivel",
    # Lo demás
    "marcar_paso", "apuntar_decision", "guardar_nota",
    # El plan de estudio activo y tu agenda
    "mover_sesion", "marcar_leccion", "preparar_leccion", "apuntar_evento",
]
# Las que trabajan sobre el plan activo (su huella cuenta para que la propuesta caduque si el plan cambia).
DEL_PLAN = {"mover_sesion", "marcar_leccion", "preparar_leccion"}
SIN_PROYECTO = {"guardar_nota", "apuntar_evento", *DEL_PLAN}
# Lo que no se deshace: unos apuntes preparados ya han gastado cuota.
NO_SE_DESHACE = {"preparar_leccion"}
MAX_PASOS_BLOQUE = 6
MAX_BLOQUES_NIVEL = 5
INICIO = "inicio"


class CamposPaso(BaseModel):
    """Para cambiar un paso: solo lo que cambia."""

    titulo: str | None = None
    que_haces: str | None = None
    antes: str | None = None
    hecho_si: str | None = None
    minutos: int | None = Field(None, ge=5, le=600)


class DecisionNueva(BaseModel):
    titulo: str = Field(max_length=300)
    decision: str = Field(max_length=4000)
    contexto: str | None = Field(None, max_length=4000)
    consecuencias: str | None = Field(None, max_length=4000)
    paso_id: str | None = Field(None, max_length=40)


class Accion(BaseModel):
    tipo: TipoAccion
    motivo: str = Field(description="Por qué, en una frase: se le enseña al alumno antes de aplicarlo")
    paso_id: str | None = Field(None, description="mover_paso, cambiar_paso, quitar_paso, marcar_paso")
    bloque_id: str | None = Field(None, description="anadir_pasos y mover_paso: el bloque de destino; mover_bloque, "
                                                    "cambiar_bloque, quitar_bloque: el bloque")
    nivel_id: str | None = Field(None, description="nuevo_bloque: el nivel; mover_bloque: el nivel de destino (sin él, "
                                                   "el mismo); cambiar_nivel, quitar_nivel: el nivel")
    despues_de: str | None = Field(None, description="Dónde va lo nuevo o lo movido: el id del paso, bloque o nivel "
                                                     "tras el que va, o «inicio». Sin él, al final")
    titulo: str | None = Field(None, description="nuevo_bloque, nuevo_nivel, cambiar_bloque, cambiar_nivel; apuntar_evento: "
                                                 "qué es («Parcial de integrales»)")
    priming: str | None = Field(None, description="nuevo_bloque, nuevo_nivel, cambiar_bloque, cambiar_nivel: como mucho 5 líneas")
    objetivo: str | None = Field(None, description="nuevo_nivel, cambiar_nivel: qué hace el producto al acabar el nivel")
    pasos: list[PasoGen] = Field(default_factory=list, max_length=MAX_PASOS_BLOQUE, description="anadir_pasos, nuevo_bloque")
    bloques: list[BloqueGen] = Field(default_factory=list, max_length=MAX_BLOQUES_NIVEL, description="nuevo_nivel")
    campos: CamposPaso | None = Field(None, description="cambiar_paso: solo los campos que cambian")
    hecho: bool | None = Field(None, description="marcar_paso, marcar_leccion")
    decision: DecisionNueva | None = Field(None, description="apuntar_decision")
    nota: str | None = Field(None, max_length=20_000, description="guardar_nota: el texto que se guarda")
    sesion_id: int | None = Field(None, description="mover_sesion: el id de la sesión, de <plan>")
    fecha: date | None = Field(None, description="mover_sesion: el día nuevo; apuntar_evento: el día. AAAA-MM-DD")
    hora: str | None = Field(None, pattern=r"^\d{1,2}:\d{2}$", description="mover_sesion: la hora nueva «HH:MM» (sin ella, "
                             "la primera libre de ese día); apuntar_evento: la hora, si la tiene")
    clave: str | None = Field(None, max_length=20, description="marcar_leccion, preparar_leccion: la clave de la lección (L5)")
    tipo_evento: Literal["examen", "deber", "clase", "nota"] | None = Field(None, description="apuntar_evento (sin él, deber)")


class Cambios(BaseModel):
    resumen: str = Field(description="Qué cambia, en una frase")
    acciones: list[Accion] = Field(min_length=1, max_length=12)
    pendiente: str | None = Field(None, max_length=600, description="Solo si parte del encargo se queda fuera: qué y qué "
                                  "puede hacer el alumno, en una o dos frases. Si va todo, vacío")


@dataclass
class Linea:
    texto: str
    motivo: str
    deshace: bool = True  # False: «Deshacer» no lo deshace (preparar apuntes)


@dataclass
class Resultado:
    """El proyecto tal como quedaría, lo que se crearía aparte y, si algo no vale, por qué."""

    roadmap: dict | None
    hechos: list[str]
    hechos_en: dict
    decisiones: list[dict] = field(default_factory=list)
    notas: list[str] = field(default_factory=list)
    lineas: list[Linea] = field(default_factory=list)
    errores: list[str] = field(default_factory=list)
    bloques_tocados: set[str] = field(default_factory=set)
    niveles_tocados: set[str] = field(default_factory=set)
    # El plan activo tal como quedaría (sus sesiones), y lo que se hace aparte.
    plan: dict | None = None
    eventos: list[dict] = field(default_factory=list)
    preparar: list[str] = field(default_factory=list)  # claves de lecciones cuyos apuntes se encolan
    marcar: list[tuple[str, bool]] = field(default_factory=list)  # (clave, hecha)
    movidas: set[int] = field(default_factory=set)


_BLOQUE_CAMBIO = re.compile(r"```cambio[^\n]*\n([\s\S]*?)(?:```|$)")


def encargo_de(texto: str) -> str | None:
    """El encargo del bloque ```cambio de una respuesta del asesor (el primero), o None."""
    m = _BLOQUE_CAMBIO.search(texto)
    encargo = m.group(1).strip() if m else ""
    return encargo[:2000] or None


def sin_bloque_cambio(texto: str) -> str:
    return _BLOQUE_CAMBIO.sub("", texto).strip()


def huella(roadmap: dict | None, hechos: list[str] | None) -> str:
    """Cambia si cambia el roadmap o lo hecho: una propuesta hecha sobre otro estado ya no se aplica."""
    datos = json.dumps({"roadmap": roadmap, "hechos": sorted(hechos or [])}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(datos.encode("utf-8")).hexdigest()


def usa_plan(c: Cambios) -> bool:
    return any(a.tipo in DEL_PLAN for a in c.acciones)


def huella_plan(plan: dict) -> str:
    """Cambia si cambian sus lecciones o sus sesiones (una movida, marcada o recalculada). La agenda no cuenta."""
    sesiones = sorted([x["id"], x["clave"], x["fecha"], x["inicio"] or "", x["horas"], x["estado"]] for x in plan["sesiones"])
    datos = json.dumps({"lecciones": sorted(x["clave"] for x in plan["lecciones"]), "sesiones": sesiones}, ensure_ascii=False)
    return hashlib.sha256(datos.encode("utf-8")).hexdigest()


def huella_de(c: Cambios, proyecto: dict | None, plan: dict | None) -> str | None:
    """La huella con la que se guarda una propuesta: la del proyecto (como siempre) y, si toca el plan, también la suya."""
    del_proyecto = huella(proyecto["roadmap"], proyecto["hechos"]) if proyecto else None
    if plan is None or not usa_plan(c):
        return del_proyecto
    datos = json.dumps({"proyecto": del_proyecto, "plan": huella_plan(plan)}, sort_keys=True)
    return hashlib.sha256(datos.encode("utf-8")).hexdigest()


def deshacible(lineas: list[dict]) -> bool:
    """Si «Deshacer» deshace algo: no, si todo lo que hizo fue preparar apuntes."""
    return any(x.get("deshace", True) for x in lineas)


# --- Buscar y numerar ---------------------------------------------------------------------------------------------

def _niveles(r: Resultado) -> list[dict]:
    return r.roadmap.get("niveles", [])


def _nivel(r: Resultado, nivel_id: str | None) -> dict | None:
    return next((n for n in _niveles(r) if n["id"] == nivel_id), None)


def _bloque(r: Resultado, bloque_id: str | None) -> tuple[dict, dict] | None:
    for n in _niveles(r):
        for b in n["bloques"]:
            if b["id"] == bloque_id:
                return n, b
    return None


def _paso(r: Resultado, paso_id: str | None) -> tuple[dict, dict, int] | None:
    for n in _niveles(r):
        for b in n["bloques"]:
            for i, p in enumerate(b["pasos"]):
                if p["id"] == paso_id:
                    return n, b, i
    return None


def _siguiente(r: Resultado, prefijo: str, extra: set[str] = frozenset()) -> int:
    """El número siguiente al mayor id que empieza por `prefijo` (en el proyecto, en lo hecho o ya repartido)."""
    usados = {*ids_de(_niveles(r)), *(n["id"] for n in _niveles(r)), *r.hechos, *r.hechos_en, *extra}
    numeros = [int(m.group(1)) for x in usados if (m := re.fullmatch(re.escape(prefijo) + r"(\d+)", x))]
    return max(numeros + [0]) + 1


def _renumerar(r: Resultado) -> None:
    for i, n in enumerate(_niveles(r), 1):
        n["numero"] = i


def _posicion(ids: list[str], despues_de: str | None, que: str, errores: list[str]) -> int | None:
    """Dónde se inserta en una lista de ids: tras `despues_de`, al principio con «inicio» o al final."""
    if not despues_de:
        return len(ids)
    if despues_de == INICIO:
        return 0
    if despues_de not in ids:
        errores.append(f"despues_de: «{despues_de}» no es un {que} de ese sitio (o «inicio»).")
        return None
    return ids.index(despues_de) + 1


def _sitio(lista: list[dict], posicion: int, contenedor: str) -> str:
    """«al principio de «La cuenta»», «en «La cuenta», después de «Crea la cuenta»»: dónde queda algo, para el alumno."""
    if posicion == 0:
        return f"al principio de {contenedor}"
    return f"en {contenedor}, después de «{lista[posicion - 1]['titulo']}»"


def _titulos_pasos(r: Resultado) -> set[str]:
    return {p["titulo"].strip().lower() for n in _niveles(r) for b in n["bloques"] for p in b["pasos"]}


def _lista(titulos: list[str]) -> str:
    return ", ".join(f"«{t}»" for t in titulos)


def _priming(texto: str | None, donde: str, errores: list[str]) -> str:
    t = (texto or "").strip()
    if len(t) < 20:
        errores.append(f"{donde}: falta su priming (qué se hace, por qué en ese orden y qué tendrá al acabar).")
    elif len([x for x in t.splitlines() if x.strip()]) > 6 or len(t) > 900:
        errores.append(f"{donde}: el priming pasa de 5 líneas.")
    return t


def _pasos_nuevos(pasos: list[PasoGen], r: Resultado, errores: list[str], vistos: set[str] | None = None) -> bool:
    existentes = _titulos_pasos(r)
    vistos = set() if vistos is None else vistos
    antes = len(errores)
    for p in pasos:
        errores += errores_paso(p)
        t = p.titulo.strip().lower()
        if t in existentes or t in vistos:
            errores.append(f"Ya hay un paso «{p.titulo}» en el proyecto: dale otro título o cambia el que hay.")
        vistos.add(t)
    return len(errores) == antes


def _olvidar(r: Resultado, ids: set[str]) -> None:
    """Lo hecho de pasos que desaparecen, fuera."""
    r.hechos = [x for x in r.hechos if x not in ids]
    r.hechos_en = {k: v for k, v in r.hechos_en.items() if k not in ids}


# --- Añadir partes ------------------------------------------------------------------------------------------------

def _anadir_pasos(a: Accion, r: Resultado, errores: list[str]) -> None:
    sitio = _bloque(r, a.bloque_id)
    if sitio is None:
        errores.append(f"anadir_pasos: no existe el bloque «{a.bloque_id}»; usa uno de los ids del proyecto.")
        return
    nivel, bloque = sitio
    if not nivel.get("detallado"):
        errores.append(f"El nivel «{nivel['titulo']}» aún no tiene pasos (se detalla desde su botón): no se le pueden añadir.")
        return
    if not a.pasos:
        errores.append("anadir_pasos: faltan los pasos.")
        return
    if not _pasos_nuevos(a.pasos, r, errores):
        return
    if len(bloque["pasos"]) + len(a.pasos) > MAX_PASOS_BLOQUE:
        errores.append(f"El bloque «{bloque['titulo']}» quedaría con más de {MAX_PASOS_BLOQUE} pasos: pon los nuevos en "
                       "un bloque nuevo (nuevo_bloque) o mueve alguno a otro bloque.")
        return
    posicion = _posicion([p["id"] for p in bloque["pasos"]], a.despues_de, "paso", errores)
    if posicion is None:
        return
    siguiente = _siguiente(r, f"{bloque['id']}-p")
    nuevos = [{"id": f"{bloque['id']}-p{siguiente + k}", **p.model_dump()} for k, p in enumerate(a.pasos)]
    bloque["pasos"][posicion:posicion] = nuevos
    r.bloques_tocados.add(bloque["id"])
    r.lineas.append(Linea(f"Añadir {len(nuevos)} {'paso' if len(nuevos) == 1 else 'pasos'} a «{bloque['titulo']}»: "
                          f"{_lista([p.titulo for p in a.pasos])}", a.motivo))


def _bloque_nuevo(r: Resultado, nivel: dict, b: BloqueGen, donde: str, errores: list[str], vistos: set[str],
                  con_pasos: bool, ocupados: set[str]) -> dict | None:
    antes = len(errores)
    titulo = b.titulo.strip()
    if len(titulo) < 3:
        errores.append(f"{donde}: falta el título del bloque.")
    priming = _priming(b.priming, f"El bloque «{titulo}»", errores)
    if con_pasos and not 2 <= len(b.pasos) <= MAX_PASOS_BLOQUE:
        errores.append(f"El bloque «{titulo}» lleva de 2 a {MAX_PASOS_BLOQUE} pasos (tiene {len(b.pasos)}); si es uno "
                       "solo, añádelo a un bloque que ya exista (anadir_pasos).")
    if not con_pasos and b.pasos:
        errores.append(f"El bloque «{titulo}» va en un nivel sin pasos: déjalo sin pasos (se detallan al llegar).")
    if titulo.lower() in {x["titulo"].strip().lower() for x in nivel["bloques"]}:
        errores.append(f"Ya hay un bloque «{titulo}» en el nivel «{nivel['titulo']}».")
    _pasos_nuevos(b.pasos, r, errores, vistos)
    if len(errores) > antes:
        return None
    bid = f"{nivel['id']}-b{_siguiente(r, nivel['id'] + '-b', ocupados)}"
    ocupados.add(bid)
    return {"id": bid, "titulo": titulo, "priming": priming,
            "pasos": [{"id": f"{bid}-p{k}", **p.model_dump()} for k, p in enumerate(b.pasos, 1)]}


def _nuevo_bloque(a: Accion, r: Resultado, errores: list[str]) -> None:
    nivel = _nivel(r, a.nivel_id)
    if nivel is None:
        errores.append(f"nuevo_bloque: no existe el nivel «{a.nivel_id}»; usa su id (como n1).")
        return
    if len(nivel["bloques"]) >= MAX_BLOQUES_NIVEL:
        errores.append(f"El nivel «{nivel['titulo']}» ya tiene {MAX_BLOQUES_NIVEL} bloques: junta alguno o pon esto en otro nivel.")
        return
    posicion = _posicion([b["id"] for b in nivel["bloques"]], a.despues_de, "bloque", errores)
    gen = BloqueGen(titulo=a.titulo or "", priming=a.priming or "", pasos=a.pasos)
    bloque = _bloque_nuevo(r, nivel, gen, "nuevo_bloque", errores, set(), bool(nivel.get("detallado")), set())
    if bloque is None or posicion is None:
        return
    nivel["bloques"].insert(posicion, bloque)
    r.bloques_tocados.add(bloque["id"])
    r.niveles_tocados.add(nivel["id"])
    pasos = f", con {len(a.pasos)} pasos: {_lista([p.titulo for p in a.pasos])}" if a.pasos else ""
    r.lineas.append(Linea(f"Nuevo bloque «{bloque['titulo']}» en el nivel «{nivel['titulo']}»{pasos}", a.motivo))


def _nuevo_nivel(a: Accion, r: Resultado, errores: list[str]) -> None:
    antes = len(errores)
    titulo, objetivo = (a.titulo or "").strip(), (a.objetivo or "").strip()
    if len(titulo) < 3 or len(objetivo) < 10:
        errores.append("nuevo_nivel: hacen falta su título y su objetivo (qué hace el producto al acabarlo, en una frase).")
    if objetivo.lower() in {n["objetivo"].strip().lower() for n in _niveles(r)}:
        errores.append("nuevo_nivel: otro nivel ya tiene ese objetivo; cada nivel hace algo más que el anterior.")
    priming = _priming(a.priming, "nuevo_nivel", errores)
    if not a.bloques:
        errores.append("nuevo_nivel: hace falta al menos un bloque.")
    con_pasos = any(b.pasos for b in a.bloques)
    if con_pasos and not all(b.pasos for b in a.bloques):
        errores.append("nuevo_nivel: o todos sus bloques llevan pasos o ninguno (entonces se detalla al llegar).")
    posicion = _posicion([n["id"] for n in _niveles(r)], a.despues_de, "nivel", errores)
    if len(errores) > antes or posicion is None:
        return
    nivel = {"id": f"n{_siguiente(r, 'n')}", "numero": 0, "titulo": titulo, "objetivo": objetivo, "priming": priming,
             "mvp": False, "detallado": con_pasos, "bloques": []}
    vistos: set[str] = set()
    ocupados: set[str] = set()
    for b in a.bloques:
        bloque = _bloque_nuevo(r, nivel, b, "nuevo_nivel", errores, vistos, con_pasos, ocupados)
        if bloque is not None:
            nivel["bloques"].append(bloque)
    if len(errores) > antes:
        return
    _niveles(r).insert(posicion, nivel)
    _renumerar(r)
    r.niveles_tocados.add(nivel["id"])
    r.lineas.append(Linea(f"Nuevo nivel «{titulo}» (queda el {nivel['numero']}), con {len(a.bloques)} "
                          f"{'bloque' if len(a.bloques) == 1 else 'bloques'}: {_lista([b.titulo for b in a.bloques])}", a.motivo))


# --- Reestructurar ------------------------------------------------------------------------------------------------

def _mover_paso(a: Accion, r: Resultado, errores: list[str]) -> None:
    origen = _paso(r, a.paso_id)
    destino = _bloque(r, a.bloque_id)
    if origen is None or destino is None:
        errores.append(f"mover_paso: hacen falta un paso y un bloque de destino que existan (no «{a.paso_id}» → «{a.bloque_id}»).")
        return
    _, bloque_o, i = origen
    nivel_d, bloque_d = destino
    if not nivel_d.get("detallado"):
        errores.append(f"mover_paso: el nivel «{nivel_d['titulo']}» aún no tiene pasos (se detalla desde su botón).")
        return
    if bloque_d is not bloque_o and len(bloque_d["pasos"]) >= MAX_PASOS_BLOQUE:
        errores.append(f"El bloque «{bloque_d['titulo']}» ya tiene {MAX_PASOS_BLOQUE} pasos.")
        return
    paso = bloque_o["pasos"].pop(i)
    posicion = _posicion([p["id"] for p in bloque_d["pasos"]], a.despues_de, "paso", errores)
    if posicion is None:
        bloque_o["pasos"].insert(i, paso)
        return
    donde = _sitio(bloque_d["pasos"], posicion, f"«{bloque_d['titulo']}»")
    bloque_d["pasos"].insert(posicion, paso)
    r.bloques_tocados |= {bloque_o["id"], bloque_d["id"]}
    r.lineas.append(Linea(f"Mover el paso «{paso['titulo']}» {donde}", a.motivo))


def _mover_bloque(a: Accion, r: Resultado, errores: list[str]) -> None:
    origen = _bloque(r, a.bloque_id)
    if origen is None:
        errores.append(f"mover_bloque: no existe el bloque «{a.bloque_id}».")
        return
    nivel_o, bloque = origen
    nivel_d = _nivel(r, a.nivel_id) if a.nivel_id else nivel_o
    if nivel_d is None:
        errores.append(f"mover_bloque: no existe el nivel «{a.nivel_id}».")
        return
    if nivel_d is not nivel_o:
        if bool(nivel_d.get("detallado")) != bool(bloque["pasos"]):
            errores.append(f"mover_bloque: «{bloque['titulo']}» {'tiene' if bloque['pasos'] else 'no tiene'} pasos y el "
                           f"nivel «{nivel_d['titulo']}» {'no' if bloque['pasos'] else 'sí'} los tiene: no encaja ahí.")
            return
        if len(nivel_o["bloques"]) == 1:
            errores.append(f"«{bloque['titulo']}» es el único bloque de su nivel: quita el nivel (quitar_nivel) o deja el bloque.")
            return
        if len(nivel_d["bloques"]) >= MAX_BLOQUES_NIVEL:
            errores.append(f"El nivel «{nivel_d['titulo']}» ya tiene {MAX_BLOQUES_NIVEL} bloques.")
            return
        if bloque["titulo"].strip().lower() in {b["titulo"].strip().lower() for b in nivel_d["bloques"]}:
            errores.append(f"Ya hay un bloque «{bloque['titulo']}» en el nivel «{nivel_d['titulo']}».")
            return
    i = nivel_o["bloques"].index(bloque)
    nivel_o["bloques"].pop(i)
    posicion = _posicion([b["id"] for b in nivel_d["bloques"]], a.despues_de, "bloque", errores)
    if posicion is None:
        nivel_o["bloques"].insert(i, bloque)
        return
    donde = _sitio(nivel_d["bloques"], posicion, f"el nivel «{nivel_d['titulo']}»").replace("de el nivel", "del nivel")
    nivel_d["bloques"].insert(posicion, bloque)
    r.niveles_tocados |= {nivel_o["id"], nivel_d["id"]}
    r.lineas.append(Linea(f"Mover el bloque «{bloque['titulo']}» {donde}", a.motivo))


_NOMBRES_CAMPO = {"titulo": "título", "que_haces": "qué haces", "antes": "antes", "hecho_si": "hecho si",
                  "minutos": "minutos", "priming": "priming", "objetivo": "objetivo"}


def _cambiar_paso(a: Accion, r: Resultado, errores: list[str]) -> None:
    sitio = _paso(r, a.paso_id)
    if sitio is None:
        errores.append(f"cambiar_paso: no existe el paso «{a.paso_id}».")
        return
    _, bloque, i = sitio
    actual = bloque["pasos"][i]
    campos = {k: v for k, v in (a.campos.model_dump() if a.campos else {}).items() if v is not None and v != actual.get(k)}
    if not campos:
        errores.append(f"cambiar_paso: no cambia nada del paso «{actual['titulo']}».")
        return
    nuevo = {**actual, **campos}
    e = errores_paso(PasoGen.model_validate({k: nuevo[k] for k in PasoGen.model_fields}))
    if "titulo" in campos and nuevo["titulo"].strip().lower() in _titulos_pasos(r):
        e.append(f"Ya hay un paso «{nuevo['titulo']}» en el proyecto.")
    if e:
        errores += e
        return
    bloque["pasos"][i] = nuevo
    r.lineas.append(Linea(_linea_cambio("el paso", actual["titulo"], campos), a.motivo))


def _linea_cambio(que: str, titulo: str, campos: dict) -> str:
    """«Renombrar el bloque «A» a «B»» y, si cambia algo más, «(y su priming)»."""
    otros = [_NOMBRES_CAMPO[k] for k in campos if k != "titulo"]
    if "titulo" not in campos:
        return f"Cambiar {que} «{titulo}» ({', '.join(otros)})"
    return f"Renombrar {que} «{titulo}» a «{campos['titulo']}»" + (f" (y cambiar {', '.join(otros)})" if otros else "")


def _campos_de(a: Accion, actual: dict, permitidos: tuple[str, ...]) -> dict:
    valores = {"titulo": a.titulo, "priming": a.priming, "objetivo": a.objetivo}
    return {k: valores[k].strip() for k in permitidos if valores[k] and valores[k].strip() != actual.get(k)}


def _cambiar_bloque(a: Accion, r: Resultado, errores: list[str]) -> None:
    sitio = _bloque(r, a.bloque_id)
    if sitio is None:
        errores.append(f"cambiar_bloque: no existe el bloque «{a.bloque_id}».")
        return
    nivel, bloque = sitio
    campos = _campos_de(a, bloque, ("titulo", "priming"))
    if not campos:
        errores.append(f"cambiar_bloque: no cambia nada del bloque «{bloque['titulo']}» (pon titulo o priming).")
        return
    antes = len(errores)
    if "priming" in campos:
        _priming(campos["priming"], f"El bloque «{bloque['titulo']}»", errores)
    if "titulo" in campos and campos["titulo"].lower() in {b["titulo"].strip().lower() for b in nivel["bloques"]}:
        errores.append(f"Ya hay un bloque «{campos['titulo']}» en ese nivel.")
    if len(errores) > antes:
        return
    titulo = bloque["titulo"]
    bloque.update(campos)
    r.lineas.append(Linea(_linea_cambio("el bloque", titulo, campos), a.motivo))


def _cambiar_nivel(a: Accion, r: Resultado, errores: list[str]) -> None:
    nivel = _nivel(r, a.nivel_id)
    if nivel is None:
        errores.append(f"cambiar_nivel: no existe el nivel «{a.nivel_id}».")
        return
    campos = _campos_de(a, nivel, ("titulo", "objetivo", "priming"))
    if not campos:
        errores.append(f"cambiar_nivel: no cambia nada del nivel «{nivel['titulo']}» (pon titulo, objetivo o priming).")
        return
    antes = len(errores)
    if "priming" in campos:
        _priming(campos["priming"], f"El nivel «{nivel['titulo']}»", errores)
    if "objetivo" in campos and campos["objetivo"].lower() in {n["objetivo"].strip().lower() for n in _niveles(r)}:
        errores.append("cambiar_nivel: otro nivel ya tiene ese objetivo.")
    if len(errores) > antes:
        return
    titulo = nivel["titulo"]
    nivel.update(campos)
    r.lineas.append(Linea(_linea_cambio("el nivel", titulo, campos), a.motivo))


def _quitar_paso(a: Accion, r: Resultado, errores: list[str]) -> None:
    sitio = _paso(r, a.paso_id)
    if sitio is None:
        errores.append(f"quitar_paso: no existe el paso «{a.paso_id}».")
        return
    _, bloque, i = sitio
    paso = bloque["pasos"].pop(i)
    _olvidar(r, {paso["id"]})
    r.bloques_tocados.add(bloque["id"])
    r.lineas.append(Linea(f"Quitar el paso «{paso['titulo']}»", a.motivo))


def _quitar_bloque(a: Accion, r: Resultado, errores: list[str]) -> None:
    sitio = _bloque(r, a.bloque_id)
    if sitio is None:
        errores.append(f"quitar_bloque: no existe el bloque «{a.bloque_id}».")
        return
    nivel, bloque = sitio
    if len(nivel["bloques"]) == 1:
        errores.append(f"«{bloque['titulo']}» es el único bloque de su nivel: quita el nivel (quitar_nivel) si sobra entero.")
        return
    nivel["bloques"].remove(bloque)
    _olvidar(r, {p["id"] for p in bloque["pasos"]})
    r.niveles_tocados.add(nivel["id"])
    con = f" y sus {len(bloque['pasos'])} pasos" if bloque["pasos"] else ""
    r.lineas.append(Linea(f"Quitar el bloque «{bloque['titulo']}»{con}", a.motivo))


def _quitar_nivel(a: Accion, r: Resultado, errores: list[str]) -> None:
    nivel = _nivel(r, a.nivel_id)
    if nivel is None:
        errores.append(f"quitar_nivel: no existe el nivel «{a.nivel_id}».")
        return
    if len(_niveles(r)) == 1:
        errores.append("quitar_nivel: es el único nivel del proyecto.")
        return
    _niveles(r).remove(nivel)
    _renumerar(r)
    _olvidar(r, ids_de([nivel]))
    pasos = sum(len(b["pasos"]) for b in nivel["bloques"])
    r.lineas.append(Linea(f"Quitar el nivel «{nivel['titulo']}» ({len(nivel['bloques'])} bloques, {pasos} pasos)", a.motivo))


# --- Lo demás -----------------------------------------------------------------------------------------------------

def _marcar_paso(a: Accion, r: Resultado, errores: list[str], momento: str) -> None:
    sitio = _paso(r, a.paso_id)
    if sitio is None or a.hecho is None:
        errores.append(f"marcar_paso: hace falta un paso que exista (no «{a.paso_id}») y si queda hecho o no.")
        return
    paso = sitio[1]["pasos"][sitio[2]]
    if (paso["id"] in r.hechos) == a.hecho:
        errores.append(f"El paso «{paso['titulo']}» ya está {'hecho' if a.hecho else 'pendiente'}.")
        return
    r.hechos = [*r.hechos, paso["id"]] if a.hecho else [x for x in r.hechos if x != paso["id"]]
    r.hechos_en = {k: v for k, v in r.hechos_en.items() if k != paso["id"]}
    if a.hecho:
        r.hechos_en[paso["id"]] = momento
    r.lineas.append(Linea(f"Marcar «{paso['titulo']}» como {'hecho' if a.hecho else 'pendiente'}", a.motivo))


def _apuntar_decision(a: Accion, r: Resultado, errores: list[str]) -> None:
    d = a.decision
    if d is None or len(d.titulo.strip()) < 3 or len(d.decision.strip()) < 3:
        errores.append("apuntar_decision: hacen falta su título y qué se decidió.")
        return
    if d.paso_id and _paso(r, d.paso_id) is None:
        errores.append(f"apuntar_decision: no existe el paso «{d.paso_id}».")
        return
    r.decisiones.append({k: (v.strip() if isinstance(v, str) else v) or None for k, v in d.model_dump().items()})
    r.lineas.append(Linea(f"Apuntar en el diario: «{d.titulo.strip()}»", a.motivo))


def _guardar_nota(a: Accion, r: Resultado, errores: list[str]) -> None:
    texto = (a.nota or "").strip()
    if len(texto) < 3:
        errores.append("guardar_nota: falta el texto que se guarda.")
        return
    r.notas.append(texto)
    corto = texto.splitlines()[0][:70]
    r.lineas.append(Linea(f"Guardar en «Mis notas»: «{corto}{'…' if len(texto) > len(corto) else ''}»", a.motivo))


# --- El plan de estudio activo y tu agenda ------------------------------------------------------------------------
# `plan`: {"plan_id", "tema_id", "tema", "horas_por_dia", "inicio_por_dia", "lecciones": [{clave, titulo, horas,
# depende_de, apuntes}], "sesiones": [{id, clave, fecha, inicio, horas, estado}], "eventos": [{id, fecha, hora, titulo,
# tipo}]}. Fechas ISO y horas «HH:MM», como lo deja `arnes.leer_plan`.

DIAS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
         "diciembre")


def dia(d: date | str) -> str:
    """«jueves 20 de noviembre»."""
    d = date.fromisoformat(d) if isinstance(d, str) else d
    return f"{DIAS[d.weekday()]} {d.day} de {MESES[d.month - 1]}"


def _cuando(fecha: str, inicio: str | None) -> str:
    return dia(fecha) + (f" a las {inicio}" if inicio else "")


def _min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _hhmm(minutos: int) -> str:
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def _hora(texto: str, donde: str, errores: list[str]) -> str | None:
    try:
        return a_hora(texto).strftime("%H:%M")
    except ValueError:
        errores.append(f"{donde}: «{texto}» no es una hora (HH:MM, de 00:00 a 23:59).")
        return None


def _leccion(r: Resultado, clave: str | None) -> dict | None:
    c = (clave or "").strip().lower()
    return next((x for x in r.plan["lecciones"] if x["clave"].lower() == c), None)


def _sesion(r: Resultado, sesion_id: int | None) -> dict | None:
    return next((x for x in r.plan["sesiones"] if x["id"] == sesion_id), None)


def _de(r: Resultado, clave: str) -> list[dict]:
    """Las sesiones que cuentan de una lección (las saltadas no)."""
    return [x for x in r.plan["sesiones"] if x["clave"] == clave and x["estado"] != "saltada"]


def leccion_hecha(plan: dict, leccion: dict) -> bool:
    """Como en Roadmap: hecha si sus sesiones hechas suman sus horas."""
    hechas = sum(x["horas"] for x in plan["sesiones"] if x["clave"] == leccion["clave"] and x["estado"] == "hecha")
    return hechas >= leccion["horas"] - 1e-6


def _nombre(lec: dict) -> str:
    return f"{lec['clave']} «{lec['titulo']}»"


def _horas_del_dia(r: Resultado, d: date) -> float | None:
    """Las horas que estudias ese día de la semana según tu horario, sin pasar de medianoche; None si no hay horario."""
    horas = r.plan.get("horas_por_dia")
    if not horas:
        return None
    inicios = [a_hora(x) for x in (r.plan.get("inicio_por_dia") or [None] * 7)]
    return horas_utiles(horas, inicios)[d.weekday()]


def _hora_libre(r: Resultado, s: dict, fecha: date) -> str | None:
    """Sin hora: detrás de la última sesión de ese día; si no hay, a la hora a la que empiezas ese día; si no, la suya."""
    otras = [x for x in r.plan["sesiones"] if x["fecha"] == fecha.isoformat() and x["id"] != s["id"] and x["inicio"]
             and x["estado"] != "saltada"]
    if otras:
        return _hhmm(max(_min(x["inicio"]) + round(x["horas"] * 60) for x in otras))
    inicio = (r.plan.get("inicio_por_dia") or [None] * 7)[fecha.weekday()]
    return a_hora(inicio).strftime("%H:%M") if inicio else s["inicio"]


def _mover_sesion(a: Accion, r: Resultado, errores: list[str], hoy: date) -> None:
    s = _sesion(r, a.sesion_id)
    if s is None:
        errores.append(f"mover_sesion: no existe la sesión «{a.sesion_id}»; usa el id de una sesión de <plan>.")
        return
    lec = _leccion(r, s["clave"]) or {"clave": s["clave"], "titulo": s["clave"]}
    if s["estado"] != "pendiente":
        errores.append(f"La sesión de {_nombre(lec)} del {dia(s['fecha'])} ya está {s['estado']}: solo se mueven las pendientes.")
        return
    if a.fecha is None:
        errores.append("mover_sesion: falta `fecha`, el día al que va.")
        return
    if a.fecha < hoy:
        errores.append(f"mover_sesion: el {dia(a.fecha)} ya ha pasado (hoy es {dia(hoy)}); muévela a hoy o después.")
        return
    hora = _hora(a.hora, "mover_sesion", errores) if a.hora else _hora_libre(r, s, a.fecha)
    if a.hora and hora is None:
        return
    if hora and _min(hora) + round(s["horas"] * 60) > 24 * 60:
        errores.append(f"Empezando a las {hora}, la sesión de {_nombre(lec)} ({fmt(s['horas'])} h) pasaría de medianoche: "
                       "ponla antes o en otro día.")
        return
    if (a.fecha.isoformat(), hora) == (s["fecha"], s["inicio"]):
        errores.append(f"mover_sesion: la sesión de {_nombre(lec)} ya está el {_cuando(s['fecha'], s['inicio'])}.")
        return
    antes = _cuando(s["fecha"], s["inicio"])
    s["fecha"], s["inicio"] = a.fecha.isoformat(), hora
    r.movidas.add(s["id"])
    r.lineas.append(Linea(f"Mover la sesión de {_nombre(lec)} ({fmt(s['horas'])} h) del {antes} al "
                          f"{_cuando(s['fecha'], s['inicio'])}", a.motivo))


def _marcar_leccion(a: Accion, r: Resultado, errores: list[str], hoy: date) -> None:
    lec = _leccion(r, a.clave)
    if lec is None or a.hecho is None:
        errores.append(f"marcar_leccion: hace falta una lección del plan (no «{a.clave}») y si queda hecha o no.")
        return
    desde, hasta = ("pendiente", "hecha") if a.hecho else ("hecha", "pendiente")
    cuales = [x for x in r.plan["sesiones"] if x["clave"] == lec["clave"] and x["estado"] == desde]
    if not cuales:
        ya = "hecha" if a.hecho and leccion_hecha(r.plan, lec) else "pendiente" if not a.hecho else "sin sesiones pendientes"
        errores.append(f"{_nombre(lec)} ya está {ya}: no hay nada que marcar.")
        return
    for x in cuales:
        x["estado"] = hasta
    r.marcar.append((lec["clave"], a.hecho))
    n = len(cuales)
    r.lineas.append(Linea(f"Marcar {_nombre(lec)} como {'hecha' if a.hecho else 'pendiente'} "
                          f"({n} {'sesión' if n == 1 else 'sesiones'})", a.motivo))


def _preparar_leccion(a: Accion, r: Resultado, errores: list[str], hoy: date) -> None:
    lec = _leccion(r, a.clave)
    if lec is None:
        errores.append(f"preparar_leccion: no existe la lección «{a.clave}» en el plan; usa su clave (L5).")
        return
    if lec.get("apuntes") == "listos":
        errores.append(f"{_nombre(lec)} ya tiene apuntes: para rehacerlos, «Rehacer el material» en Lecciones.")
        return
    if lec.get("apuntes") == "preparandose" or lec["clave"] in r.preparar:
        errores.append(f"Los apuntes de {_nombre(lec)} ya se están preparando.")
        return
    r.preparar.append(lec["clave"])
    r.lineas.append(Linea(f"Preparar los apuntes de {_nombre(lec)} (gasta cuota)", a.motivo, deshace=False))


def _apuntar_evento(a: Accion, r: Resultado, errores: list[str], hoy: date) -> None:
    titulo = (a.titulo or "").strip()[:200]
    antes = len(errores)
    if len(titulo) < 3:
        errores.append("apuntar_evento: falta `titulo`, qué es («Parcial de integrales»).")
    if a.fecha is None:
        errores.append("apuntar_evento: falta `fecha`, el día.")
    elif a.fecha < hoy:
        errores.append(f"apuntar_evento: el {dia(a.fecha)} ya ha pasado; en la agenda se apunta lo que viene.")
    hora = _hora(a.hora, "apuntar_evento", errores) if a.hora else None
    if len(errores) > antes:
        return
    ya = (r.plan or {}).get("eventos", []) + r.eventos
    if any(e["fecha"] == a.fecha.isoformat() and e["titulo"].strip().lower() == titulo.lower() for e in ya):
        errores.append(f"«{titulo}» ya está apuntado el {dia(a.fecha)}.")
        return
    tipo = a.tipo_evento or "deber"
    r.eventos.append({"fecha": a.fecha.isoformat(), "hora": hora, "titulo": titulo, "tipo": tipo})
    r.lineas.append(Linea(f"Apuntar en tu agenda: {tipo} «{titulo}» el {_cuando(a.fecha.isoformat(), hora)}", a.motivo))


_HACER_PLAN = {"mover_sesion": _mover_sesion, "marcar_leccion": _marcar_leccion, "preparar_leccion": _preparar_leccion,
               "apuntar_evento": _apuntar_evento}


def _empieza(x: dict) -> tuple[str, str]:
    return x["fecha"], x["inicio"] or "00:00"


def _como_queda_plan(r: Resultado) -> list[str]:
    """Lo que tiene que cumplir el calendario al final, en los días y lecciones de las sesiones movidas: el día no pasa
    de sus horas, dos sesiones no se pisan y una lección no queda antes de una de la que depende."""
    errores: list[str] = []
    movidas = [x for x in r.plan["sesiones"] if x["id"] in r.movidas]
    titulos = {x["clave"]: x for x in r.plan["lecciones"]}
    for fecha in sorted({x["fecha"] for x in movidas}):
        d = date.fromisoformat(fecha)
        tope = _horas_del_dia(r, d)
        del_dia = [x for x in r.plan["sesiones"] if x["fecha"] == fecha and x["estado"] != "saltada"]
        total = round(sum(x["horas"] for x in del_dia), 2)
        if tope is not None and total > tope + 0.01:
            errores.append(f"El {dia(d)} no tienes horas de estudio en tu horario: elige otro día (el horario se "
                           "cambia en «Roadmap», «Mi horario»)." if tope == 0 else
                           f"El {dia(d)} tendrías {fmt(total)} h de este plan y ese día estudias {fmt(tope)} h: elige "
                           "otro día o mueve también otra sesión de ese día.")
    for m in movidas:
        if not m["inicio"]:
            continue
        a0, a1 = _min(m["inicio"]), _min(m["inicio"]) + round(m["horas"] * 60)
        for x in r.plan["sesiones"]:
            if x["id"] == m["id"] or x["fecha"] != m["fecha"] or not x["inicio"] or x["estado"] == "saltada":
                continue
            b0, b1 = _min(x["inicio"]), _min(x["inicio"]) + round(x["horas"] * 60)
            if a0 < b1 and b0 < a1 and (x["id"] not in r.movidas or x["id"] > m["id"]):
                otra = titulos.get(x["clave"], {"clave": x["clave"], "titulo": x["clave"]})
                errores.append(f"El {dia(m['fecha'])} la sesión de {m['clave']} se pisaría con la de {_nombre(otra)} "
                               f"(de {x['inicio']} a {_hhmm(b1)}): ponla a otra hora.")
    tocadas = {x["clave"] for x in movidas}
    for lec in r.plan["lecciones"]:
        for previa in lec.get("depende_de") or []:
            if lec["clave"] not in tocadas and previa not in tocadas:
                continue
            antes = titulos.get(previa)
            if antes is None or leccion_hecha(r.plan, antes):
                continue
            suyas, de_la_previa = _de(r, lec["clave"]), _de(r, previa)
            if suyas and de_la_previa and min(map(_empieza, suyas)) < max(map(_empieza, de_la_previa)):
                errores.append(f"{_nombre(lec)} quedaría antes de {_nombre(antes)}, de la que depende: muévela después "
                               f"del {dia(max(map(_empieza, de_la_previa))[0])} o mueve también {antes['clave']}.")
    return list(dict.fromkeys(errores))


_HACER = {
    "anadir_pasos": _anadir_pasos, "nuevo_bloque": _nuevo_bloque, "nuevo_nivel": _nuevo_nivel,
    "mover_paso": _mover_paso, "mover_bloque": _mover_bloque, "cambiar_paso": _cambiar_paso,
    "cambiar_bloque": _cambiar_bloque, "cambiar_nivel": _cambiar_nivel, "quitar_paso": _quitar_paso,
    "quitar_bloque": _quitar_bloque, "quitar_nivel": _quitar_nivel, "apuntar_decision": _apuntar_decision,
    "guardar_nota": _guardar_nota,
}


def _como_queda(r: Resultado) -> list[str]:
    """Lo que tiene que cumplir el roadmap al final (en lo que se ha tocado): así un paso puede salir de un bloque y
    entrar otro después, y solo cuenta el resultado."""
    errores = []
    for n in _niveles(r):
        if n["id"] in r.niveles_tocados and not n["bloques"]:
            errores.append(f"El nivel «{n['titulo']}» se queda sin bloques.")
        for b in n["bloques"]:
            if b["id"] not in r.bloques_tocados or not n.get("detallado"):
                continue
            if not 1 <= len(b["pasos"]) <= MAX_PASOS_BLOQUE:
                errores.append(f"El bloque «{b['titulo']}» se queda con {len(b['pasos'])} pasos (de 1 a {MAX_PASOS_BLOQUE}): "
                               "quítalo (quitar_bloque) o reparte los pasos.")
    return errores


def simular(c: Cambios, proyecto: dict | None, momento: str, plan: dict | None = None, hoy: date | None = None) -> Resultado:
    """`proyecto`: {"roadmap", "hechos", "hechos_en"} del proyecto en pantalla, o None si no hay. `momento`: la fecha
    ISO con la que se marcaría un paso como hecho. `plan`: el plan de estudio activo (ver arriba), o None. `hoy`: tu
    día (sin él, el de `momento`); no se mueve ni se apunta nada en el pasado. No toca `proyecto` ni `plan`: trabaja
    sobre una copia."""
    p = copy.deepcopy(proyecto) if proyecto else None
    r = Resultado(roadmap=(p or {}).get("roadmap"), hechos=list((p or {}).get("hechos") or []),
                  hechos_en=dict((p or {}).get("hechos_en") or {}), plan=copy.deepcopy(plan) if plan else None)
    hoy = hoy or date.fromisoformat(momento[:10])
    for a in c.acciones:
        errores: list[str] = []
        if a.tipo in DEL_PLAN and not r.plan:
            errores.append(f"{a.tipo}: no hay ningún plan de estudio activo; esto solo se puede con uno (se crea en "
                           "«Roadmap», «Nuevo plan»).")
        elif a.tipo not in SIN_PROYECTO and not r.roadmap:
            errores.append(f"{a.tipo}: no hay ningún proyecto con roadmap en pantalla; esto solo se puede en uno.")
        elif a.tipo == "marcar_paso":
            _marcar_paso(a, r, errores, momento)
        elif a.tipo in _HACER_PLAN:
            _HACER_PLAN[a.tipo](a, r, errores, hoy)
        else:
            _HACER[a.tipo](a, r, errores)
        r.errores += errores
    if r.roadmap and not r.errores:
        r.errores += _como_queda(r)
    if r.plan and r.movidas and not r.errores:
        r.errores += _como_queda_plan(r)
    return r
