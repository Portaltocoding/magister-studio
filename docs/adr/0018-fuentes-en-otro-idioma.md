# ADR-0018. Fuentes en otro idioma: sin bibliografía, segunda puerta con el reranker y citas por similitud

**Estado:** aceptada. **Fecha:** 2026-11-19.

**Contexto.** Con el troceador ya arreglado, las fuentes reales (tres textos web en inglés de filosofía de la mente, de 32.000, 50.000 y 106.000 caracteres) no servían en las respuestas, por tres motivos medidos con esos textos y el modelo real:

1. **La bibliografía se comía el índice.** De los 179 trozos con `v1`, 81 (45 %) eran de secciones que no son contenido: Bibliography 28, References 24, Notes 13 y el resto avisos del editor (Cite this article/chapter, Rights and permissions, Similar content being viewed by others, Academic Tools...). Y salían las primeras.
2. **La puerta de «hay fuentes» no deja pasar otro idioma.** Es el coseno denso de e5-small ≥ 0,85 (ADR-0007). Con 8 preguntas en español que los textos sí contestan, el mejor coseno fue de 0,776 a 0,845: ninguna pasaba, y la respuesta salía «sin fuentes» con la sección exacta delante. Con 6 que no contestan (B-tree, Revolución francesa, derivadas, fotosíntesis, Kant, litio en el trastorno bipolar), de 0,723 a 0,776. Los dos grupos se solapan: bajar el umbral denso no los separa.
3. **Toda cita entre idiomas salía dudosa.** `cerebro/citas.py` mide el solapamiento de palabras (Jaccard): 8 de 8 afirmaciones en español bien apoyadas en fragmentos en inglés salían dudosas.

**Decisión.**

