"""La rama de estudio con fuentes:

 enrutar_entrada --estudio--> reescribir --¿autónoma o reescrita?--> recuperar -> responder -> END
                                         \\--no se puede--> aclarar -> END
"""

import asyncio
import logging
import re

from pydantic import BaseModel, Field

from magister.cerebro.citas import comprobar
from magister.cerebro.contratos import Buscador, Filtros, ResultadoBusqueda, Similitud, titulo_para_atributo
from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.modelo import Turno
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.datos import repositorio_fuentes as rf
from magister.flujo import adjuntos as adj
from magister.flujo.comun import (
    acciones_de_estudio,
    decir,
    escribir,
    fase,
    hablar,
    historial_reciente,
    sin_etiquetas,
    sistema_de_estudio,
    tarea_de,
    turnos_recientes,
)
from magister.flujo.estado import Estado

K = 5
registro = logging.getLogger("magister.rag")
PISTAS = re.compile(
    r"^(y|e|o|pero)\b|\b(eso|esto|ese|esa|esos|esas|aquello|lo anterior|lo mismo|el otro|la otra|"
    r"los otros|las otras|ello|él|ella|ellos|ellas|ahí|antes|lo de)\b",
    re.I,
)


class Reescritura(BaseModel):
    autonoma: bool = Field(description="true si el mensaje se entiende solo")
    consulta: str | None = Field(None, description="Consulta de búsqueda autónoma, o null si no se puede")
    aclaracion: str | None = Field(None, description="Pregunta corta para el alumno si no se puede saber")


def necesita_reescritura(mensaje: str, hay_historial: bool) -> bool:
    """Regla barata: pronombres, elipsis o empieza por «y». Sin esto, no se llama al modelo."""
    return bool(PISTAS.search(mensaje.strip())) or (hay_historial and len(mensaje.split()) <= 3)


async def reescribir(estado: Estado) -> dict:
    mensaje = estado.get("mensaje", "")
    turnos = estado.get("turnos", [])
    # En una llamada no se reescribe: «¿y eso?» es constante por voz y la reescritura añade una llamada al modelo
    # (unos 5 s de silencio); el historial ya da el contexto a la respuesta.
    if estado.get("llamada") or estado.get("asesor") or not necesita_reescritura(mensaje, len(turnos) > 1):
        return {"consulta": mensaje, "aclaracion": None}
    if not ajustes.reescribir_con_modelo:
        # Sin modelo (ahorra 5-7 s): se busca con tu pregunta anterior delante, que es lo que da sentido a «¿y eso?».
        previa = next((t["contenido"] for t in reversed(turnos[:-1]) if t.get("rol") == "usuario"), "")
        return {"consulta": f"{previa[-300:]} {mensaje}".strip() if previa else mensaje, "aclaracion": None}
    fase("reescribir")
    sistema = cargar("reescribir").rellenar(turnos=turnos_recientes(estado, 6), mensaje=sin_etiquetas(mensaje))
    try:
        r = await estructurar(sistema, "Devuelve la reescritura.", Reescritura)
    except ErrorEstructura:
        return {"consulta": mensaje, "aclaracion": None}
    if r.consulta:
        return {"consulta": r.consulta, "aclaracion": None}
    if estado.get("adjuntos"):  # «esto» son los documentos adjuntados: no hay nada que aclarar
        return {"consulta": mensaje, "aclaracion": None}
    return {"consulta": None, "aclaracion": r.aclaracion or "¿A qué te refieres exactamente?"}


def tras_reescribir(estado: Estado) -> str:
    return "aclarar" if estado.get("consulta") is None else "recuperar"


async def aclarar(estado: Estado) -> dict:
    fase("aclarar")
    decir(estado.get("aclaracion") or "¿A qué te refieres exactamente?")
    return {}


