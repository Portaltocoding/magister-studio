# El sobre

Todo mensaje entre piezas viaja dentro de un sobre: cuatro campos fijos alrededor del contenido. El sobre se define sin hablar de ningún transporte; cada transporte decide cómo lo lleva.

| Campo | Qué es | Para qué |
|---|---|---|
| `version` | Versión del contrato, por ejemplo `0.1` | Que una página antigua sepa si habla con un servidor más nuevo |
| `id` | Identificador único de la petición | Seguir una misma petición por todas las piezas (la Parte VI lo usa para observar) |
| `tipo` | Qué mensaje es | Saber cómo leer el contenido |
| `contenido` | El mensaje en sí | Lo que fija el contrato de cada tipo |

## Tres tipos de mensaje

| Tipo | Cómo viaja | Para qué |
|---|---|---|
| Petición y respuesta | JSON | Pedir datos o una acción y recibir el resultado: conversaciones, plan, fuentes |
| Flujo de eventos | SSE: eventos con nombre por una misma respuesta abierta | La respuesta del modelo trozo a trozo: `inicio`, varios `delta`, y `fin` o `error` |
| Error | JSON con forma fija | Que la página sepa qué falló sin adivinar |

### La forma del error

- **En las rutas:** la que FastAPI ya devuelve, con el código HTTP del fallo.

  ```json
  {"detail": "..."}
  ```

- **Dentro del flujo:** un evento `error` que llega en lugar de `fin`. El código HTTP ya fue 200, así que el fallo va en el evento.

  ```
  event: error
  data: {"detalle": "..."}
  ```

Los dos nombres son distintos a propósito: `detail` es el de FastAPI, y `detalle` es el campo del evento que fija la Parte I en castellano. Un formato propio obligaría a convertir cada error que FastAPI ya genera (validación, ruta inexistente).

## Cómo viaja en HTTP

| Campo | Dónde va |
|---|---|
| `version` | Cabecera de la respuesta `X-Magister-Version` |
| `id` | Cabecera de la respuesta `X-Request-Id` |
| `tipo` | La ruta (`GET /api/salud`) o el nombre del evento SSE (`event: delta`) |
| `contenido` | El cuerpo: el JSON de la ruta o el `data:` del evento |

Las dos cabeceras las pone un solo middleware de la API en todas las respuestas. Así los cuerpos JSON quedan limpios y son exactamente los del contrato de la Parte I.

## Cómo viajaría en escritorio

Si la página y el servidor corren en la misma aplicación de escritorio, el canal deja de ser una red y pasa a ser un proceso local. Los cuatro campos serían campos del mensaje local:

```json
{"version": "0.1", "id": "…", "tipo": "delta", "contenido": {"t": "Hola"}}
```

El contrato, los tipos y el sobre no cambian; cambia solo cómo viajan.
