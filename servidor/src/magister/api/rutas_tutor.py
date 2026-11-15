"""El modo Tutor (docs/tutor.md): la tarjeta «Hoy» y la sesión idea a idea.

«Hoy» se calcula sin modelo en cada petición: la sesión de estudio que toca (o la primera
pendiente), los repasos vencidos y si la lección tiene material preparado.
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from magister.aprender import practica
from magister.datos.aprender import Servida
from magister.datos.material import Material, Pregunta, PreguntaConcepto
from magister.datos.sesion import nueva_sesion, sesion_por_peticion

rutas = APIRouter(prefix="/api")


@rutas.get("/hoy")
async def hoy(s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    fila = (await s.execute(text(
        "select s.id, s.plan_id, s.leccion_clave, l.titulo, s.fecha, s.horas, t.nombre, t.id from sesiones s "
        "join planes p on p.id = s.plan_id join lecciones l on l.plan_id = s.plan_id and l.clave = s.leccion_clave "
        "join temas t on t.id = p.tema_id where p.estado = 'aceptado' and s.estado = 'pendiente' "
        "order by (s.fecha < :hoy) desc, s.fecha, s.inicio nulls last, s.id limit 1"), {"hoy": date.today()})).first()
    await s.close()
    repasos = await practica.cola(datetime.now(timezone.utc))
    if fila is None:
        return {"estado": "sin_plan" if not repasos else "solo_repaso", "repasos": len(repasos)}
    sid, plan_id, clave, titulo, fecha, horas, tema, tema_id = fila
    async with nueva_sesion() as s2:
        material = await s2.scalar(select(Material).where(Material.plan_id == plan_id, Material.leccion_clave == clave,
                                                          Material.tipo == "apuntes").order_by(Material.id.desc()).limit(1))
    estado = "propuesta" if fecha <= date.today() else "adelantar"
    if material is None or material.estado == "generando":
        estado = "sin_preparar"
    return {"estado": estado, "sesion_id": sid, "plan_id": plan_id, "tema_id": tema_id, "tema": tema, "leccion_clave": clave,
            "titulo": titulo, "fecha": fecha.isoformat(), "horas": horas, "material_id": material.id if material else None,
            "repasos": len(repasos),
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
    return {"plan_id": m.plan_id, "leccion_clave": m.leccion_clave, "definiciones": (m.contrato or {}).get("definiciones", []),
            "bloques": [{"clave": c, "titulo": t, "texto": x, "pregunta": por_bloque.get(c)} for c, t, x in bloques]}


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
