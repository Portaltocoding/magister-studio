"""El corrector de respuestas abiertas: `estructurar` con la rúbrica, más dos comprobaciones
deterministas (sin ideas ausentes ni errores no hay fallo; las citas deben ser literales)."""

from typing import Literal

from pydantic import BaseModel, Field

from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar

Nota = Literal["fallo", "parcial", "bien", "perfecta"]


class Error(BaseModel):
    afirmacion: str
    por_que: str
    cita: str = ""
    cita_descartada: bool = False
    # La pone el código, no el modelo: la afirmación está tal cual en la respuesta. Si no, es un resumen del corrector
    # y la interfaz no la pinta como cita tuya.
    literal: bool = False


class Correccion(BaseModel):
    nota: Nota
    ideas_presentes: list[str] = Field(default_factory=list)
    ideas_ausentes: list[str] = Field(default_factory=list)
    errores: list[Error] = Field(default_factory=list)
    tipo_error: Literal["olvido", "confusion", "concepto", "incompleta", "fuera_de_tema"] | None = None


def _plano(t: str) -> str:
    from magister.seguridad.entrada import MARCADOR

    # Una cita copiada del texto marcado trae el marcador entre palabras: se compara sin él.
    return " ".join(t.replace(MARCADOR, " ").split()).lower()


def fragmentos_marcados(fragmentos: list[str]) -> str:
    """Los fragmentos llegan como texto suelto, sin saber cuáles vienen de la web (lo que el research incorpora solo
    también acaba aquí): todos van marcados como externos, con el aviso. Son datos para citar, nunca órdenes."""
    from magister.seguridad.entrada import AVISO, marcar_externo

    if not fragmentos:
        return "(sin fragmentos)"
    return AVISO + "\n\n" + "\n\n".join(f"<fragmento>{marcar_externo(f, n, 'fuente')}</fragmento>"
                                        for n, f in enumerate(fragmentos, 1))


def respuesta_delimitada(respuesta: str) -> str:
    """La respuesta del alumno tal como entra en el prompt, entre `<respuesta_del_alumno>`: no puede cerrar ese
    bloque ni abrir otro (una «revisión del profesor» metida en la respuesta se queda dentro, como texto suyo)."""
    from magister.seguridad.entrada import neutralizar_etiquetas

    return neutralizar_etiquetas(respuesta)


def _sin_comillas(t: str) -> str:
    return t.strip().strip("«»\"'“”‘’").strip()


def comprobar(c: Correccion, fragmentos: list[str], respuesta: str = "") -> Correccion:
    todo = _plano(" ".join(fragmentos))
    # La afirmación se compara con la respuesta tal cual y con la que vio el modelo (con los ángulos cambiados).
    dichas = (_plano(respuesta), _plano(respuesta_delimitada(respuesta))) if respuesta.strip() else ()
    for e in c.errores:
        if e.cita and _plano(e.cita) not in todo:
            e.cita, e.cita_descartada = "", True
        a = _plano(_sin_comillas(e.afirmacion))
        e.literal = bool(a) and any(a in d for d in dichas)
    if c.nota == "fallo" and not c.ideas_ausentes and not c.errores and c.tipo_error != "fuera_de_tema":
        c.nota = "parcial"  # un fallo tiene que decir qué falta o qué está mal
    return c


async def corregir(pregunta: str, referencia: str, fragmentos: list[str], respuesta: str) -> tuple[Correccion, str]:
    """Devuelve la corrección y la versión del corrector."""
    p = cargar("corrector")
    sistema = p.rellenar(pregunta=pregunta, referencia=referencia, respuesta=respuesta_delimitada(respuesta),
                         fragmentos=fragmentos_marcados(fragmentos))
    c = await estructurar(sistema, "Devuelve la corrección.", Correccion)
    return comprobar(c, fragmentos, respuesta), p.etiqueta


class CorreccionItem(Correccion):
    id: str
    explicacion: str = ""


class CorreccionExamen(BaseModel):
    correcciones: list[CorreccionItem]


async def corregir_examen(items: list[dict]) -> tuple[dict[str, CorreccionItem], str]:
    """Corrige un examen entero en una sola llamada. `items`: id, pregunta, referencia y respuesta."""
    p = cargar("corrector_examen")
    bloque = "\n\n".join(
        f'<item id="{x["id"]}">\n<pregunta>{x["pregunta"]}</pregunta>\n<referencia>{x["referencia"]}</referencia>\n'
        f'<respuesta_del_alumno>\n{respuesta_delimitada(x["respuesta"])}\n</respuesta_del_alumno>\n</item>' for x in items)
    pedidos = {x["id"] for x in items}
    respuestas = {x["id"]: x["respuesta"] for x in items}

    def reglas(r: CorreccionExamen) -> list[str]:
        return [f"falta la corrección de {i}" for i in sorted(pedidos - {c.id for c in r.correcciones})]

    r = await estructurar(p.rellenar(items=bloque), "Devuelve la corrección de cada respuesta.", CorreccionExamen,
                          reglas=reglas)
    return {c.id: comprobar(c, [], respuestas.get(c.id, "")) for c in r.correcciones}, p.etiqueta