def hacer_recuperar(buscador: Buscador):
    async def recuperar(estado: Estado) -> dict:
        # En una llamada sobre una lección, sus apuntes ya van en el prompt: buscar en las fuentes solo añade texto.
        # El asesor tampoco busca: lo que necesita es la pantalla, que ya le llega.
        if (estado.get("llamada") and estado.get("leccion_clave")) or estado.get("asesor"):
            return {"recuperados": [], "busqueda_id": None, "adjuntos_resumen": []}
        fase("recuperar")
        consulta = estado.get("consulta") or estado.get("mensaje", "")
        tema_id = estado.get("tema_id")
        # Los documentos adjuntados en la conversación: su título y apartados, y sus fragmentos (los primeros si el
        # mensaje señala «esto»), siempre delante de lo que traiga la búsqueda normal.
        adjuntos = list(estado.get("adjuntos") or [])
        resumen = await adj.resumen(buscador, adjuntos)
        de_adjuntos = await adj.fragmentos(buscador, adjuntos, consulta, estado.get("mensaje", ""), K) if resumen else []
        if de_adjuntos and adj.es_deictico(estado.get("mensaje", "")):
            # «Esto» no se busca en la biblioteca: no diría nada y gastaría una búsqueda.
            return {"recuperados": de_adjuntos, "busqueda_id": None, "adjuntos_resumen": resumen}
        # Acotar y ampliar: con tema, primero sus fuentes (y las que no tienen tema); solo si ahí no hay nada, toda la
        # biblioteca. Sin tema, toda la biblioteca de una vez.
        r, hay = await _buscar_y_decidir(buscador, consulta, Filtros(tema_id=tema_id), estado.get("mensaje"))
        if not hay and tema_id is not None:
            r, hay = await _buscar_y_decidir(buscador, consulta, Filtros(), estado.get("mensaje"))
        normales = [
            {"id": x.fragmento_id, "texto": x.texto, "titulo": x.documento_titulo, "tipo": x.fuente_tipo, "uri": x.uri}
            for x in r.recuperados
        ] if hay else []
        return {"recuperados": adj.fusionar(de_adjuntos, normales), "busqueda_id": r.busqueda_id, "adjuntos_resumen": resumen}

    return recuperar


async def _buscar_y_decidir(buscador: Buscador, consulta: str, filtros: Filtros, original: str | None) -> tuple[ResultadoBusqueda, bool]:
    r = await buscador.buscar(consulta, K, filtros, None, consulta_original=original)
    # El coseno o, si no llega (pregunta en español, fuente en inglés), el reranker (ADR-0018).
    escalon = r.escalon(ajustes.umbral_fuentes, ajustes.umbral_reranker)
    if r.busqueda_id is not None:
        try:
            await rf.anotar_escalon(r.busqueda_id, escalon)
        except Exception:  # noqa: BLE001 la traza nunca rompe la respuesta
            registro.warning("no se pudo anotar el escalón de la búsqueda %s", r.busqueda_id, exc_info=True)
    return r, escalon != "nada"


def _es_externo(x: dict) -> bool:
    if x.get("externo"):  # lo adjuntado por el alumno: viene de un fichero, no es confiable
        return True
    # Una URL guardada en una fuente que no es «web» sigue siendo contenido de la web.
    return x["tipo"] == "web" or (x.get("uri") or "").startswith(("http://", "https://"))


def _bloque(recuperados: list[dict]) -> str:
    from magister.seguridad.entrada import AVISO, marcar_externo

    partes = []
    for x in recuperados:
        texto = marcar_externo(x["texto"], x["id"], x.get("externo") or "web") if _es_externo(x) else x["texto"]
        partes.append(f'<fragmento id="{x["id"]}" fuente="{titulo_para_atributo(x["titulo"])} ({x["tipo"]})">\n{texto}\n</fragmento>')
    aviso = AVISO + "\n\n" if any(_es_externo(x) for x in recuperados) else ""
    return aviso + "\n\n".join(partes)


def hacer_responder(buscador: Buscador | None):
    """El buscador ofrece `similitud_frases` (e5 ya cargado) para comprobar citas entre idiomas; sin ella, por palabras."""
    similitud: Similitud | None = getattr(buscador, "similitud_frases", None)

    async def responder(estado: Estado) -> dict:
        return await _responder(estado, similitud)

    return responder


async def _responder(estado: Estado, similitud: Similitud | None) -> dict:
    fase("responder")
    historial = historial_reciente(estado)
    recuperados = estado.get("recuperados", [])
    tarea = tarea_de(estado)
    if not recuperados:
        # Sin fuentes: la pantalla lo marca con una etiqueta discreta (sin_fuentes), no con una frase delante.
        sistema = await sistema_de_estudio(cargar("conversar").texto, estado)
        await hablar(sistema, historial, tarea)
        escribir(citas=[], busqueda_id=estado.get("busqueda_id"), sin_fuentes=True)
        await acciones_de_estudio(estado, sin_fuentes=True)
        return {"citas": []}
    sistema = await sistema_de_estudio(cargar("responder").texto, estado) + "\n\n<fragmentos>\n" + _bloque(recuperados) + "\n</fragmentos>"
    texto = await hablar(sistema, historial, tarea)
    # Con similitud, comprobar embebe frases (CPU): en un hilo para no parar el bucle.
    citas = [c.a_dict() for c in await asyncio.to_thread(comprobar, texto, {x["id"]: x["texto"] for x in recuperados}, similitud)]
    escribir(citas=citas, busqueda_id=estado.get("busqueda_id"), sin_fuentes=False)
    await acciones_de_estudio(estado, sin_fuentes=False)
    return {"citas": citas}
