"""El guion gráfico de un vídeo animado: el modelo escribe el contenido (el mapa de la lección y cada tramo con su
tesis, su narración y los datos de su escena) y el código monta el formato: el mapa entero en cada tablero, el texto por
escenas para la voz y los subtítulos, y lo que se guarda.

El formato es el de `web/src/escena/tipos.ts`, que es quien lo pinta: si cambias uno, cambia el otro. Aquí van solo
las escenas que sirven para cualquier materia; las muy de bases de datos (índice, mitades, árbol B) se quedan para
los vídeos escritos a mano.
"""

import logging
from typing import Literal

from pydantic import BaseModel, Field

from magister.cerebro import materias
from magister.cerebro.estructura import ErrorEstructura, estructurar
from magister.cerebro.prompts import cargar
from magister.material.modelos import EntradaMaterial

registro = logging.getLogger("magister.guion_grafico")
PALABRAS_MINUTO = 150
MAX_PALABRAS_TRAMO = 110
HOLGURA = 0.4  # el total de palabras puede apartarse un 40 % del presupuesto antes de pedir otro intento

Estado = Literal["bien", "mal", "foco", "nuevo"]
Momento = Literal["mapa", "intuicion", "choque", "nombre", "teoria", "repaso"]


class Idea(BaseModel):
    nombre: str = Field(description="La idea en 1 a 3 palabras.")
    que: str = Field(description="Qué es, en menos de 6 palabras.")


class Parte(BaseModel):
    nombre: str
    ideas: list[Idea] = Field(min_length=1)


# Las escenas. Los campos opcionales que no uses, a null.

class Tablero(BaseModel):
    tipo: Literal["tablero"]
    actual: int = Field(description="Qué idea del mapa empieza ahora, contando todas en orden desde 0. Las anteriores salen hechas.")


class Codigo(BaseModel):
    fichero: str
    lineas: list[str]
    resaltar: list[int] | None = Field(None, description="Números de línea (desde 1) en ámbar.")


class FilaMemoria(BaseModel):
    clave: str
    valor: str
    estado: Estado | None = None


class Memoria(BaseModel):
    titulo: str
    filas: list[FilaMemoria]


class LineaEstado(BaseModel):
    texto: str
    estado: Estado | None = None


class Pantalla(BaseModel):
    titulo: str
    lineas: list[LineaEstado]
    boton: str | None = None


class Cable(BaseModel):
    de: Literal["codigo", "memoria", "pantalla"]
    a: Literal["codigo", "memoria", "pantalla"]
    etiqueta: str
    estado: Estado | None = None


class PorDentro(BaseModel):
    tipo: Literal["por_dentro"]
    codigo: Codigo
    memoria: Memoria
    pantalla: Pantalla
    flujo: list[Cable] = Field(description="Los cables, en el orden en que viaja el dato.")
    repetir: Literal["acumula", "igual"] | None = Field(
        None, description="Al pulsar el botón: «acumula» añade otra fila (el fallo), «igual» lo deja igual.")


class Pregunta(BaseModel):
    tipo: Literal["pregunta"]
    pregunta: str
    pista: str | None = None


class Lado(BaseModel):
    etiqueta: str
    lineas: list[str]
    estado: Estado | None = None
    nota: str | None = None


class Contraste(BaseModel):
    tipo: Literal["contraste"]
    lados: list[Lado] = Field(min_length=2, max_length=3)
    veredicto: str | None = None


class Opcion(BaseModel):
    nombre: str
    como: str = Field(description="Cómo es, en una línea corta (puede ser código).")
    explica: str
    veredicto: Literal["bien", "mal", "depende"]
    usar_para: str


class Opciones(BaseModel):
    tipo: Literal["opciones"]
    opciones: list[Opcion] = Field(min_length=2, max_length=4)
    etiqueta_uso: str | None = None


class Tabla(BaseModel):
    tipo: Literal["tabla"]
    nombre: str
    columnas: list[str]
    filas: list[list[str]] = Field(description="Como mucho 7 filas; cada una con tantas celdas como columnas.")
    resto: str | None = Field(None, description="Lo que no se ve, p. ej. «999.992 filas más».")


class Barra(BaseModel):
    etiqueta: str
    valor: float
    texto: str
    estado: Estado | None = None


class Barras(BaseModel):
    tipo: Literal["barras"]
    titulo: str | None = None
    escala: Literal["log", "lineal"]
    barras: list[Barra] = Field(min_length=2, max_length=6)


class Metrica(BaseModel):
    etiqueta: str
    valor: str
    estado: Estado | None = None
    antes: str | None = None


