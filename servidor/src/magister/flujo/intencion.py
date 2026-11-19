"""Reconocer, sin modelo, cuándo una conversación de estudio pide un plan y cuándo lo abandona.

Así las partes se hablan: si en Estudio libre pides un plan, un roadmap u organizarlo en el
calendario, la conversación pasa al diagnóstico con lo ya hablado como contexto.
"""

import re
import unicodedata

VERBOS = r"(haz|hazme|haced|hacer|hagamos|crea|creame|crear|monta|montame|montar|prepara|preparame|preparar|organiza|organizame|" \
         r"organizar|organizarlo|organizalo|planifica|planificame|planificar|planificarlo|diseña|diseñame|quiero|queria|necesito|" \
         r"hicieras|hicieses|hagas|harias|haria|montes|montaras|prepares|prepararas|organices|organizaras|crees|crearas|" \
         r"planifiques|gustaria|encantaria|apetece|" \
         r"me haces|me harias|podemos hacer|podrias hacer|puedes hacer|ayudame a hacer|ponlo|ponmelo|meterlo|metelo|meter)"
OBJETOS = r"(plan|planning|roadmap|hoja de ruta|calendario|cronograma|temario|itinerario|plan de estudio)"
PIDE_PLAN = re.compile(rf"\b{VERBOS}\b[^.?!]{{0,60}}\b{OBJETOS}\b|\b{OBJETOS}\b[^.?!]{{0,30}}\b(para|con)\b[^.?!]{{0,40}}\b(semanas?|meses?|dias?|horas?)\b")
DEJAR_PLAN = re.compile(r"\b(dejalo|deja el plan|olvida el plan|olvidalo|cancela (el )?plan|cancelar el plan|sin plan|"
                        r"no (quiero|hagas|hagamos) (un |el )?plan|mejor otra cosa|otra cosa distinta|cambiemos de tema|"
                        r"explicamelo|explicame|explicanos|solo (quiero )?(que me )?expli\w*|no necesito (un |el )?plan)\b")
# «En plan rápido», «plan B»: muletillas, no planes de estudio.
COLOQUIAL = re.compile(r"\b(en plan|plan b|de buen plan|menudo plan|vaya plan)\b")
# Pedir una explicación con «plan» por medio no es pedir un plan, salvo que nombre algo inequívoco.
EXPLICAR = re.compile(r"\b(explica\w*|expliqu\w+|ense|cuentame|que es|como funciona|entender)")
# Salvo que, además de la explicación, pida hacer el plan: «explícame X y hazme un plan».
HAZ_PLAN = re.compile(r"\b(haz|hazme|hagas|hicieras|hicieses|harias|crea|creame|crees|monta|montame|montes|prepara|preparame|"
                      r"prepares|organiza|organizame|organices|planificame|planifiques|me haces|me harias)\b[^.?!]{0,20}\b(un|el|mi)\s+plan\b")
# «Plan de ejecución» (de una consulta), de negocio, de pensiones: planes que no son de estudio.
OTROS_PLANES = re.compile(r"\bplan(es)? de (ejecucion|contingencia|accion|negocios?|pagos|comidas|pensiones)\b")
INEQUIVOCO = re.compile(r"\b(roadmap|hoja de ruta|calendario|cronograma|temario|itinerario|planning|plan de estudios?)\b")


def _norm(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if not unicodedata.combining(c) or c == "̃")


# «Tengo examen de X el día 12», «me examino en tres semanas», «quiero preparar el examen de…»: un examen con fecha es
# un plan (el plazo es el examen), aunque no diga «plan». «¿Cómo es el examen tipo test?» no: no hay fecha ni preparación.
EXAMEN = re.compile(r"\b(tengo|tendre|tenemos|me toca|hay)\s+(un |el |mi )?examen\b|\bme examino\b|"
                    r"\bprepar\w*\s+(el|un|mi|este|ese)\s+examen\b|\bexamen\b[^.?!]{0,50}\b(el (dia|lunes|martes|miercoles|"
                    r"jueves|viernes|sabado|domingo|\d)|dentro de|en (\w+ )?(dias?|semanas?|meses?)|la semana que viene|"
                    r"el mes que viene|(pasado )?ma(?:ñ|ñ)ana)")


