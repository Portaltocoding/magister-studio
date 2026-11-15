"""La parte determinista de la completitud: qué conceptos se nombran, dónde y en qué orden."""

import re
import unicodedata


def _norm(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if not unicodedata.combining(c))


def primera_mencion(texto: str, nombres: list[str]) -> int | None:
    """Posición de la primera aparición de cualquiera de los nombres, sin mayúsculas ni tildes."""
    t = _norm(texto)
    posiciones = []
    for n in nombres:
        n = _norm(n).strip()
        if not n:
            continue
        m = re.search(rf"(?<!\w){re.escape(n)}(?!\w)", t)
        if m:
            posiciones.append(m.start())
    return min(posiciones) if posiciones else None


def nombrados(texto: str, conceptos: list[dict]) -> dict[str, int | None]:
    return {c["id"]: primera_mencion(texto, [c["nombre"], *c.get("sinonimos", [])]) for c in conceptos}


def orden_ok(posiciones: dict[str, int | None], conceptos: list[dict], previos: set[str]) -> dict[str, bool]:
    """Un concepto está en orden si cada dependencia suya (de esta lección) aparece antes."""
    salida = {}
    for c in conceptos:
        p = posiciones.get(c["id"])
        bien = True
        for d in c.get("depende_de", []):
            if d in previos:
                continue
            pd = posiciones.get(d)
            if p is not None and (pd is None or pd > p):
                bien = False
        salida[c["id"]] = bien
    return salida


def tasas(informe: dict[str, dict], conceptos: list[dict]) -> dict[str, float]:
    nucleo = [c["id"] for c in conceptos if c.get("nucleo", True)]
    extension = [c["id"] for c in conceptos if not c.get("nucleo", True)]

    def tasa(ids: list[str]) -> float:
        return sum(1 for i in ids if informe[i]["nombrado"] and informe[i]["explicado"]) / len(ids) if ids else 1.0

    return {"nucleo": round(tasa(nucleo), 3), "extension": round(tasa(extension), 3)}
