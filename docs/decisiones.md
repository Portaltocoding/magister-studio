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
| III | Fuentes en otro idioma (ADR-0018) | Configuración `v3` sin bibliografía ni notas, activa por defecto desde la migración `fec91372e16c` (`magister indexar --activar v3` sigue valiendo); el reranker como segunda puerta de «hay fuentes» cuando el coseno no llega (umbral 1,5); citas por similitud de e5 (0,85) si no comparten palabras | Preguntas en español contra textos en inglés: el coseno se quedaba en 0,78-0,85 y todo salía «sin fuentes»; el 45 % de los trozos era bibliografía |
| III | Lo del research entra solo (ADR-0019, corrige a ADR-0008) | Con `MAGISTER_RESEARCH_INCORPORAR=true` las propuestas entran por el trabajo «incorporar», marcadas como web no confiable y con su origen a la vista; con `false`, se aprueban a mano | 96 propuestas pendientes que nadie aprobaba |
| III | Research por objetivos (ADR-0020) | Una consulta por objetivo, filtros gratis, lee PDF (`MAGISTER_RESEARCH_PDF`), un juez con rúbrica que conoce al alumno y cuya cita se comprueba, elegir por cobertura (2 por dominio), los pedazos tras un muro se marcan (`metadatos.incompleta`) y lo que el plan marca `necesita_fuentes = no` no se busca; el agente queda para evals | Unas 17 de 96 propuestas eran malas, consultas que juntaban objetivos y un artículo que entró solo con el resumen |
| III | Cuándo buscar fuentes (ADR-0021) | El plan marca cada lección `necesita_fuentes` (no, conviene o imprescindible) en la misma llamada, tu material manda y lo cambias en Roadmap; lo que empieza en 7 días se investiga solo (`MAGISTER_RESEARCH_AUTO`, 2 por vuelta) y los apuntes automáticos esperan a sus fuentes hasta 20 min y guardan con cuáles se hicieron | «Para aprender a dividir no hace falta una research»; Topografía se aceptó sin buscar y nunca se buscó |
| IV | Reglas de tono y rúbrica | Las de la tabla de la Parte IV, en `docs/tono.md`; la rúbrica con anclas escritas por mí como provisionales | El libro pide las tuyas: cámbialas y recalibra |
| IV | Plantilla de apuntes | Un hueco `{{bloques}}` que monta el código, en vez de seis huecos fijos | Una lección puede tener de 2 a 6 bloques |
| IV | Lógica de completitud | En `magister/material/completitud_logica.py` (y `evals/completitud/logica.py` la reexporta) | El trabajador no puede importar de `evals/` |
| IV | Trabajador | Dentro de la API por defecto; `magister-trabajador` sigue existiendo | Un proceso menos para usarlo cada día |
| IV | Similitud de preguntas | Solapamiento de palabras, no coseno de embeddings | Sin cargar el modelo en la auditoría; el umbral se ajusta con `evals.duplicados.umbral` |
| IV | Vídeo | Solo el guion; ni Piper ni el montaje con HyperFrames | El libro lo deja como ampliación |
| IV | Etiquetar | Modo propio en la barra lateral («Etiquetar tono») | Hace falta para calibrar el juez |
| IV | Juez de tono | Sin calibrar todavía | Necesita tus etiquetas |
| V | Programador por defecto | FSRS (ADR-0013) | Gana a Leitner con margen sin entrenar; el modelo propio espera a tus datos |
| V | `p_predicha` | Tabla `servidas` con la apuesta al servir; el intento la copia | El contrato pide escribirla al servir y `intentos` es inmutable |
| V | Conceptos en la cola | Los que tienen preguntas activas (material generado); hasta 10 nuevos al día | Sin material no hay qué preguntar |
| V | Predicciones del walk-forward | CSV en vez de parquet | Sin dependencia nueva (pyarrow) |
| V | Experimento de programadores | Columna `brazo` creada y respetada al programar, pero sin asignación automática ni sondas | El ADR del experimento lo escribes tú antes de lanzarlo |
| V | Modo Tutor | Tarjeta «Hoy» y sesión idea a idea con comprobación por bloque, saltar y marcar, y cierre | Está en `docs/tutor.md` y en el plan maestro, aún no como práctica del libro |
| V | Reajuste | La carga de repasos se reserva como media por día de la semana | `calendarizar` trabaja con disponibilidad semanal |
| VI | Langfuse | Opcional; todo se guarda en `llamadas` y `puntuaciones` (ADR-0014) | Sin tres servicios más para una persona |
| VI | Enrutador | `config/modelos.yaml`: Haiku para extraer, reescribir y los jueces; `MAGISTER_MODELO` para lo demás | Ahorra cuota donde la calidad no se resiente |
| VI | Ollama y Gemini | No se montan los motores (el enrutador y la guarda de datos personales sí) | Ni Ollama instalado ni clave de Gemini; `afinar/ollama.py` deja listos los experimentos |
| VI | Juez online | Solo tono (fidelidad pendiente) sobre el 50 % de las explicaciones | La fidelidad necesita los fragmentos de cada traza guardados aparte |
| VI | Inicio de sesión | No se monta (argon2 y cookie) | Instalación de una persona en 127.0.0.1 |
| VI | La API sirve la web | `web/dist` en `http://localhost:8000` | Un solo proceso para el uso diario |
| VI | PDF en Docker | Pendiente: el motor lanza el Chrome de Windows | ADR-0016 |
| VI | Garak, Playwright y el incidente provocado | Pendientes | Herramientas externas; el libro las deja como ampliación o práctica tuya |
| VI | Design doc | Borrador en `docs/design-doc.md` | El libro pide que lo escribas tú |
| VI | Pares de preferencia para afinar | Pendientes | El generador solo guarda la versión aceptada de cada bloque |
| v1.1 | Calendario | Mes completo con tus eventos (deber, examen, clase, nota) delante y el plan y los repasos detrás con poca opacidad; tabla `eventos` | Pedido tuyo después de la v1.0 |
