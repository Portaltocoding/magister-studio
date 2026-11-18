"""Los observadores que se enganchan al cerebro al arrancar la API.

1. Guardar cada llamada en `llamadas`.
2. Calcular las métricas deterministas y guardarlas en `puntuaciones`.
3. Encolar el juez online cuando la confianza aprendida lo pide (`observar/afinado`; `MAGISTER_JUEZ_MUESTRA=1` lo fuerza siempre).
4. Langfuse, si está instalado y configurado (opcional: si no, no hace nada).
5. La cuota de la suscripción (sesión y semana) que trae cada llamada, para la barra de uso.
"""

import logging
import random
import re

from sqlalchemy.dialects.postgresql import insert

from magister.cerebro.modelo import Llamada, registrar_observador
from magister.config import ajustes
from magister.datos.produccion import LlamadaFila, Puntuacion
from magister.datos.sesion import nueva_sesion
from magister.observar import cuota, metricas, trazas

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


async def puntuar(traza_id: str, nombre: str, valor: float, comentario: str | None = None, sobrescribir: bool = False,
                  version: str | None = None) -> None:
    async with nueva_sesion() as s, s.begin():
        q = insert(Puntuacion).values(traza_id=traza_id, nombre=nombre, valor=valor, comentario=comentario, version=version)
        q = (q.on_conflict_do_update(constraint="uq_puntuaciones_traza_nombre", set_={"valor": valor, "comentario": comentario})
             if sobrescribir else q.on_conflict_do_nothing(constraint="uq_puntuaciones_traza_nombre"))
        await s.execute(q)
    trazas.puntuar(traza_id, nombre, valor, comentario)


async def guardar_metricas(ll: Llamada) -> None:
    if not ll.traza_id or ll.error:
        return
    for nombre, valor in metricas.todas(ll.respuesta, ll.estructurada).items():
        await puntuar(ll.traza_id, f"{ll.funcion}.{nombre}" if ll.estructurada else nombre, valor)


# Por debajo de esto, un turno del chat no es una explicación: saludo y primera pregunta de un simulacro, la nota de una
# respuesta, cómo moverse por la app, un «sí, eso es». Juzgarlos con la rúbrica de una explicación los suspendía casi
# siempre (38 de los 40 suspensos del 18-11-2026 eran del chat, la mitad de menos de 600 caracteres) y hundía la alerta.
MINIMO_EXPLICACION = 600


def es_explicacion(texto: str | None) -> bool:
    """¿Merece la rúbrica de una explicación? Largo suficiente y no solo preguntas al alumno."""
    t = (texto or "").strip()
    if len(t) < MINIMO_EXPLICACION:
        return False
    frases = [f for f in re.split(r"(?<=[.!?])\s+", t) if f.strip()]
    preguntas = sum(1 for f in frases if f.rstrip().endswith("?"))
    return preguntas * 2 < len(frases)


async def encolar_juez(ll: Llamada) -> None:
    if not ll.traza_id or ll.error or ll.estructurada or (ll.prompt_nombre or ll.funcion) not in EXPLICACIONES:
        return
    if not es_explicacion(ll.respuesta):
        return
    # Los turnos de una llamada de voz (2 a 4 frases habladas) no se juzgan con la rúbrica de una explicación escrita:
    # la suspendían siempre y hundían la alerta de tono.
    if ll.funcion == "llamada":
        return
    semilla = _azar.randrange(2**31)
    # MAGISTER_JUEZ_MUESTRA es el tope: 0 apaga el juez, 1 lo fuerza todo; entre medias decide la confianza aprendida
    # (observar/afinado) sin pasar del tope: al principio se juzga lo más que se deja y, si va bien, cada vez menos.
    if ajustes.juez_muestra <= 0:
        return
    if ajustes.juez_muestra < 1.0:
        from magister.observar import afinado

        if not await afinado.toca_juzgar(ll.traza_id, ajustes.juez_muestra):
            await afinado.anotar_salto()
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
    registrar_observador(cuota.guardar_cuota)
