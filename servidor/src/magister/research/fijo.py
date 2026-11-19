"""El flujo fijo del research, por objetivos (ADR-0020). Dos llamadas por lección.

1. El modelo escribe UNA consulta por objetivo, con una alternativa (`research_consultas`). Si una consulta no da
   nada, se busca su alternativa sin volver a llamar al modelo.
2. Se leen hasta 12 URLs, por turnos entre los objetivos. Antes de leer se descarta gratis lo que no sirve (anuncios,
   espejos, ficheros) y como mucho se leen 2 páginas del mismo dominio. Una página que es un pedazo (el resumen tras un
   muro de pago) no se juzga tal cual: se prueba UNA alternativa gratis (su PDF, o su versión en abierto).
3. Un juez con rúbrica (`research_juez`) que conoce al alumno dice qué objetivos explica cada página, de qué tipo es,
   cuánto profundiza y con qué autoridad, y cita una frase que el código comprueba. Una cita que no está se descarta.
4. El código elige por cobertura (`elegir`): la mejor página de cada objetivo, como mucho 2 del mismo dominio, y dice
   qué objetivos se quedan sin fuente.
"""

import re
import unicodedata
from collections import Counter
from itertools import zip_longest
from typing import Literal, get_args

from pydantic import BaseModel, Field, field_validator

from magister.cerebro.estructura import ErrorEstructura, Intento, estructurar
from magister.cerebro.prompts import cargar
from magister.config import ajustes
from magister.fuentes.extraer import recomponer
from magister.research.herramientas import Herramientas, delimitar, descartar_url, dominio

SIN_CORREO = "con un correo en MAGISTER_UNPAYWALL_EMAIL se buscaría su versión en abierto"

Tipo = Literal["oficial", "referencia", "tutorial", "articulo", "portada", "comercial", "foro", "espejo", "muro"]
TIPOS_FUERA = {"portada", "comercial", "espejo", "muro"}
MAX_POR_DOMINIO = 2


class ConsultaObjetivo(BaseModel):
    objetivo: int = Field(ge=0, description="El número del objetivo; 0 si la lección no trae objetivos.")
    consulta: str
    alternativa: str = Field("", description="Otra consulta con otras palabras, por si la primera no da nada.")


class Consultas(BaseModel):
    consultas: list[ConsultaObjetivo] = Field(min_length=1, max_length=10)


class Nota(BaseModel):
    url: str
    objetivos: list[int] = Field(default_factory=list)
    tipo: Tipo
    profundidad: int = Field(ge=0, le=3)
    autoridad: int = Field(ge=0, le=3)
    cita: str = ""
    resumen: str = ""

    # Una sola nota rara no tira el lote entero (y otra llamada): un tipo que no está en la lista es «articulo» y una
    # puntuación fuera de 0-3 se queda en el borde.
    @field_validator("tipo", mode="before")
    @classmethod
    def _tipo_conocido(cls, v):
        return v if v in get_args(Tipo) else "articulo"

    @field_validator("profundidad", "autoridad", mode="before")
    @classmethod
    def _en_escala(cls, v):
        return min(3, max(0, v)) if isinstance(v, int) and not isinstance(v, bool) else v


class Notas(BaseModel):
    notas: list[Nota]


def describir(leccion: dict) -> str:
    """La lección para los prompts: los objetivos numerados y, si se sabe, quién es el alumno."""
    objetivos = leccion.get("objetivos") or []
    lineas = [f"Tema: {leccion.get('tema', '')}", f"Lección: {leccion['titulo']}"]
    if objetivos:
        lineas.append("Objetivos:\n" + "\n".join(f"{i}. {o}" for i, o in enumerate(objetivos, 1)))
    else:
        lineas.append("Objetivos: (sin objetivos numerados)")
    alumno = leccion.get("alumno") or {}
    campos = (("nivel", "nivel"), ("objetivo", "objetivo"), ("preferencias", "preferencias"), ("sabes", "lo que ya sabe"))
    partes = [f"{etiqueta} {str(alumno[k]).strip()}" for k, etiqueta in campos if alumno.get(k) and str(alumno[k]).strip()]
    if partes:
        lineas.append("Alumno: " + "; ".join(partes))
    return "\n".join(lineas)


# Lo que decide el código, sin modelo.

_COMILLAS = str.maketrans({"‘": "'", "’": "'", "‚": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "‟": '"', "«": '"',
                           "»": '"', "—": "-", "–": "-", "‒": "-", "―": "-", "‹": "<", "›": ">", " ": " "})
