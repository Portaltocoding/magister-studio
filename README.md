# Magister Studio

Tu tutor personal: conversas con él, te hace un plan y un calendario, estudia tus fuentes, te prepara apuntes, fichas y preguntas, te corrige y te programa el repaso. Está construido siguiendo el libro de `magister`, para usarlo mientras lo lees.

## Cómo se arranca

Docker Desktop abierto. Tres terminales, en este orden:

| Terminal | Orden | Puerto | Listo cuando |
|---|---|---|---|
| 1 | `docker compose up -d` (en la raíz) | 5433 | `docker compose ps` dice `healthy` |
| 2 | `cd servidor && uv run alembic upgrade head && uv run uvicorn magister.api.app:app --port 8000` (sin `--reload`) | 8000 | `Uvicorn running on http://127.0.0.1:8000` |
| 3 | `cd web && npm install && npm run dev` | 5173 | `Local: http://localhost:5173/` |

Abre `http://localhost:5173`.

La primera vez, copia `servidor/.env.example` a `servidor/.env`. Todo tiene valor por defecto; el `.env` solo cambia lo que difiere en tu máquina.

## Órdenes útiles

| Para | Orden |
|---|---|
| Añadir una dependencia | `uv add paquete` (en `servidor/`) |
| Nueva migración | `uv run alembic revision --autogenerate -m "..."` y revisarla |
| Aplicar migraciones (las tres bases) | `uv run alembic upgrade head`, `-x db=pruebas`, `-x db=sim` |
| Entrar en la base | `docker exec -it magister-studio-db psql -U magister -d magister` |
| Pruebas | `uv run pytest -q` (en `servidor/`; usan el motor `eco` y la base de pruebas) |
| Probar el cerebro suelto | `PYTHONUTF8=1 uv run python scripts/probar_cerebro.py "pregunta"` |
| Línea base de latencia | `docker exec -i magister-studio-db psql -U magister -d magister < servidor/scripts/linea_base.sql` |
| Parar la base (conserva datos) | `docker compose down` |
| ⚠ Borrar la base (pierde datos) | `docker compose down -v` |

## Mapa de carpetas

| Carpeta o fichero | Qué contiene |
|---|---|
| `servidor/src/magister/` | El paquete: `api` (HTTP), `cerebro` (el modelo y los prompts), `datos` (Postgres) y `config.py` |
| `servidor/tests/` | Las pruebas automáticas |
| `servidor/migraciones/` | El esquema de Postgres, un fichero por cambio |
| `web/src/` | La página (React con Vite y TypeScript) |
| `escritorio/` | La ventana de Electron que sirve `web/dist` y arranca la API |
| `proxy/` | Caddy, la variante de proxy con un solo puerto |
| `contrato/` | El esquema de la API y las pruebas de contrato |
| `docs/` | ADR, criterios y las decisiones tomadas al construir |
| `compose.yaml` | Postgres 16 con pgvector en Docker |
