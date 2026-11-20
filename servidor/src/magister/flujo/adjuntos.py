"""Lo que el tutor sabe de los documentos que el alumno adjunta en Estudio libre.

Lo que viaja en el estado son ids de versión; el título, los apartados y los fragmentos se traen por id al final, con el
`Buscador` inyectado (`flujo` no importa `magister.fuentes`). Todo lo que sale de un documento es contenido no confiable:
va dentro de `<fuente_externa>` (seguridad.entrada.marcar_externo) y nunca da órdenes.
"""

import logging
import re
import unicodedata

from magister.cerebro.contratos import Buscador, Filtros, Recuperado, titulo_para_atributo

registro = logging.getLogger("magister.adjuntos")

POR_DOCUMENTO = 3  # primeros fragmentos de cada documento cuando el mensaje no dice qué buscar
MAX_FRAGMENTOS = 8  # cuántos fragmentos de los adjuntos entran en un turno

# «Esto», «estos documentos», «el pdf», «this», «these documents»: el mensaje señala lo adjuntado sin decir qué es.
DEICTICO = re.compile(
    r"\b(esto|eso|estos|estas|esos|esas|este|esta|ese|esa|aquello|lo adjunto|"
    r"documentos?|pdfs?|archivos?|ficheros?|guias?|adjuntos?|"
    r"this|that|these|those|the (documents?|files?|pdfs?|guides?)|attached|attachments?)\b"
)


def _norm(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if not unicodedata.combining(c))


def es_deictico(mensaje: str) -> bool:
    """El mensaje señala lo adjuntado («haz un roadmap de esto») o es tan corto que no dice qué buscar. Puro."""
    t = _norm(mensaje or "")
    return bool(DEICTICO.search(t)) or len(t.split()) <= 3


async def resumen(buscador: Buscador | None, version_ids: list[int]) -> list[dict]:
    """De cada documento adjuntado: versión, título y apartados. Nunca rompe el turno."""
    if buscador is None or not version_ids:
        return []
    try:
        return [{"version_id": r.version_id, "titulo": r.titulo, "secciones": list(r.secciones)}
                for r in await buscador.resumen_versiones(list(version_ids))]
    except Exception:  # noqa: BLE001  (sin esto el tutor contesta como antes)
        registro.warning("no se pudo leer el resumen de los adjuntos", exc_info=True)
        return []


def _como_dict(r: Recuperado) -> dict:
    return {"id": r.fragmento_id, "texto": r.texto, "titulo": r.documento_titulo, "tipo": r.fuente_tipo, "uri": r.uri,
            "externo": "adjunto", "version_id": r.version_id}


async def fragmentos(buscador: Buscador | None, version_ids: list[int], consulta: str, mensaje: str, k: int) -> list[dict]:
    """Los fragmentos de lo adjuntado para este turno. Si el mensaje señala («esto») o es vago, primero los primeros de
    cada documento; después, los más relevantes dentro de esas versiones (sin umbral: lo adjuntado cuenta siempre)."""
    if buscador is None or not version_ids:
        return []
    ids = list(version_ids)
    try:
        primeros: list[Recuperado] = []
        if es_deictico(mensaje):
            primeros = await buscador.primeros_fragmentos(ids, POR_DOCUMENTO)
        buscados = (await buscador.buscar(consulta, k, Filtros(version_ids=ids), None, consulta_original=mensaje)).recuperados
        salida: list[dict] = []
        for r in [*primeros, *buscados]:
            if all(x["id"] != r.fragmento_id for x in salida):
                salida.append(_como_dict(r))
        return salida[:MAX_FRAGMENTOS]
    except Exception:  # noqa: BLE001
        registro.warning("no se pudieron leer los fragmentos de los adjuntos", exc_info=True)
        return []


def _documentos(resumen_: list[dict]) -> str:
    from magister.seguridad.entrada import marcar_externo

    docs = []
    for d in resumen_:
        apartados = "; ".join(d.get("secciones") or [])
        texto = f"Documento: {d['titulo']}" + (f". Apartados: {apartados}" if apartados else "")
        docs.append(marcar_externo(texto, d["version_id"], "adjunto"))
    return "\n".join(docs)


def bloque(resumen_: list[dict]) -> str:
    """El texto del prompt de estudio: qué se ha adjuntado, con títulos y apartados marcados como externos."""
    if not resumen_:
        return ""
    from magister.seguridad.entrada import AVISO

    return (
        "El alumno ha adjuntado estos documentos a la conversación (se mantienen en los turnos siguientes). Cuando dice "
        "«esto», «estos documentos» o «el PDF», se refiere a ellos: nunca le preguntes qué es «esto». Apóyate en sus "
        "fragmentos (si vienen en <fragmentos>) y en el esquema de abajo.\n"
        "Si pide un roadmap o un plan de estudio de esto, el tema es el de estos documentos. Si pide un proyecto paso a "
        "paso, resume en pocas líneas el proyecto que saldría de ellos (nombre y qué construiría) y dile que lo crea en "
        "«Proyectos» con ese nombre y esa idea: desde el chat no puedes crear proyectos.\n"
        f"{AVISO}\n<documentos_adjuntos>\n{_documentos(resumen_)}\n</documentos_adjuntos>"
    )


def para_el_plan(resumen_: list[dict]) -> str:
    """Los títulos y apartados de lo adjuntado, para el extractor del perfil, el diagnóstico y el planificador."""
    if not resumen_:
        return ""
    from magister.seguridad.entrada import AVISO

    return (
        "El alumno ha adjuntado estos documentos. El tema que quiere aprender (y el del plan) es el de ellos: sácalo de "
        "sus títulos y apartados, y nunca le preguntes qué tema es.\n"
        f"{AVISO}\n<documentos_adjuntos>\n{_documentos(resumen_)}\n</documentos_adjuntos>"
    )


_RUIDO = re.compile(r"\.(pdf|md|markdown|txt|html?)$|[_\-]+", re.I)


def tema_de(resumen_: list[dict]) -> str | None:
    """Un tema corto a partir de los títulos, sin llamar al modelo: el del primer documento, sin extensión ni guiones,
    y el del segundo si caben los dos. Es el respaldo cuando el extractor no saca tema de los documentos."""
    titulos: list[str] = []
    for d in resumen_:
        t = " ".join(_RUIDO.sub(" ", d.get("titulo") or "").split())
        if t and t not in titulos:
            titulos.append(t)
    if not titulos:
        return None
    tema = titulos[0]
    if len(titulos) > 1 and len(tema) + len(titulos[1]) + 3 <= 60:
        tema = f"{tema} y {titulos[1]}"
    return titulo_para_atributo(tema)[:80]


def fusionar(adjuntos: list[dict], normales: list[dict]) -> list[dict]:
    """Primero lo adjuntado, luego lo que trajo la búsqueda normal, sin repetir ids."""
    vistos = {x["id"] for x in adjuntos}
    return [*adjuntos, *[x for x in normales if x["id"] not in vistos]]