_ENLACE_MD = re.compile(r"\[([^\]]*)\]\([^)]*\)")


def normalizar(t: str) -> str:
    """Minúsculas, espacios colapsados, comillas tipográficas como rectas, guiones largos como cortos y sin las marcas
    de Markdown del extractor (énfasis y enlaces). Como en la extracción de un PDF, los acentos sueltos de LaTeX
    («Aplicaci´on»), las ligaduras («ﬁ») y los guiones de fin de línea se recomponen."""
    t = unicodedata.normalize("NFC", recomponer(t or ""))
    t = _ENLACE_MD.sub(r"\1", t.translate(_COMILLAS))
    t = re.sub(r"[*_`#]+", "", t)
    return " ".join(t.lower().split())


def cita_en(cita: str, extracto: str) -> bool:
    """La cita está en el extracto, tal cual salvo comillas, guiones, mayúsculas y espacios. Una cita de menos de 3
    palabras no demuestra nada."""
    c = normalizar(cita).strip(" .,;:\"'")
    return len(c.split()) >= 3 and c in normalizar(extracto)


def vale(nota: Nota, extracto: str, exigir_objetivos: bool = True) -> bool:
    """Profundidad 2 o más, autoridad 1 o más, ni portada ni comercial ni espejo ni muro, algún objetivo explicado y una
    cita que está de verdad."""
    return (nota.profundidad >= 2 and nota.autoridad >= 1 and nota.tipo not in TIPOS_FUERA
            and (bool(nota.objetivos) or not exigir_objetivos) and cita_en(nota.cita, extracto))


def puntuacion(nota: Nota) -> int:
    return 2 * nota.profundidad + nota.autoridad


def elegir(notas_validas: list[Nota], n_objetivos: int, max_propuestas: int = 6, max_por_dominio: int = MAX_POR_DOMINIO,
           objetivos: list[int] | None = None) -> tuple[list[Nota], list[int]]:
    """(elegidas, objetivos sin fuente). Para cada objetivo, en orden, la mejor nota que lo cubra sin pasar el tope por
    dominio; después, solo notas de profundidad 3 y autoridad 2 o más. `objetivos`: los que hay que cubrir (por defecto,
    todos). Sin objetivos (el research libre), por puntuación con el tope por dominio."""
    orden = sorted(notas_validas, key=lambda x: -puntuacion(x))
    elegidas: list[Nota] = []
    por_dominio: Counter[str] = Counter()

    def cabe(x: Nota) -> bool:
        return all(x is not e for e in elegidas) and por_dominio[dominio(x.url)] < max_por_dominio

    def tomar(x: Nota) -> None:
        elegidas.append(x)
        por_dominio[dominio(x.url)] += 1

    if n_objetivos == 0:
        for x in orden:
            if len(elegidas) < max_propuestas and cabe(x):
                tomar(x)
        return elegidas, []
    a_cubrir = list(objetivos) if objetivos is not None else list(range(1, n_objetivos + 1))
    for o in a_cubrir:
        if len(elegidas) >= max_propuestas:
            break
        if any(o in e.objetivos for e in elegidas):
            continue
        mejor = next((x for x in orden if o in x.objetivos and cabe(x)), None)
        if mejor is not None:
            tomar(mejor)
    for x in orden:
        if len(elegidas) >= max_propuestas:
            break
        if x.profundidad == 3 and x.autoridad >= 2 and set(x.objetivos) & set(a_cubrir) and cabe(x):
            tomar(x)
    cubiertos = {o for e in elegidas for o in e.objetivos}
    return elegidas, [o for o in a_cubrir if o not in cubiertos]


