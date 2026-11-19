"""El esqueleto de los apuntes lo monta el código; el modelo solo escribe contenido."""

import re
from pathlib import Path

CARPETA = Path(__file__).parent / "plantillas"
HUECO = re.compile(r"\{\{(\w+)\}\}")


class HuecoSinRellenar(Exception):
    pass



def _ingles_util(d: dict) -> bool:
    """El término en inglés solo si aporta: nada de «QUIC (QUIC)»."""
    return bool(d.get('ingles')) and d['ingles'].strip().lower() != d['termino'].strip().lower()

def montar(plantilla: str, valores: dict[str, str]) -> str:
    faltan = sorted({m.group(1) for m in HUECO.finditer(plantilla)} - valores.keys())
    if faltan:
        raise HuecoSinRellenar(f"faltan huecos: {', '.join(faltan)}")
    return HUECO.sub(lambda m: str(valores[m.group(1)]), plantilla)


ESTILOS = {"libro": "practica.css", "ficha": "ficha.css"}
# Súbela cuando cambien las plantillas o el montaje de los apuntes: los materiales con una anterior (o sin ella) se
# vuelven a montar al servirlos y su PDF se repinta en la cola, sin llamar al modelo. 2: opciones de las de test,
# la pregunta 10 sin romper la lista, `.nb` en todos los bloques y marcadores en el PDF.
VERSION_MONTAJE = 2


def barajar(lista: list, semilla: str) -> list:
    """La misma baraja que `web/src/barajar.ts` (FNV-1a y Fisher-Yates, en 32 bits): misma semilla, mismo orden, así
    el PDF y la web enseñan las opciones de una pregunta igual, y la buena no sale siempre la primera."""
    m = 0xFFFFFFFF
    h = 2166136261
    for c in semilla:
        h = ((h ^ ord(c)) * 16777619) & m

    def azar() -> float:
        nonlocal h
        h = ((h ^ (h >> 15)) * 2246822507) & m
        h = ((h ^ (h >> 13)) * 3266489909) & m
        h ^= h >> 16
        return h / 4294967296

    copia = list(lista)
    for i in range(len(copia) - 1, 0, -1):
        j = int(azar() * (i + 1))
        copia[i], copia[j] = copia[j], copia[i]
    return copia


LETRAS = "abcdefgh"


def _pregunta(i: int, p: dict) -> str:
    """Una pregunta del repaso como elemento de lista: todo lo de dentro va sangrado al ancho de «10. », no fijo, para
    que el bloque `::: fantasma` siga dentro del elemento (con 3 espacios fijos, la 10 enseñaba el marcado crudo).
    Las tipo test llevan sus opciones barajadas por pregunta; la respuesta dice qué letra es la buena."""
    sangria = " " * len(f"{i}. ")
    partes = [f"{i}. {p['enunciado'].strip()}"]
    fantasma = (p.get("fantasma") or "").strip()
    opciones = [o for o in (p.get("opciones") or []) if (o.get("texto") or "").strip()]
    if opciones:
        orden = barajar(opciones, str(p.get("id", i)))
        # La letra en negrita: «- a) …» suelto, pandoc lo lee como otra lista ordenada y pinta «a.».
        partes.append("\n".join(f"{sangria}- **{LETRAS[k]})** {o['texto'].strip()}" for k, o in enumerate(orden)))
        buena = next((LETRAS[k] for k, o in enumerate(orden) if o.get("buena")), None)
        if buena:
            fantasma = f"**Respuesta: {buena})**. {fantasma}" if fantasma else f"**Respuesta: {buena})**"
    lineas = fantasma.splitlines() or [""]
    partes.append("\n".join([f"{sangria}::: fantasma", *(f"{sangria}{x}" if x.strip() else "" for x in lineas), f"{sangria}:::"]))
    return "\n\n".join(partes) + "\n"


def _repaso(repaso: list[dict]) -> str:
    return "\n".join(_pregunta(i, p) for i, p in enumerate(repaso, start=1)) or "_Las preguntas de repaso se generan con el material._"


def _montar_ficha(titulo: str, pie: str, salida: str, definiciones: list[dict], bloques: list[tuple[str, str]],
                  repaso: list[dict]) -> str:
    defs = "\n".join(
        f"- **{d['termino']}**{f' ({d['ingles']})' if _ingles_util(d) else ''}: {d['definicion'].rstrip('.')}." for d in definiciones
    )
    cuerpo = "\n\n".join(f"## {t} {{.nb}}\n\n{texto.strip()}" for t, texto in bloques)
    plantilla = (CARPETA / "apuntes_ficha.md").read_text(encoding="utf-8")
    return montar(plantilla, {"titulo": titulo, "pie": pie, "salida": salida, "definiciones": defs or "-",
                              "bloques": cuerpo, "repaso": _repaso(repaso)})


def _etq(texto: str) -> str:
    return texto.replace('"', "'").replace("{", "(").replace("}", ")")


def montar_apuntes(titulo: str, pie: str, salida: str, definiciones: list[dict], bloques: list[tuple[str, str]],
                   repaso: list[dict], clave: str = "", objetivos: list[str] | None = None, tema: str = "",
                   estilo: str = "libro") -> str:
    """Los apuntes con la maqueta del libro (practica.css): portada negra, definiciones en rejilla,
    cada bloque como página de teoría (amarilla) y el repaso como práctica (verde)."""
    objetivos = objetivos or []
    if estilo == "ficha":
        return _montar_ficha(titulo, pie, salida, definiciones, bloques, repaso)
    defs = "\n".join(
        f"::: marco\n**{d['termino']}**{f' · *{d['ingles']}*' if _ingles_util(d) else ''}\n\n{d['definicion'].rstrip('.')}.\n:::"
        for d in definiciones
    )
    total = len(bloques)
    # Ningún bloque abre página: el primero sigue a las definiciones donde acaben (si abría página y la rejilla se
    # pasaba por una tarjeta, quedaba una página con esa tarjeta sola: el aviso «casi vacía» del motor).
    cuerpo = "\n\n".join(
        f"::: teoria\n## {t} {{.nb etq=\"{_etq(f'Teoría · {i} de {total}')}\"}}\n\n{texto.strip()}\n:::"
        for i, (t, texto) in enumerate(bloques, start=1)
    )
    preguntas = _repaso(repaso)
    palabras = sum(len(texto.split()) for _, texto in bloques)
    entrada = (f"Lección {clave} de **{tema}**. " if clave and tema else "") + (
        f"{total} bloques, unos {max(5, round(palabras / 180))} minutos de lectura, y {len(repaso)} preguntas para repasar sin mirar."
    )
    numero = "".join(ch for ch in clave if ch.isdigit()) or clave or "·"
    plantilla = (CARPETA / "apuntes.md").read_text(encoding="utf-8")
    return montar(plantilla, {"titulo": titulo, "pie": pie, "salida": salida, "definiciones": defs or "::: marco\n-\n:::",
                              "bloques": cuerpo, "repaso": preguntas, "entrada": entrada,
                              "salir": "; ".join(o.rstrip(".") for o in objetivos) or titulo, "num": numero})
