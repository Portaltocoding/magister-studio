from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.prompts import cargar
from magister.flujo.comun import DIAS, fase, hoy_de, perfil_de, perfil_json, sin_etiquetas, turnos_recientes
from magister.flujo.estado import Estado
from magister.plan.esquemas import Perfil


async def extraer(estado: Estado) -> dict:
    fase("extraer")
    hoy = hoy_de(estado)
    actual = perfil_de(estado)
    sistema = cargar("extraer_perfil").rellenar(
        perfil=perfil_json(actual),
        turnos=turnos_recientes(estado, 8),
        mensaje=sin_etiquetas(estado.get("mensaje", "")),
        hoy=hoy.isoformat(),
        dia_semana=DIAS[hoy.weekday()],
    )
    try:
        nuevo = await estructurar(sistema, "Devuelve el perfil completo actualizado.", Perfil)
    except ErrorEstructura:
        nuevo = actual  # sin extracción válida se queda lo que había y se vuelve a preguntar
    return {"perfil": nuevo.model_dump(mode="json")}
