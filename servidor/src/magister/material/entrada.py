"""La entrada de un material: la lección, sus conceptos ampliados y sus fragmentos de apoyo."""

from sqlalchemy import select, text

from magister.cerebro import materias
from magister.datos import materias as dm
from magister.datos import plan as dp
from magister.datos.modelos import Tema
from magister.datos.plan import ConceptoFila, LeccionFila
from magister.datos.sesion import nueva_sesion
from magister.material.modelos import ConceptoMaterial, EntradaMaterial, FragmentoFuente


class LeccionNoExiste(Exception):
    pass


async def entrada_de_leccion(plan_id: int, leccion_clave: str) -> EntradaMaterial:
    async with nueva_sesion() as s:
        plan = await dp.plan_por_id(s, plan_id)
        lec = await s.get(LeccionFila, (plan_id, leccion_clave))
        if plan is None or lec is None:
            raise LeccionNoExiste(f"no existe la lección {leccion_clave} del plan {plan_id}")
        tema = await s.get(Tema, plan.tema_id)
        conceptos = list((await s.scalars(select(ConceptoFila).where(ConceptoFila.plan_id == plan_id))).all())
        anteriores = {x.clave for x in await dp.lecciones(s, plan_id) if x.orden < lec.orden}
        filas = (await s.execute(text(
            "select f.id, f.texto, d.titulo, fu.tipo from lecciones_fragmentos lf "
            "join fragmentos f on f.id = lf.fragmento_id join versiones v on v.id = f.version_id "
            "join documentos d on d.id = v.documento_id join fuentes fu on fu.id = d.fuente_id "
            "where lf.plan_id = :p and lf.leccion_clave = :c order by lf.rango"
        ), {"p": plan_id, "c": leccion_clave})).all()
    try:
        materia = await dm.asegurar(plan.tema_id, materias.elegir)
    except Exception:  # noqa: BLE001  (si no se puede elegir, los apuntes salen sin perfil, como siempre)
        materia = None
    return EntradaMaterial(
        plan_id=plan_id,
        leccion_clave=leccion_clave,
        tema=tema.nombre if tema else "",
        titulo=lec.titulo,
        objetivos=lec.objetivos,
        conceptos=[
            ConceptoMaterial(id=c.id, nombre=c.nombre, sinonimos=c.sinonimos or [], nucleo=c.nucleo, depende_de=c.depende_de or [])
            for c in conceptos if c.leccion_clave == leccion_clave
        ],
        previos=[c.id for c in conceptos if c.leccion_clave in anteriores],
        fragmentos=[FragmentoFuente(id=i, texto=t, titulo=d, tipo=ti) for i, t, d, ti in filas],
        perfil=plan.perfil or {},
        materia=materia,
    )


def fuentes_delimitadas(entrada: EntradaMaterial, max_caracteres: int = 9000) -> str:
    partes, total = [], 0
    for f in entrada.fragmentos:
        bloque = f'<fragmento id="{f.id}" fuente="{f.titulo} ({f.tipo})">\n{f.texto}\n</fragmento>'
        if total + len(bloque) > max_caracteres:
            break
        partes.append(bloque)
        total += len(bloque)
    return "\n\n".join(partes) or "(sin fuentes del alumno para esta lección: usa tu conocimiento general con rigor)"
