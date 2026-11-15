"""Enriquecer los conceptos de una lección (sinónimos, núcleo, dependencias) una sola vez."""

from datetime import datetime, timezone

from pydantic import BaseModel
from sqlalchemy import select, update

from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.prompts import cargar
from magister.datos.plan import ConceptoFila
from magister.datos.sesion import nueva_sesion


class Enriquecido(BaseModel):
    id: str
    sinonimos: list[str]
    nucleo: bool
    depende_de: list[str]


class ListaEnriquecida(BaseModel):
    conceptos: list[Enriquecido]


async def enriquecer(plan_id: int, leccion_clave: str, titulo: str, objetivos: list[str]) -> int:
    """Devuelve cuántos conceptos se han enriquecido (0 si ya lo estaban)."""
    async with nueva_sesion() as s:
        filas = list((await s.scalars(select(ConceptoFila).where(
            ConceptoFila.plan_id == plan_id, ConceptoFila.leccion_clave == leccion_clave))).all())
    pendientes = [c for c in filas if c.enriquecido_en is None]
    if not pendientes:
        return 0
    ids = {c.id for c in filas}
    lista = "\n".join(f"- {c.id}: {c.nombre}" for c in filas)
    sistema = cargar("conceptos").rellenar(titulo=titulo, objetivos="; ".join(objetivos), conceptos=lista)
    try:
        r = await estructurar(sistema, "Devuelve los conceptos enriquecidos.", ListaEnriquecida)
        por_id = {e.id: e for e in r.conceptos}
    except ErrorEstructura:
        por_id = {}
    ahora = datetime.now(timezone.utc)
    async with nueva_sesion() as s, s.begin():
        for c in pendientes:
            e = por_id.get(c.id)
            await s.execute(update(ConceptoFila).where(ConceptoFila.plan_id == plan_id, ConceptoFila.id == c.id).values(
                sinonimos=e.sinonimos[:8] if e else [],
                nucleo=e.nucleo if e else True,
                # Solo dependencias dentro de la lección: las de lecciones anteriores ya las da el plan.
                depende_de=[d for d in (e.depende_de if e else []) if d in ids and d != c.id],
                enriquecido_en=ahora,
            ))
    return len(pendientes)
