"""El chunker. Invariante: `version.texto[inicio:fin] == fragmento.texto`.

Vault: por párrafos (la nota entera si cabe; con `vault_por_secciones`, v4, por encabezados aunque quepa). Con
`seccion_minima`, las secciones más cortas se juntan con la vecina (ADR-0018). Resto: por encabezados y después
recursivo por separadores hasta `tokens`, con `solape`. Todo parámetro sale de la
configuración del índice.
"""

import re
import unicodedata
from dataclasses import dataclass

from magister.fuentes.embeber import contar_tokens

SEPARADORES = ["\n\n", "\n", ". ", "; ", ", ", " "]
ENCABEZADO = re.compile(r"^(#{1,6})\s+(.+)$", re.M)

# Secciones que no son contenido (bibliografía, notas, cómo citar, avisos del editor), ya normalizadas. En los textos
# web reales eran el 39 % de los trozos y salían las primeras (ADR-0018). Lista cerrada: la configuración del índice
# guarda la suya en `secciones_fuera`, así una configuración siempre trocea igual aunque esta lista cambie.
SECCIONES_FUERA = [
    # inglés
    "references", "reference list", "bibliography", "select bibliography", "notes", "footnotes", "endnotes",
    "notes and references", "references and notes", "works cited", "literature cited", "further reading",
    "external links", "see also", "related entries", "cite this article", "cite this chapter",
    "how to cite this entry", "download citation", "copyright information", "rights and permissions",
    "academic tools", "other internet resources", "about this article", "about this chapter", "publishers note",
    "additional information", "editor information", "editors and affiliations", "authors and affiliations",
    "author information", "similar content being viewed by others", "acknowledgements", "acknowledgments",
    # español
    "referencias", "referencias bibliograficas", "bibliografia", "bibliografia seleccionada", "notas",
    "notas al pie", "notas y referencias", "obras citadas", "lecturas recomendadas", "lecturas adicionales",
    "otras lecturas", "enlaces externos", "vease tambien", "como citar", "como citar este articulo",
    "citar este articulo", "agradecimientos",
]
_NUMERACION = re.compile(r"^(?:\d+(?:\.\d+)*\.?|[ivxlc]+[.)]|[a-z][.)])\s+")


def normalizar_encabezado(t: str) -> str:
    """«2.1 Bibliografía:» → «bibliografia»: sin tildes, sin mayúsculas, sin numeración delante ni signos."""
    t = "".join(c for c in unicodedata.normalize("NFKD", t.lower()) if not unicodedata.combining(c))
    t = re.sub(r"['’`]", "", t)
    t = re.sub(r"[^\w\s.)]", " ", t).strip()
    t = _NUMERACION.sub("", t)
    return " ".join(re.sub(r"[^\w\s]", " ", t).split())


@dataclass
class Trozo:
    orden: int
    inicio: int
    fin: int
    texto: str
    texto_indexado: str


def _secciones(texto: str) -> list[tuple[int, int, list[str]]]:
    """(inicio, fin, ruta de encabezados) de cada sección Markdown."""
    marcas = list(ENCABEZADO.finditer(texto))
    if not marcas:
        return [(0, len(texto), [])]
    salida: list[tuple[int, int, list[str]]] = []
    ruta: list[tuple[int, str]] = []
    if marcas[0].start() > 0:
        salida.append((0, marcas[0].start(), []))
    for i, m in enumerate(marcas):
        nivel = len(m.group(1))
        ruta = [r for r in ruta if r[0] < nivel] + [(nivel, m.group(2).strip())]
        fin = marcas[i + 1].start() if i + 1 < len(marcas) else len(texto)
        salida.append((m.start(), fin, [r[1] for r in ruta]))
    return salida


def _partir(texto: str, ini: int, fin: int, maximo: int, solape: int, modelo: str | None) -> list[tuple[int, int]]:
    """Corta [ini, fin) en tramos de como mucho `maximo` tokens, por el separador más grueso posible."""
    if contar_tokens(texto[ini:fin], modelo) <= maximo:
        return [(ini, fin)]
    for sep in SEPARADORES:
        # Un corte al final del tramo no parte nada: dejaría el mismo tramo y la recursión no acabaría.
        cortes = [m.end() for m in re.finditer(re.escape(sep), texto[ini:fin]) if m.end() < fin - ini]
        if not cortes:
            continue
        piezas: list[tuple[int, int]] = []
        a = ini
        for c in cortes + [fin - ini]:
            piezas.append((a, ini + c))
            a = ini + c
        piezas = [(x, y) for x, y in piezas if y > x]
        # Juntar piezas hasta el máximo
        tramos: list[tuple[int, int]] = []
        actual_ini, actual_fin = piezas[0]
        for x, y in piezas[1:]:
            if contar_tokens(texto[actual_ini:y], modelo) <= maximo:
                actual_fin = y
            else:
                tramos.append((actual_ini, actual_fin))
                actual_ini, actual_fin = x, y
        tramos.append((actual_ini, actual_fin))
        salida: list[tuple[int, int]] = []
        for x, y in tramos:
            salida += _partir(texto, x, y, maximo, solape, modelo) if contar_tokens(texto[x:y], modelo) > maximo else [(x, y)]
        return _con_solape(texto, salida, solape, modelo)
    return [(ini, fin)]