class Consulta(BaseModel):
    tipo: Literal["consulta"]
    sql: list[str] = Field(description="Una orden o consulta, una línea por elemento.")
    salida_titulo: str | None = None
    salida: list[LineaEstado]
    metrica: Metrica | None = None


class Paso(BaseModel):
    texto: str
    detalle: str | None = None


class Pasos(BaseModel):
    tipo: Literal["pasos"]
    pasos: list[Paso] = Field(min_length=2, max_length=6)


class Punto(BaseModel):
    tipo: Literal["punto"]
    id: str
    x: float
    y: float
    etiqueta: str | None = None
    coords: str | None = None
    lado: Literal["n", "s", "e", "o"] | None = None
    paso: int | None = None
    estado: Estado | None = None


class Segmento(BaseModel):
    tipo: Literal["segmento"]
    de: str
    a: str
    etiqueta: str | None = None
    discontinuo: bool | None = None
    flecha: bool | None = None
    paso: int | None = None
    estado: Estado | None = None


class Angulo(BaseModel):
    tipo: Literal["angulo"]
    vertice: str
    desde: float = Field(description="Acimut en gon: 0 norte, 100 este, 200 sur, 300 oeste.")
    hasta: float
    etiqueta: str | None = None
    paso: int | None = None
    estado: Estado | None = None


class Proyeccion(BaseModel):
    tipo: Literal["proyeccion"]
    de: str
    a: str
    etiqueta_x: str | None = None
    etiqueta_y: str | None = None
    paso: int | None = None
    estado: Estado | None = None


class Norte(BaseModel):
    tipo: Literal["norte"]
    en: str
    paso: int | None = None


class TextoFigura(BaseModel):
    tipo: Literal["texto"]
    x: float
    y: float
    texto: str
    paso: int | None = None


class EjesFigura(BaseModel):
    x: str
    y: str


class Figura(BaseModel):
    tipo: Literal["figura"]
    elementos: list[Punto | Segmento | Angulo | Proyeccion | Norte | TextoFigura] = Field(
        description="En coordenadas del mundo (y hacia arriba). `paso` 0, 1, 2…: el orden en que se dibujan.")
    rejilla: bool | None = None
    ejes: EjesFigura | None = None


class LineaFormula(BaseModel):
    tex: str = Field(description="LaTeX sin $.")
    nota: str | None = None
    estado: Estado | None = None


class Simbolo(BaseModel):
    simbolo: str = Field(description="LaTeX sin $.")
    significa: str


class Formula(BaseModel):
    tipo: Literal["formula"]
    formulas: list[LineaFormula] = Field(min_length=1, max_length=4)
    simbolos: list[Simbolo] | None = None


class FilaCalculo(BaseModel):
    que: str
    sustitucion: str | None = Field(None, description="LaTeX sin $: la fórmula con los números puestos.")
    resultado: str = Field(description="LaTeX sin $.")
    estado: Estado | None = None


class Calculo(BaseModel):
    tipo: Literal["calculo"]
    datos: str | None = Field(None, description="Los datos de partida, en texto llano (sin LaTeX): «A = (1000 ; 2000) · D = 150 m».")
    filas: list[FilaCalculo] = Field(min_length=1, max_length=5)
    nota: str | None = None


Escena = Tablero | PorDentro | Pregunta | Contraste | Opciones | Tabla | Barras | Consulta | Pasos | Figura | Formula | Calculo


class Tramo(BaseModel):
    concepto: str = Field(description="El concepto, en 1 a 3 palabras (sale como título).")
    tesis: str = Field(description="La idea de este tramo en 3 a 6 palabras (sale tras el concepto).")
    momento: Momento
    narracion: str = Field(description="Lo que dice la voz: de 25 a 90 palabras, frases cortas, sin fórmulas escritas.")
    escena: Escena


class GuionGraficoModelo(BaseModel):
    titulo: str
    fondo: Literal["liso", "cartesiano"]
    partes: list[Parte] = Field(min_length=1, max_length=5, description="El mapa de la lección: de 2 a 4 partes con sus ideas.")
    tramos: list[Tramo] = Field(min_length=3)


def palabras(texto: str) -> int:
    return len(texto.split())


def _ideas(g: GuionGraficoModelo) -> int:
    return sum(len(p.ideas) for p in g.partes)


