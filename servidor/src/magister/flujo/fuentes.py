"""Lo que el plan sabe de las fuentes: el índice para planificar y el apoyo por lección.

El `Buscador` llega inyectado; `flujo` no importa `magister.fuentes`.
"""

from magister.cerebro.contratos import Buscador, Consulta, Filtros
from magister.config import ajustes
from magister.datos import conversaciones as dc
from magister.datos import plan as dp
from magister.datos import repositorio_fuentes as rf
from magister.datos.sesion import nueva_sesion

SIN_FUENTES = "(sin fuentes del alumno sobre este tema)"


async def contexto_para_plan(buscador: Buscador | None, tema: str) -> str:
    if buscador is None or not tema:
        return SIN_FUENTES
    async with nueva_sesion() as s:
        fila = await dc.tema_por_nombre(s, tema)
    if fila is not None:
        indice = await buscador.indice_fuentes(fila.id)
        if indice:
            return indice
    r = await buscador.buscar(tema, 8, Filtros(), None)
    titulos = list(dict.fromkeys(x.documento_titulo for x in r.recuperados if x.documento_titulo))
    escalon = r.escalon(ajustes.umbral_fuentes, ajustes.umbral_reranker)
    if r.busqueda_id is not None:
        try:
            await rf.anotar_escalon(r.busqueda_id, escalon)
        except Exception:  # noqa: BLE001 la traza nunca rompe el plan
            pass
    if not titulos or escalon == "nada":
        return SIN_FUENTES
    return "\n".join(f"- {t}" for t in titulos)


async def calcular_apoyo(buscador: Buscador | None, plan_id: int, tema_id: int | None) -> None:
    """Para cada lección, los fragmentos (de los 8 mejores) que de verdad la apoyan y si queda «sin material».
    Solo se guardan los que pasan la puerta: lo demás no llega a los apuntes ni al corrector como «tus fuentes»."""
    if buscador is None:
        return
    async with nueva_sesion() as s:
        lecciones = await dp.lecciones(s, plan_id)
    for lec in lecciones:
        consulta = f"{lec.titulo}. " + " ".join(lec.objetivos)
        # El reranker puntúa siempre los 8: aunque uno llegue al coseno, cuenta cuántos apoyan (ADR-0018).
        r = await buscador.buscar(consulta, 8, Filtros(tema_id=tema_id), Consulta(puntuar_reranker=True))
        # Un fragmento apoya si su coseno llega o si el reranker lo puntúa por encima de su umbral (lección en
        # español, fuente en inglés).
        buenos = [
            (x.fragmento_id, x.rango, x.puntuacion)
            for x in r.recuperados
            if r.similitud_densa.get(x.fragmento_id, x.puntuacion) >= ajustes.umbral_apoyo
            or r.puntuacion_reranker.get(x.fragmento_id, float("-inf")) > ajustes.umbral_reranker
        ]
        await rf.guardar_apoyo(plan_id, lec.clave, buenos, len(buenos) < ajustes.min_apoyo)


async def recalcular_apoyo_por_versiones(buscador: Buscador | None, version_ids: list[int]) -> None:
    """Cuando versiones pasan a `lista`, se recalcula (una vez) el apoyo de los planes de sus temas.
    Una versión sin tema (el vault) puede apoyar a cualquier plan."""
    async with nueva_sesion() as s:
        temas = {await rf.tema_de_version(s, v) for v in version_ids}
        planes = await dp.planes_aceptados(s)
    for fila, _ in planes:
        if None in temas or fila.tema_id in temas:
            await calcular_apoyo(buscador, fila.id, fila.tema_id)
