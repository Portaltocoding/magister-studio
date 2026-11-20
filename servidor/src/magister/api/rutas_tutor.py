"""El modo Tutor (docs/tutor.md): la tarjeta «Hoy» y la sesión idea a idea.

«Hoy» se calcula sin modelo en cada petición: la sesión de estudio que toca (o la primera
pendiente), los repasos vencidos y si la lección tiene material preparado.
"""

import asyncio
from datetime import date, datetime, timezone

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from magister.aprender import practica
from magister.datos.aprender import Servida
from magister.datos.material import Material, Pregunta, PreguntaConcepto
from magister.datos.sesion import nueva_sesion, sesion_por_peticion
from magister.material import almacen

rutas = APIRouter(prefix="/api")


async def examen_pendiente(hoy_: date) -> dict | None:
    """El primer examen del plan que ya toca (hoy o atrasado) y aún no has aprobado.

    Cuatro consultas en total, tengas los planes que tengas (antes eran tres por plan): los planes, y las lecciones,
    las fechas de las sesiones y los exámenes terminados de todos ellos. El cálculo es el de `examenes_del_plan`."""
    from collections import defaultdict

    from magister.datos import plan as dp
    from magister.datos.aprender import Examen
    from magister.plan.examenes import con_estado, hitos

    async with nueva_sesion() as s:
        planes = await dp.planes_aceptados(s)
        if not planes:
            return None
        ids = [fila.id for fila, _ in planes]
        lecs = (await s.execute(select(dp.LeccionFila.plan_id, dp.LeccionFila.clave).where(dp.LeccionFila.plan_id.in_(ids))
                                .order_by(dp.LeccionFila.plan_id, dp.LeccionFila.orden))).all()
        ses = (await s.execute(select(dp.SesionFila.plan_id, dp.SesionFila.leccion_clave, dp.SesionFila.fecha, dp.SesionFila.estado)
                               .where(dp.SesionFila.plan_id.in_(ids)))).all()
        exs = (await s.execute(select(Examen.plan_id, Examen.lecciones, Examen.nota)
                               .where(Examen.plan_id.in_(ids), Examen.terminado.is_not(None)))).all()
    claves: dict[int, list[str]] = defaultdict(list)
    for pid, clave in lecs:
        claves[pid].append(clave)
    ultima: dict[int, dict] = defaultdict(dict)
    # Las lecciones con algo aún por estudiar: su parcial no se propone hasta cerrarlas (las saltadas sí cuentan como vistas).
    pendientes: dict[int, set[str]] = defaultdict(set)
    for pid, clave, fecha, estado in ses:
        ultima[pid][clave] = max(ultima[pid].get(clave, fecha), fecha)
        if estado == "pendiente":
            pendientes[pid].add(clave)
    hechos: dict[int, list] = defaultdict(list)
    for pid, lecciones_examen, nota in exs:
        hechos[pid].append((set(lecciones_examen or []), nota))
    for fila, nombre in planes:
        for h in con_estado(hitos(claves[fila.id], ultima[fila.id]), hechos[fila.id]):
            if not h["hecho"] and date.fromisoformat(h["fecha"]) <= hoy_ and not set(h["lecciones"]) & pendientes[fila.id]:
                return {**h, "plan_id": fila.id, "tema": nombre}
    return None


async def _sesion_que_toca(hoy_: date):
    """La sesión que toca (o la primera pendiente) con sus últimos apuntes, en una sola consulta."""
    async with nueva_sesion() as s:
        return (await s.execute(text(
            "select s.id, s.plan_id, s.leccion_clave, l.titulo, s.fecha, s.horas, t.nombre, t.id, s.inicio, m.id, m.estado from sesiones s "
            "join planes p on p.id = s.plan_id join lecciones l on l.plan_id = s.plan_id and l.clave = s.leccion_clave "
            "join temas t on t.id = p.tema_id "
            "left join lateral (select m.id, m.estado from materiales m where m.plan_id = s.plan_id and m.leccion_clave = s.leccion_clave "
            "and m.tipo = 'apuntes' order by m.id desc limit 1) m on true "
            "where p.estado = 'aceptado' and s.estado = 'pendiente' "
            "order by (s.fecha < :hoy) desc, s.fecha, s.inicio nulls last, s.id limit 1"), {"hoy": hoy_})).first()


