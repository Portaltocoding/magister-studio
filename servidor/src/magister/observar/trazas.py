"""Capa fina y opcional sobre Langfuse (contrato en docs/contrato-trazas.md).

Si el paquete `langfuse` no está instalado o faltan las claves (`LANGFUSE_PUBLIC_KEY`,
`LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`), no hace nada y lo dice una vez en el log. Las
llamadas y puntuaciones se guardan igualmente en Postgres (`llamadas`, `puntuaciones`).
"""

import logging
import os

from magister.cerebro.modelo import Llamada

registro = logging.getLogger("magister.trazas")
_cliente = None
_avisado = False


def cliente():
    global _cliente, _avisado
    if _cliente is not None:
        return _cliente
    if not (os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY")):
        if not _avisado:
            registro.info("Langfuse sin configurar: las trazas solo se guardan en Postgres")
            _avisado = True
        return None
    try:
        from langfuse import get_client

        _cliente = get_client()
    except Exception:  # noqa: BLE001
        if not _avisado:
            registro.warning("Langfuse no disponible: las trazas solo se guardan en Postgres")
            _avisado = True
        return None
    return _cliente


def generacion(ll: Llamada) -> None:
    c = cliente()
    if c is None:
        return
    try:
        with c.start_as_current_observation(as_type="generation", name=ll.funcion, model=ll.modelo_respondido or ll.modelo_pedido,
                                            input=ll.entrada[-4000:], output=ll.respuesta[-4000:],
                                            metadata={"prompt_version": ll.prompt_version, "motor": ll.motor}) as g:
            g.update(usage_details={"input": ll.tokens_entrada, "output": ll.tokens_salida,
                                    "cache_read_input_tokens": ll.tokens_cache_lectura,
                                    "cache_creation_input_tokens": ll.tokens_cache_escritura},
                     cost_details={"total": ll.coste_equivalente})
    except Exception:  # noqa: BLE001 la instrumentación nunca rompe una petición
        registro.debug("no se pudo enviar la generación a Langfuse")


def puntuar(traza_id: str, nombre: str, valor: float, comentario: str | None) -> None:
    c = cliente()
    if c is None:
        return
    try:
        c.create_score(trace_id=traza_id, name=nombre, value=valor, comment=comentario)
    except Exception:  # noqa: BLE001
        registro.debug("no se pudo enviar la puntuación a Langfuse")
