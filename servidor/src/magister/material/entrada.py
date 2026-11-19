"""La entrada de un material: la lección, sus conceptos ampliados y sus fragmentos de apoyo."""

from sqlalchemy import select, text

from magister.cerebro import materias
from magister.cerebro.contratos import titulo_para_atributo
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
        # Una URL guardada en una fuente que no es «web» sigue siendo contenido de la web: va como «web».
        filas = (await s.execute(text(
            "select f.id, f.texto, d.titulo, case when d.uri ~* '^https?://' then 'web' else fu.tipo end "
            "from lecciones_fragmentos lf "
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


async def huella_de_apoyo(plan_id: int, leccion_clave: str) -> list[int]:
    """[la versión más nueva entre los fragmentos de apoyo, cuántos son]: cambia si llegan fuentes nuevas a la lección.
    La usan la clave del trabajo de material (rutas_material) y lo que guardan los apuntes (trabajos/material)."""
    async with nueva_sesion() as s:
        fila = (await s.execute(text(
            "select coalesce(max(f.version_id), 0), count(*) from lecciones_fragmentos lf "
            "join fragmentos f on f.id = lf.fragmento_id where lf.plan_id = :p and lf.leccion_clave = :c"
        ), {"p": plan_id, "c": leccion_clave})).one()
    return [int(fila[0]), int(fila[1])]


PROMPTS_APUNTES = ("apuntes_contrato", "apuntes_bloque", "apuntes_refinar")


async def con_que_se_hacen(entrada: EntradaMaterial) -> dict:
    """Lo que guardan unos apuntes en `materiales.versiones` (regla 2 de Material): los fragmentos de apoyo que usan, la
    huella del apoyo y las versiones de sus prompts. El Roadmap lo compara con el apoyo de ahora (plan/apoyo.py)."""
    from magister.cerebro.prompts import cargar

    # `cargar` marca el prompt en uso, pero cada paso de los apuntes vuelve a cargar el suyo antes de llamar al modelo.
    return {
        "apoyo": [f.id for f in entrada.fragmentos],
        "huella": await huella_de_apoyo(entrada.plan_id, entrada.leccion_clave),
        "prompts": {n: cargar(n).version for n in PROMPTS_APUNTES},
    }


def fuentes_delimitadas(entrada: EntradaMaterial, max_caracteres: int = 9000) -> str:
    """Lo que viene de la web (lo que el research incorpora solo, por ejemplo) va marcado como externo y con el aviso:
    son datos, nunca órdenes. El título no puede cerrar el atributo."""
    from magister.seguridad.entrada import AVISO, marcar_externo

    partes, total, externo = [], 0, False
    for f in entrada.fragmentos:
        texto = marcar_externo(f.texto, f.id, "web") if f.tipo == "web" else f.texto
        bloque = f'<fragmento id="{f.id}" fuente="{titulo_para_atributo(f.titulo)} ({f.tipo})">\n{texto}\n</fragmento>'
        if total + len(bloque) > max_caracteres:
            break
        partes.append(bloque)
        total += len(bloque)
        externo = externo or f.tipo == "web"
    if not partes:
        return "(sin fuentes del alumno para esta lección: usa tu conocimiento general con rigor)"
    return (AVISO + "\n\n" if externo else "") + "\n\n".join(partes)