def reglas_consultas(pedidos: list[int]):
    """Una consulta por objetivo pedido (o 3 con el objetivo 0 si no hay objetivos), de 2 a 10 palabras («Big-O
    notation» vale), sin «;» ni comillas: lo que juntaba dos objetivos daba 0 resultados. La alternativa, opcional, solo
    tiene el tope de 10."""

    def reglas(c: Consultas) -> list[str]:
        errores: list[str] = []
        numeros = [x.objetivo for x in c.consultas]
        if pedidos:
            faltan = [o for o in pedidos if o not in numeros]
            if faltan:
                errores.append(f"falta la consulta de los objetivos {', '.join(map(str, faltan))}")
            sobran = sorted({o for o in numeros if o not in pedidos})
            if sobran:
                errores.append(f"sobran consultas de objetivos que no se piden: {', '.join(map(str, sobran))}")
            repetidos = sorted({o for o in numeros if numeros.count(o) > 1})
            if repetidos:
                errores.append(f"una sola consulta por objetivo; repetidos: {', '.join(map(str, repetidos))}")
        elif len(c.consultas) != 3:
            errores.append("sin objetivos numerados, escribe exactamente 3 consultas con el objetivo 0")
        for x in c.consultas:
            for etiqueta, texto in (("consulta", x.consulta), ("alternativa", x.alternativa)):
                if etiqueta == "alternativa" and not texto.strip():
                    continue
                palabras = len(texto.split())
                minimo = 2 if etiqueta == "consulta" else 1
                if not minimo <= palabras <= 10:
                    errores.append(f"la {etiqueta} del objetivo {x.objetivo} tiene {palabras} palabras (de {minimo} a 10)")
                if ";" in texto or any(q in texto for q in '"«»“”'):
                    errores.append(f"la {etiqueta} del objetivo {x.objetivo} lleva «;» o comillas")
        return errores

    return reglas


def ficha_de(nota: Nota) -> dict:
    return {"objetivos": nota.objetivos, "tipo": nota.tipo, "profundidad": nota.profundidad, "autoridad": nota.autoridad,
            "cita": nota.cita, "resumen": nota.resumen, "dominio": dominio(nota.url)}


def _motivo_fin(n: int, sin_cubrir: list[int], objetivos: list[str]) -> str:
    texto = f"{n} propuestas"
    if sin_cubrir:
        nombres = "; ".join(objetivos[i - 1] for i in sin_cubrir if 0 < i <= len(objetivos))
        texto += f" · sin fuente: {len(sin_cubrir)} ({nombres})"
    return texto


