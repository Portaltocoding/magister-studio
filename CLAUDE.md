# Qué es

Magister personal. La v0.1 es una conversación con streaming guardada en Postgres.

## Stack

- Servidor en `servidor/`: Python 3.12 con uv, FastAPI, SQLAlchemy 2 asíncrono con asyncpg y Alembic.
- Base de datos: Postgres 16 con pgvector en Docker.
- Frontend en `web/`: React con Vite y TypeScript.
- El modelo es `claude -p`.

## Módulos y dependencias

El paquete `magister` contiene `api`, `cerebro` y `datos`.

- `api` importa de `cerebro` y `datos`.
- `cerebro` y `datos` solo importan de `magister.config`, para leer sus ajustes.
- `cerebro` y `datos` nunca importan de `api` ni el uno del otro.

## Estilo

Nombres de funciones, variables, tablas y columnas en castellano sin tildes. Mensajes al usuario en español de España.

## Reglas

- Nada de llamadas bloqueantes en código `async`.
- Nada de URLs con `localhost` en `web/src`.
- Los ajustes van en variables `MAGISTER_*`; nunca se escriben en el código.
- No añadir dependencias sin decirlo.

## Cómo se prueba

- Servidor: `uv run pytest` en `servidor/`.
- Frontend: `npm run build` en `web/`.
- Motor falso: `MAGISTER_MOTOR=eco`.

`eco` es un motor de pruebas que devuelve texto sin llamar a `claude -p`; el motor real es `claude -p`.
