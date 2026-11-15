"""El esqueleto de los apuntes lo monta el código; el modelo solo escribe contenido."""

import re
from pathlib import Path

CARPETA = Path(__file__).parent / "plantillas"
HUECO = re.compile(r"\{\{(\w+)\}\}")


class HuecoSinRellenar(Exception):
    pass


def montar(plantilla: str, valores: dict[str, str]) -> str:
    faltan = sorted({m.group(1) for m in HUECO.finditer(plantilla)} - valores.keys())
    if faltan:
        raise HuecoSinRellenar(f"faltan huecos: {', '.join(faltan)}")
    return HUECO.sub(lambda m: str(valores[m.group(1)]), plantilla)


def montar_apuntes(titulo: str, pie: str, salida: str, definiciones: list[dict], bloques: list[tuple[str, str]],
                   repaso: list[dict]) -> str:
    defs = " ".join(
        f"**{d['termino']}**{f' ({d['ingles']})' if d.get('ingles') else ''}: {d['definicion'].rstrip('.')}." for d in definiciones
    )
    cuerpo = "\n\n".join(f"## {t} {{.nb}}\n\n{texto.strip()}" for t, texto in bloques)
    preguntas = "\n".join(
        f"{i}. {p['enunciado']}\n\n   ::: fantasma\n   {p['fantasma']}\n   :::\n" for i, p in enumerate(repaso, start=1)
    ) or "_Las preguntas de repaso se generan con el material._"
    plantilla = (CARPETA / "apuntes.md").read_text(encoding="utf-8")
    return montar(plantilla, {"titulo": titulo, "pie": pie, "salida": salida, "definiciones": defs or "-",
                              "bloques": cuerpo, "repaso": preguntas})
