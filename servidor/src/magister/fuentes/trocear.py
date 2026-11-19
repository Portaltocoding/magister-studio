"""El chunker. Invariante: `version.texto[inicio:fin] == fragmento.texto`.

Vault: por párrafos (la nota entera si cabe). Resto: por encabezados y después
recursivo por separadores hasta `tokens`, con `solape`. Todo parámetro sale de la
configuración del índice.
"""

import re
from dataclasses import dataclass

from magister.fuentes.embeber import contar_tokens

SEPARADORES = ["\n\n", "\n", ". ", "; ", ", ", " "]
ENCABEZADO = re.compile(r"^(#{1,6})\s+(.+)$", re.M)


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


def trocear(texto: str, titulo: str, fuente_tipo: str, params: dict) -> list[Trozo]:
    maximo = int(params.get("tokens", 400))
    solape = int(params.get("solape", 50))
    modelo = params.get("modelo")
    contextual = params.get("encabezado_contextual", True)
    trozos: list[Trozo] = []
    if fuente_tipo == "vault" and params.get("vault_por_parrafos", True) and contar_tokens(texto, modelo) <= maximo:
        rangos = [(0, len(texto), [])]
    else:
        rangos = _secciones(texto)
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
