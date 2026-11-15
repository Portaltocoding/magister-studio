# Qué es

Magister Studio: el tutor personal construido siguiendo el libro de `magister` (Partes I a VI), para usarlo mientras se lee. Las decisiones tomadas están en `docs/decisiones.md`.

## Stack

- Servidor en `servidor/`: Python 3.12 con uv, FastAPI, SQLAlchemy 2 asíncrono con asyncpg y Alembic.
- Base de datos: Postgres 16 con pgvector en Docker.
- Frontend en `web/`: React con Vite y TypeScript.
- El modelo es `claude -p`.

## Módulos y dependencias

El paquete `magister` contiene `api`, `flujo`, `cerebro`, `plan` y `datos`.

- `api` importa de `flujo` y `datos` (ADR-0005).
- `flujo` (el grafo de LangGraph) importa de `cerebro`, `plan` y `datos`.
- `cerebro` y `datos` solo importan de `magister.config`, para leer sus ajustes.
- `plan` es código puro: no importa de `datos`, `cerebro` ni `config`.
- `cerebro` y `datos` nunca importan de `api` ni el uno del otro.
- Las evals viven en `servidor/evals/` y se lanzan con `uv run python -m evals.<modulo>`.

## Fuentes y RAG

1. Lo que viaja entre piezas son ids, rangos y puntuaciones; el texto se trae al final por id.
2. Todo fragmento lleva `version_id`, `inicio` y `fin`, y se cumple `version.texto[inicio:fin] == fragmento.texto`.
3. Mismo modelo, prefijos y configuración al indexar y al consultar; la configuración tiene id y no se edita.
4. Todo `open` con `encoding="utf-8"`.
5. Las pruebas no usan red: búsquedas web y páginas, con mocks.
6. Todo texto que venga de la web es no confiable: se delimita y nunca da órdenes.
7. `cerebro` y `flujo` no importan de `fuentes` ni de `research`: reciben el `Buscador` inyectado. `api` importa de `flujo`, `datos`, `fuentes` y `research`, y es quien construye el buscador.

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
