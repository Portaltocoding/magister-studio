"""La rama de estudio con fuentes:

 enrutar_entrada --estudio--> reescribir --¿autónoma o reescrita?--> recuperar -> responder -> END
                                         \\--no se puede--> aclarar -> END
"""

import re

from pydantic import BaseModel, Field

from magister.cerebro.citas import comprobar
from magister.cerebro.contratos import Buscador, Filtros
from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.modelo import Turno
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.flujo.comun import (
    acciones_de_estudio,
    decir,
    escribir,
    fase,
    hablar,
    historial_reciente,
    sistema_de_estudio,
    tarea_de,
    turnos_recientes,
)
from magister.flujo.estado import Estado

K = 5
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
    fase("reescribir")
    sistema = cargar("reescribir").rellenar(turnos=turnos_recientes(estado, 6), mensaje=mensaje)
    try:
        r = await estructurar(sistema, "Devuelve la reescritura.", Reescritura)
    except ErrorEstructura:
        return {"consulta": mensaje, "aclaracion": None}
    if r.consulta:
        return {"consulta": r.consulta, "aclaracion": None}
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
            return {"recuperados": [], "busqueda_id": None}
        fase("recuperar")
        consulta = estado.get("consulta") or estado.get("mensaje", "")
        r = await buscador.buscar(
            consulta, K, Filtros(tema_id=estado.get("tema_id")), None, consulta_original=estado.get("mensaje")
        )
        hay = bool(r.recuperados) and r.mejor_similitud >= ajustes.umbral_fuentes
        return {
            "recuperados": [
                {"id": x.fragmento_id, "texto": x.texto, "titulo": x.documento_titulo, "tipo": x.fuente_tipo}
                for x in r.recuperados
            ]
            if hay
            else [],
            "busqueda_id": r.busqueda_id,
        }

    return recuperar


def _bloque(recuperados: list[dict]) -> str:
    from magister.seguridad.entrada import AVISO, marcar_externo

    partes = []
    for x in recuperados:
        texto = marcar_externo(x["texto"], x["id"], "web") if x["tipo"] == "web" else x["texto"]
        partes.append(f'<fragmento id="{x["id"]}" fuente="{x["titulo"]} ({x["tipo"]})">\n{texto}\n</fragmento>')
    aviso = AVISO + "\n\n" if any(x["tipo"] == "web" for x in recuperados) else ""
    return aviso + "\n\n".join(partes)


async def responder(estado: Estado) -> dict:
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
    citas =[c.a_dict() for c in comprobar(texto, {x["id"]: x["texto"] for x in recuperados})]
    escribir(citas=citas, busqueda_id=estado.get("busqueda_id"), sin_fuentes=False)
    await acciones_de_estudio(estado, sin_fuentes=False)
    return {"citas": citas}
