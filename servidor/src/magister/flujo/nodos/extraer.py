from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.prompts import cargar
from magister.flujo import adjuntos as adj
from magister.flujo.comun import DIAS, fase, hoy_de, perfil_de, perfil_json, sin_etiquetas, turnos_recientes
from magister.flujo.estado import Estado
from magister.plan.esquemas import Perfil


def hacer_extraer(buscador=None):
    async def nodo(estado: Estado) -> dict:
        return await extraer(estado, buscador)

    return nodo


async def extraer(estado: Estado, buscador=None) -> dict:
    fase("extraer")
    # Lo adjuntado en la conversación pone el tema: «un roadmap de esto» es un roadmap de esos documentos.
    resumen = await adj.resumen(buscador, list(estado.get("adjuntos") or [])) if buscador else list(estado.get("adjuntos_resumen") or [])
    hoy = hoy_de(estado)
    actual = perfil_de(estado)
    sistema = cargar("extraer_perfil").rellenar(
        perfil=perfil_json(actual),
        turnos=turnos_recientes(estado, 8),
        mensaje=sin_etiquetas(estado.get("mensaje", "")),
        hoy=hoy.isoformat(),
        dia_semana=DIAS[hoy.weekday()],
    )
    if resumen:
        sistema += "\n\n" + adj.para_el_plan(resumen)
    try:
        nuevo = await estructurar(sistema, "Devuelve el perfil completo actualizado.", Perfil)
    except ErrorEstructura:
        nuevo = actual  # sin extracción válida se queda lo que había y se vuelve a preguntar
    if resumen and not (nuevo.tema or "").strip():
        # El modelo no sacó tema de los documentos: el de sus títulos, para no preguntar «¿qué es esto?».
        nuevo = nuevo.model_copy(update={"tema": adj.tema_de(resumen)})
    return {"perfil": nuevo.model_dump(mode="json"), "adjuntos_resumen": resumen}
