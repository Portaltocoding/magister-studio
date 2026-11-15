#!/bin/sh
# Entrada del contenedor de la API: el token de claude sale de un secreto, se migra y se arranca.
set -e
if [ -f /run/secrets/claude_token ]; then
  CLAUDE_CODE_OAUTH_TOKEN="$(cat /run/secrets/claude_token)"
  export CLAUDE_CODE_OAUTH_TOKEN
fi
if [ -f /run/secrets/postgres_password ]; then
  CLAVE="$(cat /run/secrets/postgres_password)"
  export MAGISTER_DB_URL="postgresql+asyncpg://magister:${CLAVE}@db:5432/magister"
fi
mkdir -p /datos/crudo /datos/salidas
alembic upgrade head
exec uvicorn magister.api.app:app --host 0.0.0.0 --port 8000
