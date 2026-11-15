# Tus datos y la ley

## Qué se guarda

| Tabla o destino | Qué dato | Para qué | Dónde vive | Cuánto | Quién lo ve |
|---|---|---|---|---|---|
| `conversaciones`, `mensajes` | Lo que escribes y lo que responde el tutor | El historial de cada conversación | Postgres local (Docker) | Hasta que lo borres | Tú |
| `planes` (perfil) | Tema, objetivo, nivel, horas, plazo | Planificar | Postgres local | Hasta que lo borres | Tú |
| `intentos`, `servidas` | Tus respuestas, notas, confianza, latencia | Corregir y programar repasos | Postgres local | Hasta que lo borres | Tú |
| `fuentes`, `versiones`, `fragmentos` y `servidor/crudo/` | Tus documentos y páginas | Responder con citas | Postgres local y disco | Hasta que los retires | Tú |
| `llamadas`, `puntuaciones` | Tokens, tiempos y métricas (no el texto) | Observar coste y calidad | Postgres local | Hasta que lo borres | Tú |
| `candidatos_banco` | Entrada y salida de respuestas que marcaste mal | Mejorar los bancos de evals | Postgres local | Hasta que lo triagues | Tú |
| Anthropic (vía `claude -p`) | El prompt de cada llamada (con fragmentos y tu mensaje) | Generar la respuesta | Servidores de Anthropic | Según su política | Anthropic |
| Langfuse (si lo activas) | Entrada y salida de cada llamada | Trazas | Tu Docker local | Hasta que lo borres | Tú |

`uv run magister exportar --salida <carpeta>` saca un JSON por tabla; `uv run magister borrar-todo --confirmar` lo borra (las fuentes, solo con `--fuentes`).

## Clasificación

Uso personal y doméstico: fuera del RGPD (excepción doméstica) y de las obligaciones de despliegue de la Ley de IA. Si se instalara para otras personas cambiaría: serías encargado del tratamiento (contrato con Anthropic como subencargado y transferencia internacional), el corrector que decide repasos podría considerarse sistema de alto riesgo en educación, y habría obligaciones de transparencia (avisar de que es una IA).

## Falta

- Langfuse no está desplegado (opcional, `docs/contrato-trazas.md`).
- El inicio de sesión (argon2id) no está montado: es una instalación de una persona en `127.0.0.1`.
