"""Con qué fuentes se estudia cada lección: reglas puras (sin base, sin modelo).

- `estado_apuntes`: si los apuntes se hicieron con las fuentes que hay ahora (encargo 4).
- `necesidad_efectiva`: si hace falta buscar fuentes para una lección, con tu material por delante (ADR-0021).
"""

from typing import Literal

from magister.plan.esquemas import NECESIDADES

EstadoApuntes = Literal["sin_fuentes", "nuevas", "al_dia", "desconocido"]

MINIMO_NUEVAS = 2  # un solo fragmento nuevo no basta para proponer rehacer los apuntes

POR_QUE_ANTIGUO = "Plan de antes de decidirlo por lección: se buscan por si acaso."
POR_QUE_MATERIAL = "Has subido material tuyo de este tema: se usa siempre."


def estado_apuntes(usado: dict | None, apoyo_actual: list[int]) -> EstadoApuntes:
    """`usado` es `materiales.versiones` de los últimos apuntes ({'apoyo': [ids de fragmento], ...}) y `apoyo_actual`, los
    fragmentos que hoy apoyan a la lección.

    - desconocido: apuntes de antes de guardar con qué se hicieron (versiones vacías o sin 'apoyo');
    - sin_fuentes: se hicieron sin ningún fragmento y ahora hay 2 o más;
    - nuevas: hay 2 o más fragmentos que no se usaron;
    - al_dia: lo demás."""
    if not usado or "apoyo" not in usado:
        return "desconocido"
    hechos = set(usado.get("apoyo") or [])
    if not hechos and len(apoyo_actual) >= MINIMO_NUEVAS:
        return "sin_fuentes"
    if len(set(apoyo_actual) - hechos) >= MINIMO_NUEVAS:
        return "nuevas"
    return "al_dia"


def necesidad_efectiva(valor: str | None, por_que: str | None, material_propio: bool) -> tuple[str, str]:
    """(etiqueta, motivo) que se enseña y se usa. Una lección de antes (sin etiqueta o con un valor raro) es «conviene».
    Si tienes material tuyo del tema, nunca se dice «no»: tus apuntes mandan."""
    if valor not in NECESIDADES:
        return "conviene", POR_QUE_ANTIGUO
    if valor == "no" and material_propio:
        return "conviene", POR_QUE_MATERIAL
    return valor, (por_que or "").strip()
