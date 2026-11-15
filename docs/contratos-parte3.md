# Contrato de la Parte III (v0.3)

Lo de las Partes I y II sigue igual. Si una práctica dice otra cosa, manda esta página.

## Búsqueda

`api` construye el buscador (`magister.fuentes.buscar.BuscadorHibrido`) y lo inyecta en el grafo; `flujo` y `cerebro` solo conocen el protocolo de `magister/cerebro/contratos.py`.

```
Recuperado = {fragmento_id: int, rango: int (desde 1), puntuacion: float,
              texto: str, documento_titulo: str, uri: str,
              fuente_tipo: "vault" | "pdf" | "libro" | "web" | "audio", version_id: int}
Filtros    = {tema_id: int | None, fuente_tipos: list[str] | None}
             tema_id = N devuelve los documentos del tema N y los que no tienen tema
Consulta   = {indice: str | None, via: "densa" | "lexica" | "hibrida", n_candidatos: int = 30, reranker: bool = False}
Buscador.buscar(consulta, k, filtros, params) -> ResultadoBusqueda(recuperados, busqueda_id, similitud_densa)
```

## Fuentes y versiones

`fuentes.nombre` es único; `confianza`: 3 tus documentos, 2 libros, 1 web. Estados de una versión: `recibida`, `pendiente`, `lista`, `cuarentena` (con `motivo`) y `retirada`.

## Rutas

| Ruta | Entra | Sale |
|---|---|---|
| `GET /api/fuentes` | | lista de fuentes |
| `POST /api/fuentes` | `{"nombre", "tipo", "confianza"}` | 201; 409 si el nombre existe |
| `GET /api/fuentes/{id}/documentos` | | documentos con su última versión y estado |
| `GET /api/documentos/{id}/versiones` | | versiones con estado y motivo |
| `POST /api/fuentes/{id}/documentos` | fichero (multipart) o `{"url"}`, más `tema_id` opcional | 202 `{"version_id"}` |
| `GET /api/versiones/{id}` | | `{"estado", "motivo", "fragmentos"}` |
| `GET /api/fragmentos/{id}` | | texto, `inicio`, `fin`, contexto, documento y fuente |
| `GET /api/buscar?q=&via=&k=&indice=&reranker=` | | `list[Recuperado]` |
| `POST /api/research` | `{"plan_id", "leccion_claves": [...], "sistema"}` | 202 `{"tareas": [ids]}` |
| `GET /api/research/{tarea_id}` | | estado, paso actual, `motivo_fin` |
| `GET /api/propuestas?estado=pendiente` | | propuestas del research |
| `POST /api/propuestas/{id}` | `{"accion"}`: `aprobar` o `rechazar` | 200 |

## Eventos SSE

`inicio`, `delta` con `{"t": ...}`, `error`, `fase` y `plan` como antes. `fin` se amplía:

```
event: fin
data: {"mensaje_id": 42, "ms_primer_token": 3900, "ms_total": 7100,
       "citas": [{"fragmento_id": 123, "cita_literal": "...", "dudosa": false}],
       "busqueda_id": 77, "sin_fuentes": false}
```

## Acción del agente de research

```
{"tipo": "buscar" | "leer" | "proponer" | "terminar", "consulta"?, "url"?, "motivo"?, "resumen"?}
```

## Lecciones

Toda tabla que apunta a una lección guarda `(plan_id, leccion_clave)` con clave foránea compuesta a `lecciones (plan_id, clave)`.