def pide_plan(mensaje: str) -> bool:
    t = OTROS_PLANES.sub(" ", COLOQUIAL.sub(" ", _norm(mensaje)))
    if re.search(r"\b(modo|a partir de ahora|de ahora en adelante|desde ahora)\b", t) and not INEQUIVOCO.search(t):
        return False
    if not PIDE_PLAN.search(t) and not EXAMEN.search(t):
        return False
    return not (EXPLICAR.search(t) and not INEQUIVOCO.search(t) and not HAZ_PLAN.search(t))


# «Guárdalo», «guardémoslo», «apúntamelo», «esto a mis notas»: guardar la respuesta anterior en Mis notas.
# Las formas con pronombre («guárdalo», «guárdame esto») siempre son una petición.
GUARDAR = re.compile(r"\b(guardalo|guardala|guardame|guardamelo|guardamela|guardemos|guardemoslo|guardemosla|guardarlo|guardarla|"
                     r"guardatelo|guardatela|salvalo|salvala|apuntalo|apuntala|apuntame|apuntamelo|apuntamela|apuntemos|apuntemoslo|"
                     r"apuntarlo|anotalo|anotala|anotame|anotamelo|anotamela|anotemos|anotemoslo|anotarlo|"
                     r"(a|en) mis (notas|apuntes))\b")
# «Guarda», «apunta» o «anota» a secas también es «él guarda» («localStorage guarda los datos»): solo cuenta
# al empezar la frase o con lo que se guarda detrás («guarda esto», «anota la respuesta»).
SUELTO = re.compile(r"(^|[.!?,;:]\s*|\b(vale|venga|ok|pues|bien|y)\s+)(guarda|apunta|anota)\b"
                    r"|\b(guarda|apunta|anota) (esto|eso|esta|este|lo anterior|lo de antes|la respuesta|esa respuesta|todo)\b")
# «Guarda silencio», «¿dónde se guarda la sesión?»: no son peticiones de guardar.
NO_GUARDAR = re.compile(r"\b(guarda (silencio|las formas|relacion|distancia)|se guarda|donde guarda|como guarda|"
                        r"guarda (en|el|la|los|las) (memoria|cache|estado|base|cookie|sesion|token))\b")
# «Apúntalo para mañana a las 18:00», «guárdame un hueco el jueves»: eso es agenda, no «Mis notas».
APUNTAR = re.compile(r"\b(apunt\w*|anot\w*|guardame un hueco)")
AGENDA = re.compile(r"\b(calendario|agenda|hueco|examen|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|"
                    r"\bma(?:ñ|ñ)ana\b|\b\d{1,2}:\d{2}\b|\bel \d{1,2}\b|\ba las \d")
CALENDARIO = re.compile(r"\b(calendario|agenda|hueco)\b")
MIS_NOTAS = re.compile(r"\bmis (notas|apuntes)\b")


def pide_guardar(mensaje: str) -> bool:
    t = _norm(mensaje).strip()
    if not MIS_NOTAS.search(t) and ((APUNTAR.search(t) and AGENDA.search(t)) or CALENDARIO.search(t)):
        return False
    return bool(GUARDAR.search(t) or SUELTO.search(t)) and not NO_GUARDAR.search(t)


def deja_plan(mensaje: str) -> bool:
    return bool(DEJAR_PLAN.search(_norm(mensaje)))


# Con un plan propuesto delante, «explícame por qué L2 va antes» es hablar del plan, no dejarlo: solo lo descarta
# quien lo rechaza con todas las letras.
RECHAZAR_PLAN = re.compile(r"\b(dejalo|deja el plan|olvida el plan|olvidalo|cancela (el )?plan|cancelar el plan|sin plan|"
                           r"no (quiero|hagas|hagamos|necesito) (un |el )?plan|ahora no|mejor otra cosa|cambiemos de tema)\b")


def rechaza_plan(mensaje: str) -> bool:
    return bool(RECHAZAR_PLAN.search(_norm(mensaje)))