async def research_fijo(
    leccion: dict, h: Herramientas, max_urls: int = 12, max_propuestas: int = 6, max_intentos: int | None = None
) -> dict:
    """`max_intentos` es el tope de lecturas intentadas, buenas o fallidas (por defecto, `max_urls` + 5). `leccion`
    puede traer `pedidos` (los números de los objetivos que hay que buscar: «Buscar esto») y `alumno`."""
    traza: list[dict] = []
    llamadas = 0
    objetivos: list[str] = list(leccion.get("objetivos") or [])
    n = len(objetivos)
    pedidos = sorted({int(o) for o in leccion.get("pedidos") or [] if 1 <= int(o) <= n})
    a_cubrir = pedidos or list(range(1, n + 1))
    entrada = describir(leccion)
    if pedidos:
        entrada += f"\n\nEscribe consultas solo para los objetivos {', '.join(map(str, pedidos))}."
    # Cada reintento de estructurar es otra llamada al modelo: se cuentan todas (los fallidos vienen en `fallidos`).
    fallidos: list[Intento] = []
    try:
        sistema = cargar("research_consultas").texto
        c = await estructurar(sistema, entrada, Consultas, reglas=reglas_consultas(a_cubrir), intentos=fallidos)
        llamadas += 1 + len(fallidos)
    except ErrorEstructura as e:
        return {"motivo_fin": f"no se pudieron escribir consultas: {e}", "trayectoria": traza,
                "llamadas": max(1, len(fallidos)), "sin_cubrir": a_cubrir}

    listas: list[list[str]] = []
    for consulta in c.consultas:
        r = await h.buscar_web(consulta.consulta, 8)
        paso = {"accion": "buscar", "objetivo": consulta.objetivo, "consulta": consulta.consulta,
                "resultados": 0 if isinstance(r, str) else len(r)}
        if isinstance(r, str):
            paso["error"] = r
        traza.append(paso)
        if (isinstance(r, str) or not r) and consulta.alternativa.strip():
            r = await h.buscar_web(consulta.alternativa, 8)
            paso = {"accion": "buscar", "objetivo": consulta.objetivo, "consulta": consulta.alternativa,
                    "resultados": 0 if isinstance(r, str) else len(r), "alternativa": True}
            if isinstance(r, str):
                paso["error"] = r
            traza.append(paso)
        if not isinstance(r, str):
            listas.append([x.url for x in r])
    if not listas:
        # Ni una búsqueda respondió (sin red, ddgs bloquea): es un fallo, no «ninguna página legible».
        traza.append({"accion": "sin_cubrir", "objetivos": a_cubrir})
        return {"motivo_fin": "error: la búsqueda web no respondió", "trayectoria": traza, "llamadas": llamadas,
                "sin_cubrir": a_cubrir}

    urls: list[str] = []
    descartadas: set[str] = set()
    for turno in zip_longest(*listas):
        for url in turno:
            if not url or url in urls or url in descartadas:
                continue
            motivo = descartar_url(url)
            if motivo:
                descartadas.add(url)
                traza.append({"accion": "descartar", "url": url, "motivo": motivo})
            else:
                urls.append(url)

    tope = max_urls + 5 if max_intentos is None else max_intentos
    lecturas = []
    intentos = 0
    por_dominio: Counter[str] = Counter()
    for url in urls:
        if len(lecturas) >= max_urls or intentos >= tope:
            break
        if por_dominio[dominio(url)] >= MAX_POR_DOMINIO:
            traza.append({"accion": "descartar", "url": url, "motivo": "ya hay 2 lecturas de ese dominio"})
            continue
        intentos += 1
        por_dominio[dominio(url)] += 1
        lectura = await h.leer_pagina(url)
        traza.append({"accion": "leer", "url": url, "error": lectura.error, "crudo_sha": lectura.crudo_sha,
                      "formato": lectura.formato})
        if lectura.error:
            continue
        if lectura.incompleta:
            antes = len(h.leidas)
            alt = await h.leer_alternativa(lectura)
            intentos += len(h.leidas) - antes  # cada descarga de una alternativa cuenta para el tope de intentos
            usable = alt is not None and not alt.error and not alt.incompleta
            error = None if usable else ((alt.error or alt.incompleta) if alt else "no hay alternativa gratis")
            if error and lectura.doi and not ajustes.unpaywall_email.strip():
                error += f" ({SIN_CORREO})"
            traza.append({"accion": "alternativa", "url": url, "motivo": lectura.incompleta,
                          "alternativa": alt.url if alt else None, "crudo_sha": alt.crudo_sha if alt else None,
                          "error": error})
            if not usable:
                continue
            lectura = alt
        lecturas.append(lectura)
    if not lecturas:
        traza.append({"accion": "sin_cubrir", "objetivos": a_cubrir})
        return {"motivo_fin": "ninguna página legible", "trayectoria": traza, "llamadas": llamadas, "sin_cubrir": a_cubrir}

    entrada = describir(leccion) + "\n\n" + "\n\n".join(delimitar(x) for x in lecturas)
    fallidos = []
    try:
        sistema = cargar("research_juez").texto
        notas = await estructurar(sistema, entrada, Notas, intentos=fallidos)
        llamadas += 1 + len(fallidos)
    except ErrorEstructura as e:
        traza.append({"accion": "sin_cubrir", "objetivos": a_cubrir})
        return {"motivo_fin": f"no se pudieron puntuar: {e}", "trayectoria": traza,
                "llamadas": llamadas + max(1, len(fallidos)), "sin_cubrir": a_cubrir}

    por_url = {x.url: x for x in lecturas}
    vistas: set[str] = set()
    validas: list[Nota] = []
    resumen_notas: list[dict] = []
    for nota in notas.notas:
        if nota.url not in por_url or nota.url in vistas:
            continue  # una URL que no se leyó (la pide una página) no existe para el código
        vistas.add(nota.url)
        nota.objetivos = sorted({o for o in nota.objetivos if 1 <= o <= n})
        ok = vale(nota, por_url[nota.url].extracto, exigir_objetivos=n > 0)
        if not cita_en(nota.cita, por_url[nota.url].extracto):
            traza.append({"accion": "descartada", "url": nota.url, "por": "cita"})
        resumen_notas.append({**ficha_de(nota), "url": nota.url, "valida": ok})
        if ok:
            validas.append(nota)
    traza.append({"accion": "puntuar", "notas": resumen_notas})

    elegidas, sin_cubrir = elegir(validas, n, max_propuestas, MAX_POR_DOMINIO, a_cubrir if n else None)
    for nota in elegidas:
        resultado = await h.proponer_fuente(nota.url, f"{puntuacion(nota)}/9 · {nota.tipo} · {nota.resumen}", ficha_de(nota))
        traza.append({"accion": "proponer", "url": nota.url, "objetivos": nota.objetivos, "resultado": resultado})
    traza.append({"accion": "sin_cubrir", "objetivos": sin_cubrir})
    return {"motivo_fin": _motivo_fin(len(h.propuestas), sin_cubrir, objetivos), "trayectoria": traza,
            "llamadas": llamadas, "sin_cubrir": sin_cubrir}
