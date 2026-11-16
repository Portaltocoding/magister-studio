"""Reconocer, sin modelo, cuándo una conversación de estudio pide un plan y cuándo lo abandona.

Así las partes se hablan: si en Estudio libre pides un plan, un roadmap u organizarlo en el
calendario, la conversación pasa al diagnóstico con lo ya hablado como contexto.
"""

import re
import unicodedata

VERBOS = r"(haz|hazme|haced|hacer|hagamos|crea|creame|crear|monta|montame|montar|prepara|preparame|preparar|organiza|organizame|" \
         r"organizar|organizarlo|organizalo|planifica|planificame|planificar|planificarlo|diseña|diseñame|quiero|queria|necesito|" \
         r"me haces|me harias|podemos hacer|podrias hacer|puedes hacer|ayudame a hacer|ponlo|ponmelo|meterlo|metelo|meter)"
OBJETOS = r"(plan|planning|roadmap|hoja de ruta|calendario|cronograma|temario|itinerario|plan de estudio)"
PIDE_PLAN = re.compile(rf"\b{VERBOS}\b[^.?!]{{0,60}}\b{OBJETOS}\b|\b{OBJETOS}\b[^.?!]{{0,30}}\b(para|con)\b[^.?!]{{0,40}}\b(semanas?|meses?|dias?|horas?)\b")
DEJAR_PLAN = re.compile(r"\b(dejalo|deja el plan|olvida el plan|olvidalo|cancela|cancelar el plan|sin plan|no quiero (un |el )?plan|"
                        r"otra cosa|cambiemos de tema|explicamelo|solo (quiero )?(que me )?expli\w*|no necesito (un |el )?plan)\b")
# «En plan rápido», «plan B»: muletillas, no planes de estudio.
COLOQUIAL = re.compile(r"\b(en plan|plan b|de buen plan|menudo plan|vaya plan)\b")
# Pedir una explicación con «plan» por medio no es pedir un plan, salvo que nombre algo inequívoco.
EXPLICAR = re.compile(r"\b(explica\w*|ense|cuentame|que es|como funciona|entender)")
INEQUIVOCO = re.compile(r"\b(roadmap|hoja de ruta|calendario|cronograma|temario|itinerario|planning|plan de estudios?)\b")


def _norm(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if not unicodedata.combining(c) or c == "̃")


def pide_plan(mensaje: str) -> bool:
    t = COLOQUIAL.sub(" ", _norm(mensaje))
    if re.search(r"\b(modo|a partir de ahora|de ahora en adelante|desde ahora)\b", t) and not INEQUIVOCO.search(t):
        return False
    if not PIDE_PLAN.search(t):
        return False
    return not (EXPLICAR.search(t) and not INEQUIVOCO.search(t))


def deja_plan(mensaje: str) -> bool:
    return bool(DEJAR_PLAN.search(_norm(mensaje)))
