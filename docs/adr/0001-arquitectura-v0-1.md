# ADR-0001. Arquitectura de la versión 0.1

**Estado:** aceptada. **Fecha:** 2026-11-03.

## Contexto

Un usuario y una persona construyendo, todo gratis y en local. Lo que vendrá después es Python. La v0.1 es una conversación con streaming guardada en Postgres.

## Decisión

- Monolito modular en Python 3.12 (uv, FastAPI) con módulos `api`, `cerebro` y `datos`.
- El cerebro llama a `claude -p` en `stream-json`, con el modelo `sonnet`.
- Postgres 16 con pgvector en Docker, dueño del historial.
- React con Vite y TypeScript, que habla con la API por JSON y SSE.

## Alternativas

- **Servicios separados.** Descartada: un único usuario y un solo equipo no lo justifican.
- **Node en el servidor.** Descartada: lo que vendrá después es Python.
- **Sesiones de `claude` como historial.** Descartada: el historial vive en Postgres, no en el modelo; sacarlo de otro sitio con meses de conversaciones sería una migración de datos.
- **Next.js.** Descartada: Vite frente a Next es una decisión reversible, y la interfaz se rehace en días.

## Consecuencias

Medianas de `scripts/medir_cli.py` con `sonnet` (2 ejecuciones, desde el lanzamiento):

| Medida | Mediana |
|---|---|
| `init` | 1,82 s |
| Primer trozo | 6,74 s |
| `result` | 7,51 s |

- Cada respuesta lanza un proceso nuevo: el `init` cuesta unos 1,8 s antes de que el modelo empiece.
- El primer texto llega a unos 6,7 s y la respuesta completa a unos 7,5 s, por lo que el streaming es necesario.
- El historial se reenvía entero en cada llamada.
- Pasar a Ollama es cambiar una función.

## Preguntas abiertas

- ¿Se unifican en Postgres los tres almacenes de conocimiento? Se contesta en la Parte III.
