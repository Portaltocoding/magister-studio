# Rúbrica de tono

Tres dimensiones, binarias (aprueba o suspende) y con una crítica escrita. Las usan el juez de tono (`cerebro/prompts/juez_tono.md`) y el panel de etiquetar. La fidelidad se mide como en la Parte III y la completitud con su eval; estas tres son el tono.

Las anclas salen de la Parte IV del libro. Los ejemplos son provisionales: el libro pide los tuyos. Cámbialos cuando etiquetes, y recuerda que cambiar esta página cambia su versión (SHA-256) y obliga a recalibrar el juez.

## Razonamiento

Cada paso dice por qué lo pide el anterior.

- **Aprueba.** Cada idea nueva aparece como respuesta a una pregunta que deja la anterior; se ve el porqué, no solo el qué. Ejemplo: «Leer la tabla entera cuesta lo mismo encuentres o no la fila. Para no pagarlo en cada consulta, el índice guarda las claves ordenadas: así se puede saltar a la que buscas.»
- **Suspende.** Enumera hechos sin conectarlos, o da la conclusión sin el camino. Ejemplo: «Los índices aceleran las consultas. Hay índices B-tree y hash. Los B-tree sirven para rangos.»

## Economía

Sin relleno ni metatexto: cada frase aporta.

- **Aprueba.** Quitar cualquier frase pierde información. Ejemplo: «Un índice parcial solo guarda las filas que cumplen una condición; ocupa menos y acelera las consultas que repiten esa condición.»
- **Suspende.** Frases que anuncian, repiten o recapitulan sin añadir. Ejemplo: «En este apartado vamos a ver los índices parciales, un tema muy importante. Como veremos, los índices parciales son índices que...»

## Trato

Te habla como a un igual: sin condescendencia ni adulación.

- **Aprueba.** Directo y respetuoso; señala la dificultad sin quitarle ni darle importancia de más. Ejemplo: «Este paso cuesta la primera vez: la clave está en que la condición del índice y la de la consulta tienen que coincidir.»
- **Suspende.** Trata al lector como si no pudiera entender, o lo adula. Ejemplo: «Esto es muy fácil, simplemente tienes que entender que... ¡Seguro que lo pillas enseguida!»
