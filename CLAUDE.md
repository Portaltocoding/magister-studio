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
- `material` importa de `cerebro`, `plan`, `tono` y `datos`; `tono` importa solo de `cerebro`; `trabajos` importa de `material`, `datos` y `voz` (exportar vídeos a MP4); `api` importa además de `trabajos`.
- `aprender` importa de `cerebro`, `plan`, `tono`, `datos` y `config`; `api` y `flujo` importan de `aprender`.
- Fuentes del research (ADR-0019): `trabajos` importa también de `fuentes` (ingesta) y `seguridad` (politica); `material` y `aprender` importan `seguridad.entrada` dentro de la función, solo para marcar lo externo, como `flujo`.
- `research` (el researcher, el research fijo y sus tareas) importa de `cerebro`, `fuentes`, `datos`, `plan` (`plan.apoyo` y `plan.horizonte`, en las tareas; `plan.esquemas`, en el juicio de si hacen falta fuentes) y `config`; `seguridad.politica` y `trabajos` (incorporar), solo dentro de la función.
- `voz` (la voz local con Piper, el registro de las llamadas y el montaje de vídeos en MP4 con ffmpeg, `MAGISTER_FFMPEG`) solo importa de `magister.config`; `api` importa de `voz`. Piper y sus voces van en `herramientas/piper/` y los registros en `servidor/registros/llamadas/`, los dos fuera de git.
- `asesor` (el agente que lee y propone cambios en un proyecto, y el arnés que los aplica, ADR-0017) importa de `cerebro`, `datos`, `proyectos` y `config`; `api` importa de `asesor`. Sus herramientas solo leen y el modelo solo propone acciones de la lista cerrada de `asesor/cambios.py`: aplicar es un botón, nunca una salida del modelo.
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
7. `cerebro` y `flujo` no importan de `fuentes` ni de `research`: reciben el `Buscador` inyectado. Única excepción: `flujo/fuentes.juntar_apoyo` importa, dentro de la función, `fuentes.duplicados.colapsar` (puro: sin base, red ni modelo). `api` importa de `flujo`, `datos`, `fuentes` y `research`, y es quien construye el buscador.

## Material (Parte IV)

1. El modelo escribe contenido; el formato (esqueleto del motor, Marp, guion) lo monta el código. Toda salida estructurada pasa por `estructurar`.
2. Las plantillas de prompt van en `cerebro/prompts/`, con versión = SHA-256 (12 caracteres); cada salida guarda las versiones que la produjeron. Las variantes en prueba, en `cerebro/prompts/experimentos/`.
3. Ningún número de una eval lo calcula el modelo: la estadística está en `evals/estadistica.py`, con tests.
4. Un juez que no devuelve JSON válido o cita algo que no está en el texto devuelve `FalloJuez`, nunca un suspenso.
5. Todo trabajo largo va por la cola de `trabajos/`; los nodos son idempotentes (upsert, no insert).
6. Las pruebas no llaman a `claude`; los harness (`evals.tono`, `evals.fidelidad`, `evals.asesor`, `evals.cuando_research`) sí, y solo a mano.

## Aprender (Parte V)

1. `intentos` no se actualiza ni se borra; solo `nota_usuario` admite un `UPDATE`.
2. Toda columna de un modelo se calcula con `estado_en` o `features_en`, que solo leen intentos anteriores al momento dado.
3. `p_predicha` se escribe al servir la pregunta (tabla `servidas`), nunca después de corregir.
4. Los reintentos (`tipo = reintento`) no entran en el programador ni en el modelo.
5. Nada de `date.today()` ni `datetime.now()` dentro de funciones de dominio: el momento entra como argumento.
6. El contrato manda: `docs/contratos/aprender.md`.

## Producción (Parte VI)

1. Toda llamada a un modelo pasa por `magister/cerebro`; nadie más lanza `claude`.
2. Toda petición y todo trabajo abre una traza según `docs/contrato-trazas.md`.
3. Ningún secreto en el código ni en el repo: van en `servidor/.env` o en `secretos/`, fuera de git, y se leen por `config.py`.
4. El contenido externo es dato no confiable y se marca como tal al meterlo en un prompt (`seguridad.entrada.marcar_externo`).
5. La instrumentación nunca rompe una petición.
6. `cerebro` no importa `observar` ni `seguridad`: ofrece ganchos (`registrar_observador`) y esos paquetes se enganchan al arrancar la API.
7. Los ADR continúan la numeración de `docs/adr/` y toda tabla nueva va en una migración de Alembic.

## Estilo

Nombres de funciones, variables, tablas y columnas en castellano sin tildes. Mensajes al usuario en español de España.

## Reglas

- Nada de llamadas bloqueantes en código `async`.
- Nada de URLs con `localhost` en `web/src`.
- Los ajustes van en variables `MAGISTER_*`; nunca se escriben en el código.
- No añadir dependencias sin decirlo.

## Cómo se prueba

- Servidor: `uv run pytest` en `servidor/`.
- Frontend: `npm run build` en `web/`, y `npm test` en `web/` para la lógica pura (voz, preguntas frecuentes, vídeo), con el corredor de Node y sin dependencias.
- Motor falso: `MAGISTER_MOTOR=eco`.

`eco` es un motor de pruebas que devuelve texto sin llamar a `claude -p`; el motor real es `claude -p`.
