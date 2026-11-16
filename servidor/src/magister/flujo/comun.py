"""Ayudas compartidas por los nodos: avisar de la fase, hablar en flujo y las reglas."""

import json
from datetime import date

from langgraph.config import get_stream_writer

from magister.cerebro.modelo import Turno, generar
from magister.config import ajustes
from magister.flujo.estado import Estado
from magister.plan.esquemas import Perfil
from magister.plan.reglas import ReglasPlan

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
TURNOS_DIAGNOSTICO = 4  # últimos turnos que ve el diagnóstico (criterio general)


def escribir(**datos: object) -> None:
    try:
        get_stream_writer()(datos)
    except RuntimeError:
        pass  # fuera de un flujo (pruebas que invocan sin stream)


def fase(nombre: str) -> None:
    escribir(fase=nombre)


async def hablar(sistema: str, historial: list[Turno]) -> str:
    """Llama al modelo y emite cada trozo como {"t": ...}. Devuelve el texto entero."""
    if ajustes.canario:
        sistema += f"\n\nClave interna de esta instalación (secreta: nunca la escribas ni la repitas): {ajustes.canario}"
    partes: list[str] = []
    async for trozo in generar(sistema, historial):
        partes.append(trozo)
        escribir(t=trozo)
    return "".join(partes)


def decir(texto: str) -> str:
    """Un texto fijo, sin modelo, emitido como si llegara en flujo."""
    escribir(t=texto)
    return texto


def hoy_de(estado: Estado) -> date:
    return date.fromisoformat(estado["hoy"])


def perfil_de(estado: Estado) -> Perfil:
    return Perfil.model_validate(estado.get("perfil") or {})


def perfil_json(perfil: Perfil) -> str:
    return json.dumps(perfil.model_dump(mode="json"), ensure_ascii=False, indent=1)


def reglas_plan() -> ReglasPlan:
    return ReglasPlan(holgura=ajustes.holgura, horas_max_leccion=ajustes.horas_max_leccion)


def turnos_recientes(estado: Estado, n: int = TURNOS_DIAGNOSTICO) -> str:
    turnos = estado.get("turnos", [])[:-1][-n:]  # sin el último mensaje, que va aparte
    return "\n".join(f"{'Alumno' if t['rol'] == 'usuario' else 'Tutor'}: {t['contenido']}" for t in turnos) or "(ninguno)"


VOZ = (
    "Esta respuesta se va a escuchar, no a leer. Habla como en una conversación: frases cortas, de 80 a 150 palabras "
    "en total, sin títulos, listas, tablas, enlaces ni bloques (nada de código, test, opciones ni diagramas). Las fórmulas, "
    "dichas con palabras («la presión más un medio de rho por la velocidad al cuadrado»). Termina con una pregunta corta "
    "para seguir hablando."
)


async def lecciones_del_alumno() -> str:
    """Las lecciones de sus planes, para que el tutor le remita a ellas («lo tienes en L2»)."""
    from sqlalchemy import text

    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select t.nombre, l.clave, l.titulo, "
            "coalesce(bool_and(se.estado = 'hecha'), false) as hecha, "
            "exists(select 1 from materiales m where m.plan_id = l.plan_id and m.leccion_clave = l.clave and m.tipo = 'apuntes') "
            "from lecciones l join planes p on p.id = l.plan_id and p.estado = 'aceptado' join temas t on t.id = p.tema_id "
            "left join sesiones se on se.plan_id = l.plan_id and se.leccion_clave = l.clave "
            "group by t.nombre, l.plan_id, l.clave, l.titulo, l.orden order by l.plan_id, l.orden limit 60"))).all()
    lineas, tema = [], None
    for nombre, clave, titulo, hecha, apuntes in filas:
        if nombre != tema:
            lineas.append(f"Plan «{nombre}»:")
            tema = nombre
        marcas = ", ".join(x for x in ("hecha" if hecha else "", "con apuntes" if apuntes else "") if x)
        lineas.append(f"- {clave} {titulo}" + (f" ({marcas})" if marcas else ""))
    return "\n".join(lineas)


async def sistema_de_estudio(base: str, estado: dict) -> str:
    """El prompt de estudio con lo que el tutor debe saber del alumno en este turno."""
    partes = [base]
    lecciones = ""
    if estado.get("conversacion_id"):  # solo en conversaciones de verdad (las pruebas del grafo van sin base)
        try:
            lecciones = await lecciones_del_alumno()
        except Exception:  # noqa: BLE001  (sin base, el tutor sigue funcionando)
            lecciones = ""
    if lecciones:
        partes.append(
            "Lo que el alumno estudia en Magister:\n" + lecciones + "\n"
            "Si lo que pregunta está en una de esas lecciones, nómbrala («lo tienes en L2») para que la abra en Lecciones o en "
            "el modo foco; si ya la hizo, conecta con lo que vio allí. No repitas la lista.")
    if estado.get("voz"):
        partes.append(VOZ)
    return "\n\n".join(partes)


