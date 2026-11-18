"""Los vídeos dentro del roadmap: cuántos quieres (tu preferencia), qué lecciones los llevan y la automatización.

La elección es de `plan.videos` (código puro); aquí se leen de la base las lecciones, sus conceptos, de cuántas
dependen, lo que has fallado de sus conceptos y si ya tienen vídeo. La preferencia vive en `instalacion` («videos»).
"""

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert

from magister.datos.produccion import Ajuste
from magister.datos.sesion import nueva_sesion
from magister.plan import videos

POR_DEFECTO = {"cuantos": "normal", "minutos": 6, "estilo": "clase"}
MINUTOS = (3, 6, 10)


async def preferencias() -> dict:
    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, "videos")
    return {**POR_DEFECTO, **((fila.valor or {}) if fila else {})}


async def guardar_preferencias(cambios: dict) -> dict:
    p = await preferencias()
    if cambios.get("hacia") in ("mas", "menos"):
        p["cuantos"] = videos.mover(p["cuantos"], cambios["hacia"])
    if cambios.get("cuantos") in videos.CUANTOS:
        p["cuantos"] = cambios["cuantos"]
    if cambios.get("minutos") in MINUTOS:
        p["minutos"] = cambios["minutos"]
    if cambios.get("estilo"):
        p["estilo"] = str(cambios["estilo"])[:20]
    async with nueva_sesion() as s:
        await s.execute(insert(Ajuste).values(clave="videos", valor=p)
                        .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": p}))
        await s.commit()
    return p


async def lecciones_del_plan(plan_id: int) -> list[videos.LeccionVideo]:
    async with nueva_sesion() as s:
        filas = (await s.execute(text("""
            select l.clave, l.titulo, l.horas,
              (select count(*) from conceptos c where c.plan_id = l.plan_id and c.leccion_clave = l.clave),
              (select count(*) from dependencias d where d.plan_id = l.plan_id and d.leccion_clave = l.clave),
              (select count(*) from intentos i join conceptos c on c.plan_id = i.plan_id and c.id = i.concepto_id
                 where i.plan_id = l.plan_id and c.leccion_clave = l.clave and i.tipo <> 'reintento'),
              (select count(*) from intentos i join conceptos c on c.plan_id = i.plan_id and c.id = i.concepto_id
                 where i.plan_id = l.plan_id and c.leccion_clave = l.clave and i.tipo <> 'reintento'
                   and coalesce(i.nota_usuario, i.nota_corrector) in ('fallo', 'parcial')),
              exists(select 1 from materiales m where m.plan_id = l.plan_id and m.leccion_clave = l.clave
                       and m.tipo = 'guion' and m.estado in ('listo', 'revisar'))
            from lecciones l where l.plan_id = :p order by l.orden"""), {"p": plan_id})).all()
    return [videos.LeccionVideo(c, t, float(h), int(nc), int(nd), int(r), int(f), bool(v)) for c, t, h, nc, nd, r, f, v in filas]


async def recomendadas(plan_id: int, cuantos: str | None = None) -> list[videos.Recomendada]:
    cuantos = cuantos or (await preferencias())["cuantos"]
    return videos.elegir(await lecciones_del_plan(plan_id), cuantos)
