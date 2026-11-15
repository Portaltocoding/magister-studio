# Magister Studio

Tu tutor personal, construido siguiendo el libro de `magister` de punta a punta (Partes I a VI, v0.1 a v1.0), para usarlo mientras lo lees.

Hablas con él de lo que quieres aprender y te propone un plan y un calendario en tus horas. Estudia tus fuentes (PDF, apuntes, tu vault de Obsidian, páginas web) y responde citándolas. Te prepara apuntes en PDF, fichas de repaso, diapositivas y un guion de vídeo con un tono cuidado. Te pregunta, te corrige explicando el fallo, te programa el repaso espaciado y te enseña tu progreso.

> Las cajas «Decide tú» del libro están resueltas aquí, casi siempre con la propuesta del propio libro, y apuntadas en [`docs/decisiones.md`](docs/decisiones.md). Si no quieres destripar un capítulo, no mires su código antes de construir el tuyo.

## Arrancar (Windows)

Necesitas Docker Desktop, [uv](https://docs.astral.sh/uv/), Node 22 y el CLI de Claude Code con tu sesión iniciada (el tutor usa `claude -p` con tu suscripción).

```powershell
.\arrancar.ps1
```

Levanta la base, aplica las migraciones, construye la página la primera vez y abre **http://localhost:8000**. La primera vez que subas un documento se descargan los modelos locales de embeddings y de reordenación (unos 600 MB).

Para desarrollar con recarga en caliente, tres terminales:

| Terminal | Orden | Puerto |
|---|---|---|
| 1 | `docker compose up -d` (en la raíz) | 5433 |
| 2 | `cd servidor && uv run alembic upgrade head && uv run uvicorn magister.api.app:app --port 8000` (sin `--reload`) | 8000 |
| 3 | `cd web && npm run dev` | 5173 |

Todo dentro de Docker: `docker compose --profile docker up -d` (ver [ADR-0016](docs/adr/0016-despliegue.md); necesita `secretos/` con el token de `claude setup-token`).

## Cómo se usa

| Modo | Para qué |
|---|---|
| **Estudio libre** | Preguntas lo que quieras. Si está en tus fuentes, responde citando (pulsa el número de la cita para ver el fragmento); si no, te lo dice y responde en general. La casilla «Esto no cuenta» evita que lo que pruebes falsee tu perfil. |
| **Tutor** | La tarjeta «Hoy» con la sesión que toca. «¿Vamos?» te lleva idea a idea por la lección, con una comprobación al final de cada bloque. |
| **Roadmap** | «Nuevo plan»: le cuentas qué quieres aprender, para qué, qué sabes, tus horas y tu plazo; te pregunta lo que falte, propone un plan y lo aceptas o pides cambios. Aquí ves lecciones, conceptos, fuentes por lección y el calendario; «Me he atrasado» y «Reajustar con mis repasos» lo recalculan. |
| **Calendario** | Las sesiones de las próximas cuatro semanas; márcalas como hechas. |
| **Temas y fuentes** | Crea fuentes y sube PDF, Markdown, HTML o una URL. Para una carpeta o tu vault: `uv run magister ingerir RUTA --fuente NOMBRE`. Aquí apruebas las fuentes que propone el research («Buscar fuentes» en una lección sin material). |
| **Fichas** | «Generar el material» de una lección: apuntes en PDF, fichas de repaso con respuesta fantasma, diapositivas y guion, en segundo plano con su progreso. |
| **Vídeo** | El guion por escenas de la lección. |
| **Repaso** | Lo que toca hoy: respondes de memoria, dices cómo de seguro estás y el tutor corrige y explica (Cornell o Feynman). Puedes discutir la nota. |
| **Progreso** | Camino, conceptos dominados, racha, carga de los próximos días y tu calibración. |
| **Etiquetar tono** y **Triaje del banco** | Para calibrar el juez de tono y convertir las respuestas que marcaste mal en casos de evaluación. |

## Órdenes útiles (desde `servidor/`)

| Para | Orden |
|---|---|
| Pruebas (sin cuota) | `uv run pytest -q` |
| Chuleta completa | `uv run magister ayuda` |
| Ingerir una carpeta, fichero o URL | `uv run magister ingerir <ruta> --fuente <nombre> [--tema <id>]` |
| Reingerir el vault | `uv run magister reingerir --fuente vault --carpeta <ruta>` |
| Exportar o borrar tus datos | `uv run magister exportar --salida <carpeta>` · `uv run magister borrar-todo` (con `--confirmar`) |
| Volver a una versión de un prompt | `uv run magister prompts listar <nombre>` · `uv run magister prompts activar <nombre> <version>` |
| Medir el planificador | `PYTHONUTF8=1 uv run python -m evals.correr` |
| Medir el retriever | `uv run python -m evals.banco_rag sintetico --n 60` y `uv run python -m evals.rag --tabla` |
| Medir el corrector | `uv run python -m evals.corrector.medir` |
| Modelo de olvido | `uv run python -m evals.olvido walkforward --calibrar` e `informe` |
| Ataques | `MAGISTER_MOTOR=eco uv run python -m evals.ataques --salir-si-falla` |
| Todas las evals | `uv run python -m evals.suite` (gasta cuota) |
| Alertas e informes | `uv run python -m magister.observar.alertas` · `uv run python -m magister.observar.informes coste` |
| Copia y restauración | `scripts/copia_db.sh` · `scripts/restaurar_db.sh <copia> magister_restaurada` |

## Mapa

| Carpeta | Qué hay |
|---|---|
| `servidor/src/magister/` | `api` (HTTP), `flujo` (el grafo de LangGraph), `cerebro` (el modelo, prompts, enrutador y caché), `plan` (calendario, código puro), `fuentes` (ingesta y RAG), `research`, `material` (apuntes, fichas, diapositivas, guion), `tono` (lint y juez), `trabajos` (la cola), `aprender` (corrector, repaso, modelo de olvido), `observar`, `seguridad` y `datos` (Postgres) |
| `servidor/evals/` | Bancos y harness de cada parte, y la estadística compartida |
| `servidor/config/modelos.yaml` | Qué modelo usa cada tarea |
| `web/src/` | La página (React con Vite y TypeScript) |
| `docs/` | ADR 0001 a 0016, contratos, criterios, tono y rúbrica, runbooks, datos y ley, design doc y decisiones |
| `afinar/` | Laboratorio de la Parte VI: contar parámetros, tokens, decodificación y el ajuste QLoRA |
| `escritorio/` | La ventana de Electron que sirve la página y arranca la API |
