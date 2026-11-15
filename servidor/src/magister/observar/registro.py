"""Los observadores que se enganchan al cerebro al arrancar la API.

1. Guardar cada llamada en `llamadas`.
2. Calcular las métricas deterministas y guardarlas en `puntuaciones`.
3. Encolar el juez online con probabilidad `MAGISTER_JUEZ_MUESTRA` (semilla anotada en la carga).
4. Langfuse, si está instalado y configurado (opcional: si no, no hace nada).
"""

import logging
import random

from sqlalchemy.dialects.postgresql import insert

from magister.cerebro.modelo import Llamada, registrar_observador
from magister.config import ajustes
from magister.datos.produccion import LlamadaFila, Puntuacion
from magister.datos.sesion import nueva_sesion
from magister.observar import metricas, trazas

registro = logging.getLogger("magister.observar")
_azar = random.Random()
EXPLICACIONES = {"responder", "conversar", "explicar"}


async def guardar_llamada(ll: Llamada) -> None:
    async with nueva_sesion() as s, s.begin():
        s.add(LlamadaFila(
            traza_id=ll.traza_id, funcion=ll.funcion, motor=ll.motor, modelo_pedido=ll.modelo_pedido,
            modelo_respondido=ll.modelo_respondido, tokens_entrada=ll.tokens_entrada, tokens_salida=ll.tokens_salida,
            tokens_cache_lectura=ll.tokens_cache_lectura, tokens_cache_escritura=ll.tokens_cache_escritura,
            coste_equivalente=ll.coste_equivalente, ttft_ms=ll.ttft_ms, total_ms=ll.total_ms, reintentos=ll.reintentos,
            respaldo=ll.respaldo, error=ll.error, prompt_nombre=ll.prompt_nombre, prompt_version=ll.prompt_version,
        ))


async def puntuar(traza_id: str, nombre: str, valor: float, comentario: str | None = None, sobrescribir: bool = False) -> None:
    async with nueva_sesion() as s, s.begin():
        q = insert(Puntuacion).values(traza_id=traza_id, nombre=nombre, valor=valor, comentario=comentario)
        q = (q.on_conflict_do_update(constraint="uq_puntuaciones_traza_nombre", set_={"valor": valor, "comentario": comentario})
             if sobrescribir else q.on_conflict_do_nothing(constraint="uq_puntuaciones_traza_nombre"))
        await s.execute(q)
    trazas.puntuar(traza_id, nombre, valor, comentario)


async def guardar_metricas(ll: Llamada) -> None:
    if not ll.traza_id or ll.error:
        return
    for nombre, valor in metricas.todas(ll.respuesta, ll.estructurada).items():
        await puntuar(ll.traza_id, f"{ll.funcion}.{nombre}" if ll.estructurada else nombre, valor)


async def encolar_juez(ll: Llamada) -> None:
    if not ll.traza_id or ll.error or ll.estructurada or (ll.prompt_nombre or ll.funcion) not in EXPLICACIONES:
        return
    semilla = _azar.randrange(2**31)
    if random.Random(semilla).random() >= ajustes.juez_muestra:
        return
    from magister.trabajos import cola

    await cola.encolar("juez_online", None, None,
                       {"traza_id": ll.traza_id, "salida": ll.respuesta, "sistema": ll.sistema[-6000:],
                        "prompt": [ll.prompt_nombre, ll.prompt_version], "semilla": semilla},
                       cola.clave_idempotencia(tipo="juez_online", traza=ll.traza_id))


def instalar() -> None:
    registrar_observador(guardar_llamada)
    registrar_observador(guardar_metricas)
    registrar_observador(encolar_juez)
    registrar_observador(trazas.generacion)
