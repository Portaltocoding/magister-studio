#!/bin/sh
# Entrada del contenedor de la API: el token de claude sale de un secreto, se migra y se arranca.
set -e
if [ -f /run/secrets/claude_token ]; then
  CLAUDE_CODE_OAUTH_TOKEN="$(tr -d ' \r\n' < /run/secrets/claude_token)"
  export CLAUDE_CODE_OAUTH_TOKEN
fi
if [ -f /run/secrets/postgres_password ]; then
  CLAVE="$(tr -d '\r\n' < /run/secrets/postgres_password)"
  export MAGISTER_DB_URL="postgresql+asyncpg://magister:${CLAVE}@db:5432/magister"
  # Para pg_dump, pg_restore y psql de las copias (MAGISTER_CONTENEDOR_DB vacío: se lanzan aquí mismo).
  export PGHOST=db PGPORT=5432 PGPASSWORD="$CLAVE"
fi
mkdir -p /datos/crudo /datos/salidas /datos/registros
alembic upgrade head
# Si una migración ha cambiado cómo se trocean las fuentes, lo ya guardado se reindexa antes de abrir la API.
magister indexar --al-arrancar
exec uvicorn magister.api.app:app --host 0.0.0.0 --port 8000
