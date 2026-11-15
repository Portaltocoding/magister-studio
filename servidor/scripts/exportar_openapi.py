"""Escribe el esquema OpenAPI de la API en contrato/openapi.json.

Uso, desde servidor/: uv run python scripts/exportar_openapi.py
"""

import json
from pathlib import Path

from magister.api.app import app

DESTINO = Path(__file__).resolve().parents[2] / "contrato" / "openapi.json"


def main() -> None:
    esquema = app.openapi()
    DESTINO.write_text(json.dumps(esquema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Esquema escrito en {DESTINO}")


if __name__ == "__main__":
    main()