1. **El troceador salta las secciones de bibliografía, notas y cómo citar**, en inglés y en español, por una lista cerrada (`trocear.SECCIONES_FUERA`) comparada con el último encabezado de la ruta, normalizado (sin tildes, sin mayúsculas, sin numeración delante). Esos tramos no dan fragmentos y el invariante de rangos sigue igual. No se aplica al vault (un «## Notas» tuyo es contenido) y, si todo el documento caería, no se filtra. Como el troceado forma parte de la configuración del índice (`tokens`, `solape`, `vault_por_parrafos`, `encabezado_contextual`), **no se edita `v1`**: la lista viaja en la configuración nueva como `secciones_fuera`, y `v1` (sin ese campo) trocea igual que siempre. La crea y la activa `uv run magister indexar --activar v3` (`v2` ya es el nombre del experimento de 250 tokens de `--indice v2`): copia los parámetros de la activa, añade la lista y reindexa con ella lo que ya estaba listo. Con los tres textos: de 179 trozos a 98 (35, 49 y 95 pasan a 1, 32 y 65).
2. **Segunda puerta con el reranker.** El reranker que ya había, `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1`, es multilingüe (mMiniLMv2 entrenado con mMARCO, con español). Cuando el mejor coseno de los k recuperados no llega a `MAGISTER_UMBRAL_FUENTES`, el buscador puntúa esos k con el reranker y lo devuelve en `ResultadoBusqueda.puntuacion_reranker` (vacío por defecto: `BuscadorFalso` no cambia). Hay fuentes si el coseno llega o si la mejor puntuación del reranker pasa de `MAGISTER_UMBRAL_RERANKER` (1,5). La misma regla vale para el plan y para el apoyo de cada lección (`flujo/fuentes.py`): un fragmento apoya si su coseno llega a `MAGISTER_UMBRAL_APOYO` o el reranker lo puntúa por encima de su umbral.
3. **Citas por similitud.** `citas.comprobar` acepta una función de similitud inyectada; el `BuscadorHibrido` la ofrece (`similitud_frases`, e5 ya cargado, el mismo prefijo de consulta a los dos lados) y `rag.py` se la pasa. Si el Jaccard ya basta, nada cambia; si no, la cita vale si el coseno con la frase más parecida llega a `MAGISTER_UMBRAL_CITA_SEMANTICA` (0,85). Sin la función, o con el modelo aún sin cargar, el Jaccard de siempre. `cerebro` no importa de `fuentes`.
4. **`magister indexar` recalcula el apoyo** (`lecciones_fragmentos`) de los planes afectados, como el bucle de la API, y procesa hasta que no queda nada pendiente. `--reintentar` devuelve a pendiente lo que quedó en cuarentena por un fallo al indexar (no lo que no pasó la validación).

**Números medidos** (19-11-2026, e5-small y el reranker en CPU, sin escribir en la base):

| | Mejor coseno | Mejor reranker (top 5) |
|---|---|---|
| 8 preguntas que los textos contestan | 0,776 a 0,845 | 3,70 a 7,98 |
| 6 preguntas de otro tema | 0,723 a 0,776 | −2,78 a −6,51 |
| 29 lecciones de tus planes (IA y Topografía) | 0,779 a 0,835 | −0,30 a −5,95 |

El umbral 1,5 queda entre −0,30 y 3,70, con margen a los dos lados: ninguna lección de tus planes gana apoyo de estos textos.

Citas (afirmación en español, fragmento en inglés, coseno con la frase más parecida): 8 bien apoyadas, de 0,836 a 0,919 (7 de 8 pasan de 0,85); 5 de otro tema o con el fragmento equivocado, de 0,770 a 0,843 (las 5 salen dudosas); 3 del mismo tema pero falsas (Capgras con litio, BX pintor, politemáticos solo en la demencia), de 0,867 a 0,874: no salen dudosas.

**Consecuencias.**
- El reranker solo corre cuando el coseno no llega: unos 0,6 a 0,8 s por pregunta en CPU con 5 fragmentos, y unos 5 s de carga, que se hacen al arrancar la API en un hilo, como e5.
- La similitud detecta la cita con el fragmento equivocado o de otro tema, no la afirmación falsa sobre el tema del fragmento: eso pide un juez (`evals.fidelidad`), no un coseno.
- El reranker devuelve logits (sin sigmoide) con sentence-transformers 6.3; si una versión nueva los pasara por una sigmoide, el umbral 1,5 dejaría de valer y hay que volver a medir.
- Una instalación nueva sigue empezando en `v1` (la migración no cambia): hasta lanzar `magister indexar --activar v3`, la bibliografía entra. Hacerlo por defecto pediría una migración de datos que cree y active `v3`.
- Uno de los tres textos (Synthese) trae solo el resumen, las notas y la bibliografía (el cuerpo no se descargó): con `v3` le queda un trozo, el resumen.

## Nota del 19-11-2026: la vía léxica, el relleno y lo que viene de la web

**Contexto.** Un probador encontró tres cosas. (1) «¿Qué es el complejo sinaptonémico y en qué subfase aparecen los quiasmas?» exigía las cinco palabras en un mismo fragmento (`websearch_to_tsquery` es un AND): la vía léxica salía vacía aunque los apuntes dijeran «los quiasmas se ven en el diploteno». (2) Un .txt de 60 KB con una frase repetida aportaba de 4 a 8 de los 8 fragmentos de apoyo de cada lección y el Roadmap decía que tu material la cubría. (3) En el research, la misma página de Khan Academy se leyó cinco veces por cinco subdominios, y LibreTexts llegaba al juez con 2.500 caracteres de macros de MathJax (profundidad 0, «descartada por cita»).

**Decisión** (los umbrales no cambian).

1. **Vía léxica: primero el AND, después el OR.** `fuentes/buscar.buscar_lexica_completa` devuelve primero los fragmentos con todas las palabras y después los que tienen alguna, por `ts_rank_cd`; con exclusiones («-mitosis») solo el AND. `ResultadoBusqueda.lexica_completa` dice cuáles tienen todas.
2. **Un acierto léxico completo en una fuente tuya es «hay fuentes».** En la híbrida, si el coseno no llega, un fragmento que no es web y tiene todas las palabras de la consulta resuelve en el escalón `lexica`, antes del reranker. Los aciertos del OR no cuentan.
3. **Las copias cuentan como una.** Al indexar, un trozo con exactamente las mismas palabras que otro del mismo documento no entra (`duplicados.sin_repetir`; no toca ningún trozo, la regla `version.texto[inicio:fin] == fragmento.texto` sigue). Al buscar, los fragmentos iguales o con Jaccard de shingles ≥ 0,8 con uno mejor colocado se quitan antes de cortar a k (`duplicados.colapsar`, `Consulta.colapsar_duplicados`): así tampoco llenan el apoyo de una lección.
4. **Research.** El tope de 2 lecturas y 2 propuestas es por sitio (`herramientas.dominio_base`), no por subdominio; una lectura con el mismo crudo que otra ya leída en la tarea no vuelve al juez; las macros de MathJax se quitan al extraer (`extraer.sin_macros`); y la trayectoria dice el motivo real de cada descarte (`fijo.por_que_no_vale`: «sin cita», «profundidad 0»...). La cita sigue siendo literal: solo se perdonan las remisiones entre paréntesis («(see synapsis)»).

**Medido** (base de ensayo, e5-small y mMARCO, sin red). La pregunta del probador contra la nota de meiosis entera (un solo fragmento, 1.106 caracteres, del vault): coseno 0,834 y reranker −2,23; contra fragmentos de otras lecciones, 0,827-0,836 y de −4,6 a −7,0. Contra solo su sección «Meiosis I», 0,856 y −0,87. Con estos datos el coseno no separa lo que contesta de lo ajeno en esta nota, y bajar umbrales no está justificado. Trocear el vault por encabezados daría 0,856, pero es otra configuración del índice (las del vault no se trocean si caben) y hay que medirla con el banco antes.

**Consecuencias.** Esa pregunta sigue en «nada»: la nota no habla del complejo sinaptonémico, así que no tiene todas sus palabras. «¿Los quiasmas se ven en el diploteno?» sí resuelve por la vía léxica.