def reglas(g: GuionGraficoModelo, presupuesto: int) -> list[str]:
    """Lo que el esquema no puede decir y la escena necesita para pintarse bien."""
    errores: list[str] = []
    n_ideas = _ideas(g)
    if g.tramos[0].escena.tipo != "tablero":
        errores.append("tramos.0: el primer tramo es el mapa (escena tablero con actual 0)")
    total = sum(palabras(t.narracion) for t in g.tramos)
    if not (1 - HOLGURA) * presupuesto <= total <= (1 + HOLGURA) * presupuesto:
        errores.append(f"la narración suma {total} palabras y el presupuesto es de unas {presupuesto}")
    for i, t in enumerate(g.tramos):
        donde = f"tramos.{i}"
        if palabras(t.narracion) > MAX_PALABRAS_TRAMO:
            errores.append(f"{donde}: la narración pasa de {MAX_PALABRAS_TRAMO} palabras; pártela en dos tramos")
        if any(c in t.narracion for c in "$\\^"):
            errores.append(f"{donde}: la narración se lee en voz alta; di las fórmulas con palabras")
        e = t.escena
        if isinstance(e, Tablero) and not 0 <= e.actual < n_ideas:
            errores.append(f"{donde}: actual {e.actual} fuera del mapa (hay {n_ideas} ideas, de 0 a {n_ideas - 1})")
        if isinstance(e, Tabla):
            for k, fila in enumerate(e.filas):
                if len(fila) != len(e.columnas):
                    errores.append(f"{donde}.escena.filas.{k}: {len(fila)} celdas para {len(e.columnas)} columnas")
        if isinstance(e, Figura):
            ids = [x.id for x in e.elementos if isinstance(x, Punto)]
            if len(ids) != len(set(ids)):
                errores.append(f"{donde}.escena: hay puntos con el mismo id")
            for x in e.elementos:
                refs = {Segmento: ("de", "a"), Proyeccion: ("de", "a"), Angulo: ("vertice",), Norte: ("en",)}.get(type(x), ())
                for campo in refs:
                    if getattr(x, campo) not in ids:
                        errores.append(f"{donde}.escena: «{getattr(x, campo)}» no es ningún punto de la figura")
        if isinstance(e, PorDentro) and e.codigo.resaltar:
            fuera = [n for n in e.codigo.resaltar if not 1 <= n <= len(e.codigo.lineas)]
            if fuera:
                errores.append(f"{donde}.escena.codigo.resaltar: líneas {fuera} que no existen")
    return errores


def montar(g: GuionGraficoModelo) -> dict:
    """Lo que pinta la web (`GuionGrafico` de tipos.ts): cada tablero lleva el mapa entero y lo vacío no viaja."""
    partes = [p.model_dump() for p in g.partes]
    tramos = []
    for t in g.tramos:
        escena = t.escena.model_dump(exclude_none=True)
        if escena["tipo"] == "tablero":
            escena["partes"] = partes
        tramos.append({"concepto": t.concepto, "tesis": t.tesis, "momento": t.momento, "narracion": t.narracion.strip(),
                       "escena": escena})
    return {"titulo": g.titulo, "fondo": g.fondo, "tramos": tramos}


def por_escenas(guion: dict) -> str:
    """El mismo vídeo en el formato de siempre (`[[momento]]` y lo que se dice): para el reproductor sencillo, la
    auditoría del guion y el MP4."""
    return "\n\n".join(f"[[{t.get('momento') or 'teoria'}]]\n{t['narracion']}" for t in guion["tramos"]) + "\n"


async def generar_guion_grafico(entrada: EntradaMaterial, apuntes: str, minutos: int, estilo_texto: str,
                                concepto: str | None = None) -> dict | None:
    """None si el modelo no da un guion gráfico válido tras sus intentos: entonces va el guion de siempre."""
    nucleo = [c.nombre for c in entrada.conceptos if c.nucleo] or [c.nombre for c in entrada.conceptos]
    if concepto:
        nucleo = [concepto]
    presupuesto = minutos * PALABRAS_MINUTO
    sistema = cargar("guion_grafico").rellenar(palabras=presupuesto, minutos=minutos, conceptos=", ".join(nucleo),
                                               titulo=entrada.titulo, estilo=estilo_texto,
                                               apuntes=apuntes.split("\n# Repaso")[0][:20000])
    if entrada.materia:
        sistema += "\n\n" + materias.texto(entrada.materia)
    try:
        g = await estructurar(sistema, "Escribe el guion gráfico.", GuionGraficoModelo,
                              reglas=lambda x: reglas(x, presupuesto), tarea="generar")
    except ErrorEstructura as e:
        registro.warning("guion gráfico sin salida válida: %s", e)
        return None
    return montar(g)
