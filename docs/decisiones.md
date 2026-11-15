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
| III | Estudio libre sin fuentes | Si la mejor similitud es menor que 0,85, dice «No lo encuentro en tus fuentes» y responde con conocimiento general; con fuentes, cita cada afirmación y puede añadir «Fuera de tus fuentes:» | Una herramienta de estudio no puede quedarse muda si aún no has subido nada |
| III | Umbral de «hay fuentes» | 0,85 de similitud densa | Medido: lo ajeno da 0,78 a 0,81 y lo relacionado 0,89 a 0,91 |
| III | MinHash | Escrito a mano (128 funciones, 5-gramas de palabras, 16 bandas de 8) | Sin dependencia nueva |
| III | Versión nueva de un documento | Retira las versiones vivas anteriores (no las borra) | Si no, la búsqueda trae el texto viejo y el nuevo |
| III | Duplicados en la búsqueda | Las versiones marcadas `duplicado_de` no entran en la búsqueda | Que dos copias no ocupen dos huecos del top-k |
| III | OCR y audio | No se montan: los escaneados van a cuarentena | Tesseract y faster-whisper son dependencias del sistema; queda como ampliación |
| III | RAGAS | Juez propio con `claude -p` (`evals/fidelidad.py`): faithfulness por afirmaciones; comprobado con el ejemplo de Einstein (0,5) | RAGAS arrastra langchain y dos trampas de versiones en Windows |
| III | Research por defecto | Flujo fijo; el agente se elige con `"sistema": "agente"` | La regla del libro: el agente solo si gana en pass^3 |
| III | Banco del retriever | Se genera con `python -m evals.banco_rag sintetico` sobre tus fuentes | No hay corpus tuyo todavía |
| III | Tarea de fondo | Un bucle en el `lifespan` procesa recibidas y pendientes cada 2 s y recalcula el apoyo de los planes al acabar cada pasada | La Parte IV la convierte en trabajos con cola |