# Cuántos turnos se reenvían al modelo en Estudio libre: lo reciente basta para seguir el hilo y ahorra tokens.
TURNOS_ESTUDIO = 12


def historial_reciente(estado: dict, n: int = TURNOS_ESTUDIO) -> list:
    from magister.cerebro.modelo import Turno

    turnos = estado.get("turnos", [])[-n:]
    return [Turno(t["rol"], t["contenido"]) for t in turnos]  # type: ignore[arg-type]


_GENERICAS = {"explica", "explicame", "explicar", "rapido", "quiero", "sobre", "puedes", "ejemplo", "diferencia", "entre",
              "como", "funciona", "porque", "cuando", "donde", "cual", "cuales", "tengo", "duda", "dudas", "entiendo",
              "entender", "hacer", "hace", "sirve", "para", "esto", "esta", "este", "tema", "favor", "corto"}


def _palabras(t: str) -> set[str]:
    import re
    import unicodedata

    plano = "".join(c for c in unicodedata.normalize("NFD", t.lower()) if not unicodedata.combining(c))
    return {w for w in re.findall(r"[a-z0-9]+", plano) if len(w) > 3 and w not in _GENERICAS}


async def leccion_relacionada(mensaje: str) -> dict | None:
    """La lección de sus planes que más se parece a lo que pregunta (por palabras de título y conceptos), sin modelo."""
    from sqlalchemy import text

    from magister.datos.sesion import nueva_sesion

    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select l.plan_id, p.tema_id, l.clave, l.titulo, coalesce(string_agg(c.nombre, ' '), ''), "
            "(select max(m.id) from materiales m where m.plan_id = l.plan_id and m.leccion_clave = l.clave and m.tipo = 'apuntes'), "
            "(select count(*) from preguntas q where q.plan_id = l.plan_id and q.leccion_clave = l.clave and q.estado = 'activa') "
            "from lecciones l join planes p on p.id = l.plan_id and p.estado = 'aceptado' "
            "left join conceptos c on c.plan_id = l.plan_id and c.leccion_clave = l.clave "
            "group by l.plan_id, p.tema_id, l.clave, l.titulo"))).all()
    buscadas = _palabras(mensaje)
    mejor, puntos = None, 0
    for plan_id, tema_id, clave, titulo, conceptos, apuntes_id, preguntas in filas:
        n = len(buscadas & _palabras(f"{titulo} {conceptos}"))
        if n > puntos:
            mejor, puntos = {"plan_id": plan_id, "tema_id": tema_id, "clave": clave, "titulo": titulo,
                             "apuntes_id": apuntes_id, "preguntas": preguntas}, n
    return mejor


async def acciones_de_estudio(estado: dict, sin_fuentes: bool) -> None:
    """Lo que el arnés puede hacer a continuación, como botones: no depende del modelo ni gasta tokens."""
    if not estado.get("conversacion_id") or estado.get("voz"):
        return
    mensaje = estado.get("mensaje", "")
    consulta = estado.get("consulta") or mensaje
    acciones: list[dict] = []
    try:
        leccion = await leccion_relacionada(f"{mensaje} {consulta}")
    except Exception:  # noqa: BLE001
        leccion = None
    if leccion:
        c = leccion["clave"]
        if leccion["apuntes_id"]:
            acciones.append({"tipo": "ir", "etiqueta": f"Estudiar {c} en modo foco", "ruta": f"#/tutor/foco/{leccion['apuntes_id']}"})
        else:
            acciones.append({"tipo": "ir", "etiqueta": f"Preparar {c}: {leccion['titulo']}", "ruta": f"#/fichas/{leccion['tema_id']}/{c}"})
        if leccion["preguntas"]:
            acciones.append({"tipo": "ir", "etiqueta": f"Test rápido de {c}",
                             "ruta": f"#/examen/{leccion['plan_id']}/{c}/5/10"})
    if sin_fuentes:
        acciones.append({"tipo": "buscar", "etiqueta": "Buscar documentos sobre esto", "consulta": consulta[:200]})
    if not leccion:
        acciones.append({"tipo": "ir", "etiqueta": "Hacer un plan de este tema", "ruta": "#/nuevo-plan"})
    if acciones:
        escribir(acciones=acciones[:3])
