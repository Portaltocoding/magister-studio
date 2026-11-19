# Contrato de la Parte V (aprender)

Copiado del libro (Parte V, «Contrato de referencia»). Manda sobre lo demás de la parte.

Esto es lo que copias en `docs/contratos/aprender.md`. Todo lo demás de la parte coincide con ello.

**Tabla `conceptos`** (de la Parte II): clave primaria `(plan_id, id)`, con `id` el slug del plan, `nombre` y `leccion_clave` (la `clave` de la lección). Al replanificar se crea un plan nuevo con los mismos slugs. Esta parte le añade `origen` (`plan` o `destilador`, por defecto `plan`) y `aprobado` (bool, por defecto verdadero).

**Tabla `preguntas_concepto`** (de la Parte IV): `pregunta_id`, `(plan_id, concepto_id)`. Esta parte solo la lee.

**Tabla `intentos`** (inmutable salvo `nota_usuario`):

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid | |
| `plan_id`, `concepto_id` | entero, texto | clave foránea compuesta a `conceptos(plan_id, id)` |
| `pregunta_id` | texto | pregunta de la Parte IV |
| `momento` | timestamptz | hora del servidor |
| `tipo` | `espaciado` o `reintento` | el modelo solo usa `espaciado` |
| `respuesta`, `explicacion` | texto | |
| `confianza` | real | 0,25, 0,5, 0,75 o 0,95 |
| `latencia_ms` | entero | de servir la pregunta a enviar |
| `nota_corrector` | `fallo`, `parcial`, `bien`, `perfecta` | |
| `nota_usuario` | igual, nullable | si corriges al juez |
| `p_predicha` | real, nullable | escrita **al servir** la pregunta |
| `version_programador`, `version_corrector` | texto | |
| `clave_idempotencia` | texto único | del cliente |

**Estado de un concepto**: se calcula por `concepto_id` con los intentos de **todos** los planes, porque replanificar no te hace olvidar (criterio general).

**Bases**: los tests usan siempre `MAGISTER_DB_URL_PRUEBAS` (la crea la Parte II); la simulación, `MAGISTER_DB_URL_SIM`; acceso asíncrono siempre con asyncpg.

**Acierto** (la etiqueta $y$): `coalesce(nota_usuario, nota_corrector)` en `bien` o `perfecta`.

**Salida del corrector** (JSON validado): `nota`, `ideas_presentes` (lista), `ideas_ausentes` (lista), `errores` (lista de `afirmacion`, `por_que`, `cita`), `tipo_error` (`olvido`, `confusion`, `concepto`, `incompleta`, `fuera_de_tema`).

**Rutas**:

| Ruta | Entra | Sale |
|---|---|---|
| `GET /api/practica/cola` | | `[{concepto_id, nombre, p, minutos}]` |
| `GET /api/practica/siguiente` | | `{pregunta_id, concepto_id, enunciado}`; escribe `p_predicha` |
| `POST /api/practica/intentos` | `{pregunta_id, concepto_id, respuesta, confianza, clave}` | SSE |
| `PATCH /api/practica/intentos/{id}` | `{nota_usuario}` | 200 |
| `GET /api/progreso/conceptos` | | estado, $R$, $S$, próxima fecha |
| `GET /api/progreso/carga?dias=14` | | `[{fecha, repasos, minutos}]` |
| `GET /api/progreso/calibracion?fuente=` | `usuario` o `modelo` | `[{predicho, observado, n}]` |

**Eventos SSE de la corrección**, en este orden: `nota` (`{nota, ideas_ausentes, errores}`), varios `delta` (`{"t": "..."}`, un trozo de la explicación, como en la Parte I), `fin` (`{intento_id, proxima_fecha}`); o `error` (`{detalle}`) si algo falla tras el 200, como en la Parte I.

**Programador** (protocolo): `p_recordar(estado, ahora) -> float`, `siguiente(estado, nota, ahora) -> (estado_nuevo, fecha)`, `version: str`.

**Ajustes nuevos en `servidor/.env`**: `MAGISTER_PROGRAMADOR=leitner` (o `fsrs`, y más adelante `modelo`), `MAGISTER_RETENCION=0.9`, `MAGISTER_INICIO_DIA=04:00`, `MAGISTER_ZONA=Europe/Madrid`.

**Base de simulación**: `MAGISTER_DB_URL_SIM` en `servidor/.env`, por ejemplo `postgresql+asyncpg://magister:magister@localhost:5432/magister_sim` (otra base en el mismo `magister-db`). Regla: `magister.aprender.simular` escribe **siempre** en ella; las órdenes con `--simulado` la leen en vez de `MAGISTER_DB_URL`; y la API usa `MAGISTER_DB_URL_SIM` si arranca con `MAGISTER_SIMULADO=1`, para ver la simulación en los paneles.

**Órdenes nuevas de la parte** (todas desde `servidor/`): `uv run python -m magister.aprender.simular`, `uv run python -m evals.olvido <subcomando> [--simulado]`, `uv run python -m evals.corrector.medir`, `uv run python -m evals.criterios_v05`. No hay procesos nuevos: siguen la API, la web y `magister-db` de las partes anteriores.

**Añadidos de Magister Studio.** Tabla `servidas` (la apuesta `p_predicha` escrita al servir); `intentos.correccion` (JSON del corrector); `tipo = 'sonda'` admitido; rutas `/api/hoy`, `/api/tutor/leccion/{material_id}`, `/api/tutor/servir/{pregunta_id}`, `/api/progreso/resumen`, `POST /api/temas/{id}/plan/reajuste` y `.../reajuste/aceptar`.

**Red neuronal de olvido** (`aprender/red.py`, `docs/adaptacion.md`): solo decide los repasos si gana a FSRS (un 1 % menos de pérdida en el último cuarto de los datos, que no ha visto) en **dos entrenamientos seguidos**, con al menos 40 repasos nuevos entre la victoria contada y la siguiente; perder pone la racha a cero y devuelve el mando a FSRS. `GET /api/progreso/modelo` saca en `red` el `estado` (`sin_datos`, `sombra`, `activa`), la `racha` y la `racha_necesaria`.
