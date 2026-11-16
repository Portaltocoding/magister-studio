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


def _repaso(repaso: list[dict]) -> str:
    return "\n".join(
        f"{i}. {p['enunciado']}\n\n   ::: fantasma\n   {p['fantasma']}\n   :::\n" for i, p in enumerate(repaso, start=1)
    ) or "_Las preguntas de repaso se generan con el material._"


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
    cuerpo = "\n\n".join(
        f"::: teoria\n## {t} {{{'' if i == 1 else '.nb '}etq=\"{_etq(f'Teoría · {i} de {total}')}\"}}\n\n{texto.strip()}\n:::"
        for i, (t, texto) in enumerate(bloques, start=1)
    )
    preguntas = "\n".join(
        f"{i}. {p['enunciado']}\n\n   ::: fantasma\n   {p['fantasma']}\n   :::\n" for i, p in enumerate(repaso, start=1)
    ) or "_Las preguntas de repaso se generan con el material._"
    palabras = sum(len(texto.split()) for _, texto in bloques)
    entrada = (f"Lección {clave} de **{tema}**. " if clave and tema else "") + (
        f"{total} bloques, unos {max(5, round(palabras / 180))} minutos de lectura, y {len(repaso)} preguntas para repasar sin mirar."
    )
    numero = "".join(ch for ch in clave if ch.isdigit()) or clave or "·"
    plantilla = (CARPETA / "apuntes.md").read_text(encoding="utf-8")
    return montar(plantilla, {"titulo": titulo, "pie": pie, "salida": salida, "definiciones": defs or "::: marco\n-\n:::",
                              "bloques": cuerpo, "repaso": preguntas, "entrada": entrada,
                              "salir": "; ".join(o.rstrip(".") for o in objetivos) or titulo, "num": numero})
