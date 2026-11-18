"""El registro de cada llamada: lo que pasó y cuándo (interrupciones, ecos descartados, rellenos, tiempos de cada
turno), para ver dónde se puso rara sin tener que adivinarlo. Un fichero JSON por llamada en MAGISTER_REGISTROS.

Solo guarda lo que manda la pantalla de la llamada; los textos van recortados.
"""

import asyncio
import json
import re
from datetime import datetime
from pathlib import Path

from magister.config import ajustes


def carpeta() -> Path:
    return Path(ajustes.registros) / "llamadas"


def _nombre(cid: int | None, tipo: str, momento: datetime) -> str:
    seguro = re.sub(r"[^a-z]", "", tipo.lower())[:12] or "llamada"
    return f"{momento:%Y-%m-%d_%H%M%S}_{seguro}_{cid if cid is not None else 'sin'}.json"


async def guardar(registro: dict, momento: datetime) -> Path:
    destino = carpeta() / _nombre(registro.get("conversacion_id"), str(registro.get("tipo", "")), momento)
    texto = json.dumps({**registro, "guardado_en": momento.isoformat(timespec="seconds")}, ensure_ascii=False, indent=1)

    def escribir() -> None:
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(texto, encoding="utf-8")

    await asyncio.to_thread(escribir)
    return destino


async def ultimos(n: int = 20) -> list[dict]:
    def leer() -> list[dict]:
        if not carpeta().is_dir():
            return []
        ficheros = sorted(carpeta().glob("*.json"), reverse=True)[:n]
        salida = []
        for f in ficheros:
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            salida.append({"fichero": f.name, "tipo": d.get("tipo"), "leccion": d.get("leccion"), "segundos": d.get("segundos"),
                           "eventos": len(d.get("eventos", [])), "resumen": d.get("resumen")})
        return salida

    return await asyncio.to_thread(leer)
