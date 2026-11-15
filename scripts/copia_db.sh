#!/usr/bin/env bash
# Copia de la base: scripts/copia_db.sh [--fuera <carpeta> --clave-publica <age1...>]
# Rotación: 7 diarias, 4 semanales (lunes) y 12 mensuales (día 1). Las copias van a copias/ (fuera de git).
# Para programarla en Windows (una vez):
#   schtasks /Create /SC DAILY /ST 13:00 /TN "magister-copia" /TR "\"C:\Program Files\Git\bin\bash.exe\" -lc 'cd ~/repos/magister-studio && scripts/copia_db.sh'"
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p copias/diarias copias/semanales copias/mensuales
fecha=$(date +%F)
destino="copias/diarias/magister-$fecha.dump"
alerta() {
  docker exec magister-studio-db psql -U magister -d magister -c \
    "insert into alertas (nombre, detalle) values ('copia', 'la copia de la base falló el $fecha: $1')" >/dev/null 2>&1 || true
  echo "La copia falló: $1" >&2
  exit 1
}
docker exec magister-studio-db pg_dump -U magister -Fc magister > "$destino" || alerta "pg_dump"
[ -s "$destino" ] || alerta "copia vacía"
[ -f servidor/checkpoints.sqlite ] && python -c "import sqlite3; sqlite3.connect('servidor/checkpoints.sqlite').backup(sqlite3.connect('copias/diarias/checkpoints-$fecha.sqlite'))"
[ "$(date +%u)" = "1" ] && cp "$destino" copias/semanales/
[ "$(date +%d)" = "01" ] && cp "$destino" copias/mensuales/
ls -1t copias/diarias/magister-*.dump | tail -n +8 | xargs -r rm --
ls -1t copias/semanales/*.dump 2>/dev/null | tail -n +5 | xargs -r rm --
ls -1t copias/mensuales/*.dump 2>/dev/null | tail -n +13 | xargs -r rm --
if [ "${1:-}" = "--fuera" ]; then
  carpeta="$2"; clave="${4:-}"
  [ -n "$clave" ] || alerta "falta --clave-publica"
  age -r "$clave" -o "$carpeta/magister-$fecha.dump.age" "$destino" || alerta "age"
fi
echo "Copia hecha: $destino ($(du -h "$destino" | cut -f1))"
