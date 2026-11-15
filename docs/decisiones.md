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
| II | Conversaciones | Columna `tipo` (`libre`, `plan`, `tutor`): Estudio libre entra al grafo en fase `estudio`; «Nuevo plan» en Roadmap abre una de diagnóstico | Que Estudio libre no empiece con preguntas de diagnóstico |
| II | Plazo | Campo `sin_plazo` en el perfil; sin plazo, el horizonte es de 90 días | Distinguir «no lo ha dicho» de «no tiene fecha» |
| II | Orden de los huecos | tema, objetivo, nivel, horas, plazo | «Quiero aprender IA» pregunta para qué antes que cuántas horas |
| II | Versión de prompt | Hash SHA-256 del fichero (12 caracteres) | Lo pide el libro |
| II | Motor `ollama` | No se monta | No hay Ollama instalado; el contrato de `estructurar` lo admitiría |
| II | Banco de peticiones | 8 casos provisionales en `evals/banco/plan-v1.yaml` | El libro pide que escribas tú los 30; estos son para que el harness funcione |
| II | Mensaje con plan pendiente | Cuenta como «cambiar» con ese texto | Si escribes en vez de pulsar un botón, no se pierde |
| II | Sesiones | Se marcan hecha o saltada desde Roadmap y Calendario (`PATCH /api/sesiones/{id}`) | Para que «Me he atrasado» sepa qué está hecho |