def _con_solape(texto: str, tramos: list[tuple[int, int]], solape: int, modelo: str | None) -> list[tuple[int, int]]:
    if solape <= 0 or len(tramos) < 2:
        return tramos
    salida = [tramos[0]]
    for (x, y), (px, py) in zip(tramos[1:], tramos[:-1], strict=True):
        # Retroceder hasta un límite de palabra dentro del tramo anterior, unos `solape` tokens.
        nuevo = x
        palabras = [m.start() for m in re.finditer(r"\S+", texto[px:py])]
        for p in reversed(palabras):
            if contar_tokens(texto[px + p : x], modelo) > solape:
                break
            nuevo = px + p
        salida.append((nuevo, y))
    return salida


def _recortar(texto: str, a: int, b: int) -> tuple[int, int]:
    while a < b and texto[a].isspace():
        a += 1
    while b > a and texto[b - 1].isspace():
        b -= 1
    return a, b


def _juntar_cortas(
    texto: str, rangos: list[tuple[int, int, list[str]]], minimo: int, maximo: int, modelo: str | None
) -> list[tuple[int, int, list[str]]]:
    """Una sección de menos de `minimo` tokens (un encabezado solo, dos líneas) se junta con la siguiente y, si no
    hay siguiente o no cabe, con la anterior; nunca por encima de `maximo` ni a través de un hueco (una sección
    quitada). El rango sigue siendo un tramo del texto; la ruta es la de la sección más larga del grupo."""

    def tokens(a: int, b: int) -> int:
        return contar_tokens(texto[a:b], modelo)

    grupos: list[list[tuple[int, int, list[str]]]] = []
    for r in rangos:
        if grupos:
            a, b = grupos[-1][0][0], grupos[-1][-1][1]
            if b == r[0] and tokens(a, b) < minimo and tokens(a, r[1]) <= maximo:
                grupos[-1].append(r)
                continue
        grupos.append([r])
    salida: list[list[tuple[int, int, list[str]]]] = []
    for g in grupos:
        if salida and salida[-1][-1][1] == g[0][0] and tokens(g[0][0], g[-1][1]) < minimo \
                and tokens(salida[-1][0][0], g[-1][1]) <= maximo:
            salida[-1] += g
        else:
            salida.append(g)
    return [(g[0][0], g[-1][1], max(g, key=lambda r: r[1] - r[0])[2]) for g in salida]


def trocear(texto: str, titulo: str, fuente_tipo: str, params: dict) -> list[Trozo]:
    maximo = int(params.get("tokens", 400))
    modelo = params.get("modelo")
    # `vault_por_secciones` (v4): una nota que cabe también se trocea por encabezados; sin él (v1, v3), entera.
    if (fuente_tipo == "vault" and params.get("vault_por_parrafos", True) and not params.get("vault_por_secciones")
            and contar_tokens(texto, modelo) <= maximo):
        rangos = [(0, len(texto), [])]
    else:
        rangos = _secciones(texto)
    # Tus notas del vault no se filtran: un «## Notas» tuyo es contenido.
    fuera = {normalizar_encabezado(x) for x in params.get("secciones_fuera") or []} if fuente_tipo != "vault" else set()
    # Fuera si cualquier encabezado de la ruta lo está: «References > Citations» también es bibliografía.
    utiles = [r for r in rangos if not any(normalizar_encabezado(h) in fuera for h in r[2])]
    filtrado = len(utiles) < len(rangos)
    minimo = int(params.get("seccion_minima", 0))
    if minimo:
        utiles = _juntar_cortas(texto, utiles, minimo, maximo, modelo)
    trozos = _trocear_rangos(texto, titulo, fuente_tipo, params, utiles)
    if not trozos and filtrado:
        # Un documento que solo tiene secciones de esas no se queda sin fragmentos.
        todos = _juntar_cortas(texto, rangos, minimo, maximo, modelo) if minimo else rangos
        trozos = _trocear_rangos(texto, titulo, fuente_tipo, params, todos)
    return trozos


def _trocear_rangos(texto: str, titulo: str, fuente_tipo: str, params: dict, rangos: list[tuple[int, int, list[str]]]) -> list[Trozo]:
    maximo = int(params.get("tokens", 400))
    solape = int(params.get("solape", 50))
    modelo = params.get("modelo")
    contextual = params.get("encabezado_contextual", True)
    trozos: list[Trozo] = []
    for ini, fin, ruta in rangos:
        if fuente_tipo == "vault" and params.get("vault_por_parrafos", True) and contar_tokens(texto[ini:fin], modelo) > maximo:
            tramos = []
            for p in re.finditer(r"[^\n](?:.|\n(?!\n))*", texto[ini:fin]):
                tramos += _partir(texto, ini + p.start(), ini + p.end(), maximo, 0, modelo)
        else:
            tramos = _partir(texto, ini, fin, maximo, solape, modelo)
        for a, b in tramos:
            a, b = _recortar(texto, a, b)
            if b - a < 2:
                continue
            cabecera = " > ".join([titulo] + ruta) if contextual else ""
            pieza = texto[a:b]
            trozos.append(Trozo(len(trozos), a, b, pieza, f"{cabecera}\n{pieza}" if cabecera else pieza))
    return trozos
