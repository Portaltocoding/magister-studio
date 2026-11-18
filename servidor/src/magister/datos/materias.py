"""El perfil de explicación de cada tema (`temas.materia`): leerlo, guardarlo y pedirlo la primera vez.

Elegir el perfil es cosa de `cerebro.materias`; `datos` no lo importa, así que quien llama pasa la función que elige.
"""

from collections.abc import Awaitable, Callable

from sqlalchemy import select, update

from magister.datos.modelos import Conversacion, Tema
from magister.datos.plan import ConceptoFila, LeccionFila, PlanFila
from magister.datos.sesion import nueva_sesion

Elegir = Callable[[str, list[str]], Awaitable[str | None]]
PorReglas = Callable[[str, list[str]], str | None]


async def pistas(tema_id: int) -> list[str]:
    """Títulos de las lecciones y nombres de los conceptos del plan vigente del tema (el aceptado o, si no, el último)."""
    async with nueva_sesion() as s:
        plan = await s.scalar(select(PlanFila.id).where(PlanFila.tema_id == tema_id).order_by(
            (PlanFila.estado == "aceptado").desc(), PlanFila.version.desc()).limit(1))
        if plan is None:
            return []
        titulos = (await s.scalars(select(LeccionFila.titulo).where(LeccionFila.plan_id == plan).order_by(LeccionFila.orden))).all()
        conceptos = (await s.scalars(select(ConceptoFila.nombre).where(ConceptoFila.plan_id == plan))).all()
    return [*titulos, *conceptos]


async def guardar(tema_id: int, perfil: str | None) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Tema).where(Tema.id == tema_id).values(materia=perfil))


async def asegurar(tema_id: int, elegir: Elegir) -> str | None:
    """El perfil del tema; si aún no tiene, lo elige `elegir` con el nombre y las pistas y lo guarda. None si no se pudo
    decidir (el tema no existe o el modelo no dio nada): entonces no se guarda y se vuelve a intentar otro día."""
    async with nueva_sesion() as s:
        tema = await s.get(Tema, tema_id)
        if tema is None:
            return None
        if tema.materia:
            return tema.materia
        nombre = tema.nombre
    perfil = await elegir(nombre, await pistas(tema_id))
    if perfil:
        await guardar(tema_id, perfil)
    return perfil


async def de_conversacion(conversacion_id: int | None, plan_id: int | None, elegir: Elegir, por_reglas: PorReglas) -> str | None:
    """El perfil de lo que se está hablando: el del tema de la conversación (o el del plan de la lección). Una charla libre
    sin tema solo se clasifica por reglas con su título, que no cuestan nada, y no se guarda."""
    tema_id, titulo = None, ""
    async with nueva_sesion() as s:
        if plan_id is not None:
            tema_id = await s.scalar(select(PlanFila.tema_id).where(PlanFila.id == plan_id))
        if conversacion_id is not None:
            c = await s.get(Conversacion, conversacion_id)
            if c is not None:
                titulo = c.titulo
                tema_id = tema_id or c.tema_id
    if tema_id is not None:
        return await asegurar(tema_id, elegir)
    return por_reglas(titulo, []) if titulo else None
