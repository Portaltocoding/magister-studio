#!/usr/bin/env bash
# Restaurar una copia en otra base: scripts/restaurar_db.sh copias/diarias/magister-2026-11-15.dump magister_restaurada
# Nunca sobre magister ni magister_pruebas.
set -euo pipefail
fichero="$1"; base="${2:-magister_restaurada}"
case "$base" in magister|magister_pruebas) echo "No restauro sobre $base: elige otra base (por ejemplo magister_restaurada)." >&2; exit 1;; esac
docker exec magister-studio-db dropdb -U magister --if-exists "$base"
docker exec magister-studio-db createdb -U magister "$base"
docker exec -i magister-studio-db pg_restore -U magister -d "$base" --no-owner < "$fichero"
for t in mensajes lecciones intentos fragmentos; do
  n=$(docker exec magister-studio-db psql -U magister -d "$base" -tAc "select count(*) from $t")
  echo "$t: $n filas"
done