async def _sesiones_del_dia(hoy_: date) -> list[dict]:
    """Cada sesión del día con lo necesario para estudiarla desde el tutor: su id y sus apuntes (si ya están)."""
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select s.leccion_clave, l.titulo, s.horas, s.estado, s.id, s.plan_id, "
            "(select m.id from materiales m where m.plan_id = s.plan_id and m.leccion_clave = s.leccion_clave and m.tipo = 'apuntes' "
            "and m.estado <> 'generando' order by m.id desc limit 1) "
            "from sesiones s join planes p on p.id = s.plan_id and p.estado = 'aceptado' "
            "join lecciones l on l.plan_id = s.plan_id and l.clave = s.leccion_clave where s.fecha = :hoy order by s.inicio nulls last, s.id"),
            {"hoy": hoy_})).all()
    return [{"clave": c, "titulo": t, "horas": h, "estado": e, "sesion_id": sid_, "plan_id": pid_, "material_id": mid_}
            for c, t, h, e, sid_, pid_, mid_ in filas]


async def _temas_vencidos() -> list[dict]:
    from magister.material.estudio import repasos_de_tema

    return [t for t in await repasos_de_tema() if t["vencido"]]


@rutas.get("/hoy")
async def hoy() -> dict:
    # Las cinco piezas no dependen unas de otras: van a la vez, cada una con su conexión.
    hoy_ = date.today()
    fila, repasos, examen, temas, dia = await asyncio.gather(
        _sesion_que_toca(hoy_), practica.cola(datetime.now(timezone.utc)), examen_pendiente(hoy_), _temas_vencidos(),
        _sesiones_del_dia(hoy_))
    if fila is None:
        return {"estado": "sin_plan" if not repasos and not examen else "solo_repaso", "repasos": len(repasos), "nuevos": sum(1 for r in repasos if r["nuevo"]), "examen": examen, "dia": dia, "temas": temas}
    sid, plan_id, clave, titulo, fecha, horas, tema, tema_id, inicio, material_id, material_estado = fila
    estado = "propuesta" if fecha <= hoy_ else "adelantar"
    if material_id is None or material_estado == "generando":
        estado = "sin_preparar"
    return {"estado": estado, "sesion_id": sid, "plan_id": plan_id, "tema_id": tema_id, "tema": tema, "leccion_clave": clave,
            "titulo": titulo, "fecha": fecha.isoformat(), "inicio": inicio.strftime("%H:%M") if inicio else None, "horas": horas, "material_id": material_id,
            "repasos": len(repasos), "nuevos": sum(1 for r in repasos if r["nuevo"]), "examen": examen, "dia": dia, "temas": temas,
            "razon": ("Toca hoy según tu calendario." if fecha == hoy_ else
                      "Vas con retraso: es la primera sesión pendiente." if fecha < hoy_ else
                      f"Lo siguiente de tu calendario es el {fecha:%d-%m}.")}


def colocar_preguntas(preguntas, bloques_contrato: list[dict]) -> dict[str, dict]:
    """La comprobación de cada bloque del modo foco: una pregunta sobre una idea de ESE bloque.

    `preguntas` son filas (pregunta_id, donde, enunciado, concepto_id) en orden de id (una por concepto de la
    pregunta); `bloques_contrato`, los bloques del contrato con sus `conceptos`. Una pregunta va a su `donde` si
    alguno de sus conceptos está en ese bloque y, si no, al bloque de su concepto (si un concepto está en varios,
    al que tiene menos conceptos). Si ninguno de sus conceptos está en ningún bloque (material sin contrato), se
    queda en su `donde`. Cada pregunta ocupa un solo bloque y en cada bloque gana la primera que llega."""
    conceptos_de: dict[str, set[str]] = {b["clave"]: set(b.get("conceptos") or []) for b in bloques_contrato if b.get("clave")}
    bloque_de: dict[str, str] = {}
    for clave, cs in conceptos_de.items():
        for cid in cs:
            if cid not in bloque_de or len(cs) < len(conceptos_de[bloque_de[cid]]):
                bloque_de[cid] = clave  # a igualdad, el primero
    filas: dict[str, tuple[str | None, str, list[str]]] = {}
    for pid, donde, enunciado, cid in preguntas:
        filas.setdefault(pid, (donde, enunciado, []))[2].append(cid)
    por_bloque: dict[str, dict] = {}
    for pid, (donde, enunciado, cids) in filas.items():
        propio = next((c for c in cids if c in conceptos_de.get(donde or "", ())), None)
        if propio is not None:
            clave, cid = donde, propio
        else:
            cid = next((c for c in cids if c in bloque_de), None)
            clave = bloque_de[cid] if cid is not None else (donde or "")
            cid = cid if cid is not None else cids[0]
        por_bloque.setdefault(clave, {"pregunta_id": pid, "enunciado": enunciado, "concepto_id": cid})
    return por_bloque


