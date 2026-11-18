# Jueces con golden set y prompt de sistema fijo

Fecha de la medida: 2026-11-18. Modelo de los jueces: el que enruta `config/modelos.yaml` para la tarea `juez` (haiku), a través de `claude -p`.

## Qué cambió

- El prompt de sistema de `juez_tono` y `juez_completitud` es ahora solo lo fijo: instrucciones, rúbrica (tono) y un golden set de ejemplos juzgados. Lo variable (bloque, sospechas del lint, concepto) va en el mensaje del usuario.
- Golden sets, versionados: `cerebro/prompts/comun/golden_tono.md` (14 ejemplos, ~14 000 caracteres) y `golden_completitud.md` (9 ejemplos). `juez.golden()` devuelve su texto y su SHA-256 (12 caracteres); `Juzgado.version_golden` lo guarda junto con `version_prompt` y `version_rubrica`.
- Ni el esquema del veredicto ni la firma de `juzgar` cambian.

## Caché de prompts: antes y después

Antes (tabla `llamadas` de la base principal, histórico de uso real): lectura / (entrada + escritura + lectura).

| Juez | Llamadas | Entrada | Escritura | Lectura | Lectura sobre total |
|---|---|---|---|---|---|
| juez_tono | 106 | 212 | 279 947 | 68 385 | 19,6 % |
| juez_completitud | 39 | 78 | 273 058 | 13 824 | 4,8 % |

Después (11 llamadas reales, en serie, sobre bloques de `bloques_material`; `python -m evals.cache_jueces`). La primera llamada escribe el prefijo; de la segunda en adelante lo lee.

| Juez | Primera llamada (escritura) | Segunda y siguientes: escritura / lectura | Lectura sobre total |
|---|---|---|---|
| juez_tono (6 bloques) | 10 010 | 2 190-2 309 / 7 701 | 77-78 % (5 llamadas) |
| juez_completitud (5 conceptos) | 6 248 | 2 267-2 302 / 3 946 | 63 % (4 llamadas) |

El prefijo fijo que se lee es de 7 701 tokens en tono y 3 946 en completitud, idéntico entre llamadas. Lo que se sigue escribiendo en cada llamada (~2 200 tokens) es el bloque y, sobre todo, la propia salida del juez, que el CLI deja en la caché para el turno siguiente; eso no se puede evitar con el prefijo.

Coste en unidades de entrada de caché (escritura x1,25, lectura x0,1), por llamada en régimen estable: tono antes ~3 370, ahora ~3 580 (+6 %) con un prompt unas cuatro veces más grande (golden set incluido); es decir, el golden set sale casi gratis por la caché, pero el ahorro neto frente a antes es nulo, no una rebaja. Lo que se gana es calibración, no tokens.

Límites de esta medida. Son 6 y 5 llamadas, una sola serie por juez. Las llamadas en paralelo (`asyncio.gather` en `informe_completitud`, hasta 4 a la vez) no ven la caché hasta que la primera escritura ha terminado: en la primera tanda de un material la lectura será menor que la medida aquí, en serie. El porcentaje histórico mezcla llamadas de dos versiones del prompt y de otras sesiones.

## Acuerdo con etiquetas humanas

No se puede medir. La tabla `etiquetas` está vacía (0 filas, rondas 1 y 2), `banco_tono` está vacío (sin particiones `alinear`/`validar`) y los 41 `candidatos_banco` están todos en `pendiente`, ninguno aceptado. `evals.tono.calibrar` necesita esas etiquetas y no tiene nada contra lo que calcular kappa. Para cuando existan: `uv run python -m evals.tono.calibrar --particion validar`; recuerda que cambiar el golden set cambia el prompt, y hay que recalibrar.

## Origen del golden set (no hay etiquetas humanas)

- Los extractos son texto real de tres materiales de la base (HTTP, algoritmos, APIs REST).
- Los veredictos son provisionales: los aprobados, de la pasada final del juez sobre el bloque ya corregido; los suspensos de economía (cierres que recapitulan, metatexto, repetición), de la primera pasada sobre el bloque original, que luego se corrigió y pasó. Los guardan los `informes` de la tabla `materiales`. Los he releído contra la rúbrica.
- No hay en la base un solo suspenso real de razonamiento ni de trato (el lint no encuentra nada en los 20 bloques ni en los 20 mensajes del tutor). Esos dos casos son variantes de un extracto real, construidas a propósito y marcadas como tales en el fichero (ejemplos 13 y 14); el segundo usa el `RELLENO` que ya tiene `evals/tono/medir.py`.
- Riesgo: el golden refleja las preferencias del juez anterior, no las de un humano. Hay que sustituir los veredictos por los de Carlos cuando etiquete en el Taller.
- Los ejemplos salen de los bloques 9/b2, 10/b3, 11/b3, 12/b2 y 9/b1. No uses esos bloques para evaluar el juez: estarían en el prompt.

## Sanidad con bloques que no están en el golden (3 llamadas)

| Entrada | razonamiento | economía | trato |
|---|---|---|---|
| 10/b4 con el `RELLENO` de medir.py añadido | aprueba | suspende | aprueba |
| 11/b1 con una apertura condescendiente («Esto es muy fácil, simplemente...») | aprueba | aprueba | suspende |
| 10/b4 sin tocar | aprueba | aprueba | aprueba |

Los bloques 11/b1, 10/b4, 12/b4, 9/b4, 11/b5 y 10/b1 (sin tocar) salieron aprobados en las tres dimensiones, salvo economía en 10/b1 (suspende, una llamada); antes el juez los suspendía en economía en la primera pasada y los aprobaba tras corregirlos, que es lo que son ahora. Una sola llamada por bloque: no mide variación (para eso, `python -m evals.tono.medir variacion`).

## Completitud (5 llamadas)

BFS, DFS, grafo y pila en 10/b4 y cursor en 12/b4: todas `explicado = true`, citas literales válidas. No hay casos negativos en esta muestra, así que no dice nada de la exigencia del juez; los negativos están en el golden (XSS, CSRF, UUID, Base64).

## Cómo repetir

    cd servidor
    uv run python -m evals.cache_jueces tono 11/b1 10/b4 12/b4 9/b4 11/b5 10/b1
    uv run python -m evals.cache_jueces completitud 10/b4:BFS 10/b4:DFS 10/b4:grafo 10/b4:pila 12/b4:cursor

Gasto real de esta medida: 14 llamadas a `claude` (6 + 5 + 3).
