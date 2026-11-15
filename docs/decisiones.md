# Decisiones tomadas al construir Magister Studio

Este repo es la herramienta construida siguiendo el libro de punta a punta, para usarla mientras lo lees. Las cajas «Decide tú» del libro se resolvieron así (casi siempre con la propuesta del propio libro). Compáralas con las tuyas cuando construyas tu `magister`.

| Parte | Decisión | Elegido | Por qué |
|---|---|---|---|
| I | Puertos | Postgres en 5433, API en 8000, web en 5173 | Para no chocar con el Postgres de `magister` |
| I | Proxy | Vite en desarrollo (con el token de `servidor/.env`); Caddy y Electron siguen disponibles | Arrancar con lo mínimo |
| I | Ids y borrado | `bigint` y `CASCADE` | Un solo usuario |
| I | Clase SSE | `fastapi.sse.EventSourceResponse` | Ya la usaba el andamiaje |
| I | Prompts | Ficheros versionados `cerebro/prompts/<nombre>.vN.md` desde la v0.1 | La Parte II los pide así; se adelanta |
| I | Base de pruebas | Creada ya en la v0.1 (`MAGISTER_DB_URL_PRUEBAS`) | Los tests de mensajes necesitan base |
| I | Markdown en el hilo | `react-markdown` y `remark-gfm` (dependencias nuevas) | Las respuestas del tutor vienen en Markdown |
| I | «Esto no cuenta para el tutor» | Casilla en Estudio libre que guarda `cuenta = false` | `docs/tutor.md`, sección 2 |
| I | `POST /api/chat` | No se monta: se va directo a `/api/conversaciones/{id}/mensajes` | El libro la quita en el capítulo 5 |