def con_tipo(por_bloque: dict[str, dict], tipos: dict[str, str]) -> dict[str, dict]:
    """Cada comprobación con su tipo: en las «habladas», el foco ofrece dictar la respuesta."""
    return {clave: {**p, "tipo": tipos.get(p["pregunta_id"])} for clave, p in por_bloque.items()}


@rutas.get("/tutor/leccion/{material_id}")
async def leccion(material_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    m = await s.get(Material, material_id)
    if m is None:
        raise HTTPException(404, "material no encontrado")
    bloques = (await s.execute(text(
        "select clave, titulo, texto from bloques_material where material_id = :m order by length(clave), clave"), {"m": material_id})).all()
    filas = (await s.execute(
        select(Pregunta.id, Pregunta.donde, Pregunta.enunciado, PreguntaConcepto.concepto_id, Pregunta.tipo)
        .join(PreguntaConcepto, PreguntaConcepto.pregunta_id == Pregunta.id)
        .where(Pregunta.plan_id == m.plan_id, Pregunta.leccion_clave == m.leccion_clave, Pregunta.estado == "activa")
        .order_by(Pregunta.id))).all()
    titulo, tema, _ = await almacen.datos_leccion(m.plan_id, m.leccion_clave)
    contrato = m.contrato or {}
    por_bloque = con_tipo(colocar_preguntas([f[:4] for f in filas], contrato.get("bloques", [])), {f[0]: f[4] for f in filas})
    return {"plan_id": m.plan_id, "leccion_clave": m.leccion_clave, "titulo": titulo, "tema": tema,
            "definiciones": contrato.get("definiciones", []), "formulas": contrato.get("formulas", []),
            "bloques": [{"clave": c, "titulo": t, "texto": x, "pregunta": por_bloque.get(c)} for c, t, x in bloques],
            "calentamiento": await _calentamiento(s, m, contrato, {v["pregunta_id"] for v in por_bloque.values()})}


async def _calentamiento(s: AsyncSession, m: Material, contrato: dict, usadas: set[str]) -> dict:
    """Priming: el mapa de la lección (apartados, conceptos y de qué depende cada uno) y tres preguntas para
    contestar a ojo antes de estudiar (efecto pretest). Preferidas las tipo test que no son comprobaciones del foco."""
    from magister.datos.plan import ConceptoFila

    conceptos = {c.id: c for c in (await s.scalars(select(ConceptoFila).where(
        ConceptoFila.plan_id == m.plan_id, ConceptoFila.leccion_clave == m.leccion_clave))).all()}
    nombres = {c.id: c.nombre for c in conceptos.values()}
    mapa = []
    for b in contrato.get("bloques", []):
        # Sin el propósito del bloque: es la nota interna del generador y destripaba las preguntas previas.
        mapa.append({"clave": b["clave"], "titulo": b["titulo"],
                     "conceptos": [{"id": cid, "nombre": nombres.get(cid, cid),
                                    "necesita": [nombres.get(d, d) for d in (conceptos[cid].depende_de if cid in conceptos else [])]}
                                   for cid in b.get("conceptos", [])]})
    filas = (await s.execute(select(Pregunta.id, Pregunta.tipo, Pregunta.enunciado, Pregunta.opciones, Pregunta.fantasma).where(
        Pregunta.plan_id == m.plan_id, Pregunta.leccion_clave == m.leccion_clave, Pregunta.estado == "activa",
        Pregunta.sonda.is_(False)).order_by(Pregunta.id))).all()
    libres = [f for f in filas if f[0] not in usadas]
    elegidas = ([f for f in libres if f[3]] + [f for f in libres if not f[3]])[:3]
    previas = [{"pregunta_id": pid, "enunciado": enunciado,
                "opciones": [o["texto"] for o in opciones] if opciones else None,
                "buena": next((o["texto"] for o in opciones if o.get("buena")), None) if opciones else None,
                "respuesta": fantasma}
               for pid, _tipo, enunciado, opciones, fantasma in elegidas]
    return {"mapa": mapa, "previas": previas}


@rutas.post("/tutor/servir/{pregunta_id}")
async def servir(pregunta_id: str) -> dict:
    """Sirve una pregunta concreta de la sesión y apuesta `p_predicha` antes de corregir."""
    async with nueva_sesion() as s:
        p = await s.get(Pregunta, pregunta_id)
        cid = await s.scalar(select(PreguntaConcepto.concepto_id).where(PreguntaConcepto.pregunta_id == pregunta_id))
    if p is None or cid is None:
        raise HTTPException(404, "pregunta no encontrada")
    ahora = datetime.now(timezone.utc)
    estado, prog = await practica.estado_y_programador(p.plan_id, cid, ahora)
    pr = prog.p_recordar(estado, ahora)
    async with nueva_sesion() as s, s.begin():
        s.add(Servida(plan_id=p.plan_id, concepto_id=cid, pregunta_id=pregunta_id, momento=ahora, p_predicha=pr,
                      version_programador=prog.version))
    return {"pregunta_id": pregunta_id, "concepto_id": cid, "enunciado": p.enunciado, "p": round(pr, 3)}



class ModoPropio(BaseModel):
    id: str = Field(max_length=60)
    nombre: str = Field(max_length=60)
    para: str = Field("", max_length=200)
    reglas: list[str] = Field(default_factory=list, max_length=10)


class Apariencia(BaseModel):
    modo: Literal["auto", "fijo"] = "fijo"
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    paleta: list[str] = Field(default_factory=list, max_length=20)


@rutas.put("/apariencia")
async def guardar_apariencia(a: Apariencia) -> dict:
    """El acento de la app, para que los PDF (apuntes y libro del tema) salgan con el mismo color."""
    from sqlalchemy.dialects.postgresql import insert

    from magister.datos.produccion import Ajuste

    valor = {"modo": a.modo, "color": a.color, "paleta": [c for c in a.paleta if len(c) == 7 and c.startswith("#")]}
    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(Ajuste).values(clave="acento", valor=valor)
                        .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": valor}))
    return valor


class PreferenciasTutor(BaseModel):
    longitud: Literal["breve", "normal", "detallada"] = "normal"
    nivel: Literal["cero", "normal", "experto"] = "normal"
    estilo: Literal["directo", "analogias", "codigo"] = "directo"
    diagramas: bool = True
    tests: bool = True
    opciones: bool = True
    idioma: Literal["es", "en"] = "es"
    # Cómo te llama la mascota (lo pregunta la bienvenida; se cambia en Ajustes).
    nombre: str = Field("", max_length=60)
    instrucciones: list[str] = Field(default_factory=list, max_length=30)
    modos: list[ModoPropio] = Field(default_factory=list, max_length=20)
    modo: str | None = None


@rutas.get("/preferencias")
async def ver_preferencias() -> dict:
    from magister.flujo.comun import MODOS_DE_SERIE, preferencias_tutor

    return {**await preferencias_tutor(), "modos_de_serie": MODOS_DE_SERIE}


@rutas.put("/preferencias")
async def guardar_preferencias(cuerpo: PreferenciasTutor) -> dict:
    """Lo que ajustas desde la mascota: el tutor lo tiene en cuenta desde el siguiente mensaje."""
    from sqlalchemy.dialects.postgresql import insert

    from magister.datos.produccion import Ajuste

    from magister.flujo.comun import MODOS_DE_SERIE, preferencias_tutor

    # Se mezcla con lo guardado: quien solo cambia la longitud no borra tus instrucciones ni tus modos.
    valor = {**await preferencias_tutor(), **cuerpo.model_dump(exclude_unset=True)}
    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(Ajuste).values(clave="tutor", valor=valor)
                        .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": valor}))
    return {**valor, "modos_de_serie": MODOS_DE_SERIE}



class ReglaPreparar(BaseModel):
    activa: bool = False
    dias_antes: int = 1


class ReglaSimple(BaseModel):
    activa: bool = False


class ReglaVideo(BaseModel):
    activa: bool = False
    estilo: Literal["clase", "resumen", "analogias", "examen"] = "clase"
    minutos: int = 6


class Automatizaciones(BaseModel):
    preparar_siguiente: ReglaPreparar = ReglaPreparar()
    diapositivas_al_preparar: ReglaSimple = ReglaSimple()
    video_al_preparar: ReglaVideo = ReglaVideo()
    solo_de_noche: bool = False


@rutas.get("/automatizaciones")
async def ver_automatizaciones() -> dict:
    from magister.trabajos import automatizar

    return {"reglas": await automatizar.leer(), "registro": await automatizar.ver_registro()}


@rutas.put("/automatizaciones")
async def guardar_automatizaciones(cuerpo: Automatizaciones) -> dict:
    from magister.trabajos import automatizar

    return {"reglas": await automatizar.guardar(cuerpo.model_dump()), "registro": await automatizar.ver_registro()}


@rutas.post("/automatizaciones/ahora")
async def automatizar_ahora() -> dict:
    """Revisa las reglas ya, sin esperar a la siguiente vuelta (respeta «solo de noche»)."""
    from magister.trabajos import automatizar

    return {"hecho": await automatizar.una_vuelta()}
