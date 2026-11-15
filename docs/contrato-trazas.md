# Contrato de las trazas

Una traza por petición HTTP (su id es el `X-Request-Id`, o uno nuevo) y una por trabajo de la cola (`trabajo-<id>`). Viaja en el evento `fin` del SSE como `traza_id`.

| Pieza | Dónde | Qué guarda |
|---|---|---|
| Llamada al modelo | tabla `llamadas` (y `generation` en Langfuse si está) | función (tarea o plantilla), motor, modelo pedido y respondido, tokens en cuatro cubos que no se solapan (entrada, salida, lectura de caché, escritura de caché), coste equivalente, `ttft_ms`, `total_ms`, reintentos, respaldo, error, plantilla y su versión |
| Puntuación | tabla `puntuaciones`, única por `(traza_id, nombre)` | `negativa`, `vacia`, `lint_tono`, `<funcion>.json_valido`, `tono_juez` (juez online), `feedback_usuario` |
| Alerta | tabla `alertas` | nombre, detalle, leída, resuelta |
| Candidato al banco | tabla `candidatos_banco`, único por traza | origen (`feedback`, `juez`, `otra_explicacion`, `aleatorio`), entrada y salida copiadas |

Nombres válidos de puntuación: los de la tabla. Langfuse es opcional (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`); sin él, todo se guarda en Postgres igual.
