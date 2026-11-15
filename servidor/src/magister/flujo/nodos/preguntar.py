from magister.cerebro.modelo import Turno
from magister.cerebro.prompts import cargar
from magister.flujo.comun import escribir, fase, hablar, hoy_de, perfil_de, perfil_json, turnos_recientes
from magister.flujo.estado import Estado
from magister.plan.perfil import huecos


async def preguntar(estado: Estado) -> dict:
    fase("preguntar")
    perfil = perfil_de(estado)
    sistema = cargar("diagnostico").rellenar(
        perfil=perfil_json(perfil),
        huecos=", ".join(huecos(perfil)),
        turnos=turnos_recientes(estado),
        mensaje=estado.get("mensaje", ""),
        hoy=hoy_de(estado).isoformat(),
    )
    await hablar(sistema, [Turno("usuario", "Escribe tu siguiente turno para el alumno.")])
    faltan = huecos(perfil)
    if faltan and faltan[0] in OPCIONES:
        escribir(opciones={"campo": faltan[0], "opciones": [{"valor": v, "etiqueta": e} for e, v in OPCIONES[faltan[0]]]})
    return {}


# Respuestas rápidas por hueco (etiqueta, texto que se envía). El tema no tiene: se escribe.
OPCIONES = {
    "objetivo": [("Una entrevista", "Es para una entrevista de trabajo"), ("Un examen", "Es para un examen"),
                 ("Un proyecto o el trabajo", "Es para un proyecto o para el trabajo"),
                 ("Curiosidad", "Es por curiosidad, para tener una base sólida")],
    "nivel": [("Nada", "No sé nada, empiezo de cero"), ("Lo básico", "Sé lo básico, con huecos"),
              ("Intermedio", "Nivel intermedio, lo uso con soltura"), ("Avanzado", "Nivel avanzado, quiero pulir")],
    "horas_por_dia": [("30 min entre semana", "Media hora al día entre semana"),
                      ("1 h entre semana", "Una hora al día entre semana"),
                      ("1,5 h entre semana", "Hora y media al día entre semana"),
                      ("1 h todos los días", "Una hora todos los días"),
                      ("2 h todos los días", "Dos horas al día todos los días"),
                      ("3 h los fines de semana", "Tres horas los sábados y los domingos")],
    "plazo": [("Un mes", "Lo quiero en un mes"), ("Tres meses", "Lo quiero en tres meses"),
              ("Sin fecha", "Sin fecha límite")],
}
