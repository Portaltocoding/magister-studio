"""El juez online: un trabajo de la cola que juzga el tono de una explicación ya enviada.

Es idempotente: si la traza ya tiene `tono_juez`, no vuelve a juzgar. Un suspenso añade la
traza a la cola de candidatos al banco.
"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from magister.datos.produccion import CandidatoBanco, Puntuacion
from magister.datos.sesion import nueva_sesion
from magister.observar.registro import puntuar
from magister.tono.juez import DIMENSIONES, FalloJuez, juzgar as juzgar_tono


async def candidato(traza_id: str, origen: str, entrada: str, salida: str | None, nota: str | None = None) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(CandidatoBanco).values(traza_id=traza_id, origen=origen, entrada=entrada[-8000:],
                                                      salida=(salida or "")[-8000:], nota=nota)
                        .on_conflict_do_nothing(constraint="uq_candidatos_traza"))


async def juzgar(carga: dict) -> None:
    traza = carga["traza_id"]
    async with nueva_sesion() as s:
        if await s.scalar(select(Puntuacion.id).where(Puntuacion.traza_id == traza, Puntuacion.nombre == "tono_juez")):
            return
    r = await juzgar_tono(carga["salida"])
    if isinstance(r, FalloJuez):
        return
    aprueba = all(getattr(r.veredicto, d).aprueba for d in DIMENSIONES)
    critica = "; ".join(f"{d}: {getattr(r.veredicto, d).razon}" for d in DIMENSIONES if not getattr(r.veredicto, d).aprueba)
    await puntuar(traza, "tono_juez", 1.0 if aprueba else 0.0, critica or None)
    if not aprueba:
        await candidato(traza, "juez", carga.get("sistema", ""), carga["salida"], critica)
