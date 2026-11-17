"""El modo Tutor (docs/tutor.md): la tarjeta «Hoy» y la sesión idea a idea.

«Hoy» se calcula sin modelo en cada petición: la sesión de estudio que toca (o la primera
pendiente), los repasos vencidos y si la lección tiene material preparado.
"""

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
    """El primer examen del plan que ya toca (hoy o atrasado) y aún no has aprobado."""
    from magister.datos import plan as dp
    from magister.flujo.planes import examenes_del_plan

    async with nueva_sesion() as s:
        for fila, nombre in await dp.planes_aceptados(s):
            lecs = await dp.lecciones(s, fila.id)
            ses = await dp.sesiones(s, fila.id)
            for h in await examenes_del_plan(s, fila.id, lecs, ses):
                if not h["hecho"] and date.fromisoformat(h["fecha"]) <= hoy_:
                    return {**h, "plan_id": fila.id, "tema": nombre}
    return None


@rutas.get("/hoy")
async def hoy(s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    fila = (await s.execute(text(
        "select s.id, s.plan_id, s.leccion_clave, l.titulo, s.fecha, s.horas, t.nombre, t.id, s.inicio from sesiones s "
        "join planes p on p.id = s.plan_id join lecciones l on l.plan_id = s.plan_id and l.clave = s.leccion_clave "
        "join temas t on t.id = p.tema_id where p.estado = 'aceptado' and s.estado = 'pendiente' "
        "order by (s.fecha < :hoy) desc, s.fecha, s.inicio nulls last, s.id limit 1"), {"hoy": date.today()})).first()
    await s.close()
    repasos = await practica.cola(datetime.now(timezone.utc))
    examen = await examen_pendiente(date.today())
    from magister.material.estudio import repasos_de_tema

    temas = [t for t in await repasos_de_tema() if t["vencido"]]
    async with nueva_sesion() as s3:
        # Cada sesión del día con lo necesario para estudiarla desde el tutor: su id y sus apuntes (si ya están).
        dia = [{"clave": c, "titulo": t, "horas": h, "estado": e, "sesion_id": sid_, "plan_id": pid_, "material_id": mid_}
               for c, t, h, e, sid_, pid_, mid_ in (await s3.execute(text(
            "select s.leccion_clave, l.titulo, s.horas, s.estado, s.id, s.plan_id, "
            "(select m.id from materiales m where m.plan_id = s.plan_id and m.leccion_clave = s.leccion_clave and m.tipo = 'apuntes' "
            "and m.estado <> 'generando' order by m.id desc limit 1) "
            "from sesiones s join planes p on p.id = s.plan_id and p.estado = 'aceptado' "
            "join lecciones l on l.plan_id = s.plan_id and l.clave = s.leccion_clave where s.fecha = :hoy order by s.inicio nulls last, s.id"),
            {"hoy": date.today()})).all()]
    if fila is None:
        return {"estado": "sin_plan" if not repasos and not examen else "solo_repaso", "repasos": len(repasos), "nuevos": sum(1 for r in repasos if r["nuevo"]), "examen": examen, "dia": dia, "temas": temas}
    sid, plan_id, clave, titulo, fecha, horas, tema, tema_id, inicio = fila
    async with nueva_sesion() as s2:
        material = await s2.scalar(select(Material).where(Material.plan_id == plan_id, Material.leccion_clave == clave,
                                                          Material.tipo == "apuntes").order_by(Material.id.desc()).limit(1))
    estado = "propuesta" if fecha <= date.today() else "adelantar"
    if material is None or material.estado == "generando":
        estado = "sin_preparar"
    return {"estado": estado, "sesion_id": sid, "plan_id": plan_id, "tema_id": tema_id, "tema": tema, "leccion_clave": clave,
            "titulo": titulo, "fecha": fecha.isoformat(), "inicio": inicio.strftime("%H:%M") if inicio else None, "horas": horas, "material_id": material.id if material else None,
            "repasos": len(repasos), "nuevos": sum(1 for r in repasos if r["nuevo"]), "examen": examen, "dia": dia, "temas": temas,
            "razon": ("Toca hoy según tu calendario." if fecha == date.today() else
                      "Vas con retraso: es la primera sesión pendiente." if fecha < date.today() else
                      f"Lo siguiente de tu calendario es el {fecha:%d-%m}.")}


@rutas.get("/tutor/leccion/{material_id}")
async def leccion(material_id: int, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    m = await s.get(Material, material_id)
    if m is None:
        raise HTTPException(404, "material no encontrado")
    bloques = (await s.execute(text(
        "select clave, titulo, texto from bloques_material where material_id = :m order by length(clave), clave"), {"m": material_id})).all()
    preguntas = (await s.execute(
        select(Pregunta.id, Pregunta.donde, Pregunta.enunciado, PreguntaConcepto.concepto_id)
        .join(PreguntaConcepto, PreguntaConcepto.pregunta_id == Pregunta.id)
        .where(Pregunta.plan_id == m.plan_id, Pregunta.leccion_clave == m.leccion_clave, Pregunta.estado == "activa")
        .order_by(Pregunta.id))).all()
    por_bloque: dict[str, dict] = {}
    for pid, donde, enunciado, cid in preguntas:
        por_bloque.setdefault(donde or "", {"pregunta_id": pid, "enunciado": enunciado, "concepto_id": cid})
    titulo, tema, _ = await almacen.datos_leccion(m.plan_id, m.leccion_clave)
    contrato = m.contrato or {}
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
        mapa.append({"clave": b["clave"], "titulo": b["titulo"], "proposito": b.get("proposito", ""),
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
