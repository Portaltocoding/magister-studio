Estos son ejemplos ya juzgados, para que calibres el listón. Cada uno trae un extracto, el veredicto por dimensión y el porqué. Aprende de ellos el criterio, no las frases: en el bloque que te llegue no copies sus razones, juzga lo que haya delante.

Origen de las etiquetas. Los extractos son texto real de los apuntes generados por Magister (tres materiales de la base: HTTP, algoritmos y APIs REST). Todavía no hay etiquetas humanas guardadas, así que los veredictos de los ejemplos 1 a 12 son provisionales: los aprobados salen de la pasada final del juez sobre el bloque ya corregido, y los suspensos de economía, de la primera pasada sobre el bloque original (que después se corrigió y pasó); en ambos casos se han confirmado releyendo el texto contra la rúbrica. Los ejemplos 13 y 14 son variantes de un extracto real a las que se les ha quitado algo a propósito, y lo dicen.

Lo que más se repite al juzgar este material, y conviene tener presente. Primero, la economía suspende sobre todo por el cierre: una caja o una frase final que repite lo que las secciones anteriores ya explicaron. Segundo, una tabla que sirve para consultar rápido (códigos, comparativas) no es recapitulación solo por repetir cifras del texto, siempre que ofrezca una consulta que el texto en prosa no da. Tercero, el aviso «El error típico» aprueba el trato cuando nombra el fallo con franqueza y explica por qué ocurre, sin reñir ni adular. Cuarto, el razonamiento aprueba cuando se puede reconstruir la pregunta que lleva de una idea a la siguiente; suspende cuando las ideas son una lista de hechos que podrían ir en cualquier orden.

## Ejemplo 1. Origen: apuntes «JSON: el formato de los datos», apertura

Extracto:

Cuando el cliente envía datos en el cuerpo de una petición, o el servidor los devuelve en la respuesta, ambos necesitan acordar cómo escribirlos. Un programa guarda un usuario en memoria con su propia estructura interna, y esa estructura no se puede mandar tal cual por la red: hay que convertirla en texto. **JSON** (JavaScript Object Notation, notación de objetos de JavaScript) es el formato de texto más usado para ese fin. Lo declara la cabecera `Content-Type: application/json`, que ya viste en la petición.

Razonamiento: aprueba. Parte de un problema (la estructura interna no viaja por la red), llega a la solución (convertirla en texto) y solo entonces nombra JSON. Se ve el porqué de la idea nueva.
Economía: aprueba. Cada frase aporta: el problema, el nombre con su significado, el vínculo con la cabecera. No anuncia lo que viene.
Trato: aprueba. Recuerda lo que el lector ya vio («que ya viste en la petición») sin explicarle lo evidente.

## Ejemplo 2. Origen: apuntes «Recorrer con dos punteros», apertura

Extracto:

Un recorrido ingenuo de una secuencia repite trabajo: para cada posición vuelve a mirar zonas que ya ha visto. Los **dos punteros** evitan eso con dos índices que se mueven por la secuencia y nunca retroceden. Así cada elemento se visita un número constante de veces y el recorrido completo es $O(n)$ en tiempo y $O(1)$ en espacio extra, sin contar el estado auxiliar que se guarde.

Razonamiento: aprueba. El defecto del recorrido ingenuo (repetir trabajo) motiva la técnica, y la técnica explica el coste lineal («así cada elemento se visita un número constante de veces»).
Economía: aprueba. Tres frases, ninguna se puede quitar sin perder el problema, la idea o el coste.
Trato: aprueba. Directo, con la salvedad honesta del estado auxiliar en lugar de vender un O(1) limpio.

## Ejemplo 3. Origen: apuntes «Recordar quién eres», apertura y sesiones

Extracto:

HTTP no guarda estado: cada petición llega al servidor como si fuera la primera. Para que `/perfil` sepa que eres tú sin pedirte la contraseña cada vez, el cliente tiene que presentar algo que lo identifique en cada petición. Hay dos formas de organizarlo, y la diferencia está en **dónde se guarda el estado**.

En una **sesión**, la cookie lleva solo un identificador largo y aleatorio (`sid=a9f3...`). El servidor guarda en memoria o en una base de datos la tabla «identificador → usuario». Al llegar la petición, busca el identificador y recupera quién eres. El estado vive en el servidor, así que puede cerrarse una sesión borrándola de la tabla. El coste: cada petición exige una consulta, y varios servidores deben compartir esa tabla.

Razonamiento: aprueba. De «HTTP no recuerda» sale la necesidad de identificarse en cada petición, y de ahí el eje de comparación (dónde vive el estado). Cada consecuencia de la sesión (cerrarla, consultar, compartir la tabla) cuelga de ese eje.
Economía: aprueba. No hay frase de relleno; hasta el coste va con su causa.
Trato: aprueba. Expone ventaja y coste de cada opción sin sermonear.

## Ejemplo 4. Origen: apuntes «Recordar quién eres», aviso final

Extracto:

**El error típico**
Guardar el JWT en `localStorage` creyendo que «firmado» significa «seguro». La firma impide alterarlo, no robarlo: cualquier script inyectado lo lee y lo usa. Una cookie `HttpOnly` es más difícil de sustraer.

Razonamiento: aprueba. Nombra la creencia equivocada, la corrige con la distinción que importa (alterar frente a robar) y apunta a la alternativa.
Economía: aprueba. Es un aviso nuevo, no repite lo anterior: añade el riesgo concreto de `localStorage`.
Trato: aprueba. Dice «creyendo que» sin reproche: trata el error como una confusión comprensible, no como torpeza.

## Ejemplo 5. Origen: apuntes «Idempotencia y reintentos seguros», apertura y aviso

Extracto:

Una red falla de forma incómoda: el cliente envía una petición, el servidor la procesa, pero la respuesta se pierde por el camino. Desde fuera, el cliente no sabe si la operación se hizo o no. Lo único razonable es reintentar, y eso solo es seguro si repetir no cambia el resultado.

**El error típico**
Generar una clave nueva en cada reintento. El servidor la ve como una petición distinta y cobra otra vez. La clave se crea una vez por operación y se reutiliza en todos sus reintentos.

Razonamiento: aprueba. El fallo de red lleva a la duda del cliente, la duda al reintento, y el reintento a la condición de seguridad (idempotencia). El aviso explica la consecuencia (cobra otra vez), no solo la prohibición.
Economía: aprueba. Cada frase añade un paso; el aviso no recapitula, aporta el error concreto.
Trato: aprueba. Escribe «lo único razonable es reintentar» como conclusión del argumento, no como orden.

## Ejemplo 6. Origen: apuntes «Recorrer con dos punteros», patrón de ventana

Extracto:

En el segundo, la **ventana deslizante** (sliding window), ambos punteros avanzan en el mismo sentido y delimitan un tramo contiguo `[izq, der]`. `der` amplía la ventana; cuando deja de cumplir la condición, `izq` la encoge hasta que la cumple otra vez.

El `while` interior no hace el coste cuadrático: `izq` solo avanza, así que en total hace como mucho $n$ movimientos, más otros $n$ de `der`. El espacio es $O(k)$, con $k$ el tamaño del alfabeto.

Razonamiento: aprueba. Anticipa la duda natural (un bucle dentro de otro, ¿no es cuadrático?) y la responde con el argumento: `izq` solo avanza.
Economía: aprueba. El término inglés va una vez, con su traducción; no hay repetición.
Trato: aprueba. Sin adornos ni énfasis de ánimo.

## Ejemplo 7. Origen: apuntes «Recordar quién eres», cierre que se eliminó

Extracto (frase final de un recuadro de cierre, ya suprimido en la versión actual):

Con sesiones el servidor recuerda quién eres; con JWT te lo recuerdas tú, y el servidor solo comprueba la firma.

Contexto: el bloque ya había explicado por separado las sesiones (estado en el servidor) y el JWT (estado en el token), con sus costes.

Razonamiento: aprueba. La frase es correcta y encaja con lo anterior.
Economía: suspende. Resume la diferencia que las dos secciones ya habían establecido; quitarla no pierde información. Es el caso típico del cierre que recapitula.
Trato: aprueba. Sin condescendencia.

## Ejemplo 8. Origen: apuntes «Idempotencia y reintentos seguros», cierre que se eliminó

Extracto (frase final de un recuadro, ya suprimido):

Un reintento solo es seguro si el servidor puede reconocer que es la misma operación.

Contexto: el bloque ya había establecido esa regla en el párrafo anterior a la cuenta trabajada y en la explicación de la clave de idempotencia.

Razonamiento: aprueba. Es consistente con el texto.
Economía: suspende. Repite una regla ya dicha dos veces, sin añadir ejemplo ni matiz. El resto del bloque era denso; el suspenso es solo por este cierre.
Trato: aprueba. Sin reproche ni adulación.

## Ejemplo 9. Origen: apuntes «HTTP», recuadro final y apertura que se eliminaron

Extracto (dos fragmentos del mismo bloque, ya corregido):

Una petición HTTP dice qué quieres (método), sobre qué (URL) y con qué datos; la respuesta dice cómo fue (código) y qué devuelve (cuerpo).

La frase inicial anunciaba que casi todo lo que sigue en esta lección ocurre dentro de ese ciclo.

Contexto: el primer fragmento cerraba el bloque después de explicar por separado la petición y la respuesta. El segundo abría el bloque.

Razonamiento: aprueba. El cuerpo del bloque conectaba bien las ideas.
Economía: suspende. El cierre recapitula las secciones y la apertura es metatexto: anuncia el contenido en lugar de darlo. Quitar ambas no pierde nada.
Trato: aprueba. Nada que objetar.

## Ejemplo 10. Origen: apuntes «Recorrer con dos punteros», argumento de complejidad repetido

Extracto (tres citas tomadas del informe del juez sobre el bloque original, ya corregido):

...el recorrido completo es O(n) en tiempo y O(1) en espacio extra... (introducción). ...el coste es O(n) aunque haya un bucle dentro de otro... (sección de ventana). ...Tiempo O(n)... (después de la traza del while).

Razonamiento: aprueba. El argumento era correcto cada vez que aparecía.
Economía: suspende. El mismo argumento de complejidad aparecía tres veces y la frase final de cierre repetía la introducción. Una vez bastaba, en el sitio donde se justifica.
Trato: aprueba.

## Ejemplo 11. Origen: apuntes «Idempotencia y reintentos seguros», cuenta trabajada (aprueba entera)

Extracto:

El servidor guarda la clave junto con la respuesta que dio. Si llega otra petición con la misma clave, no cobra de nuevo: devuelve la respuesta guardada. Cuenta trabajada con un cobro de 50 €:

1. El cliente envía la petición con la clave `K`. El servidor no la conoce, cobra 50 € y guarda `K` con su respuesta.
2. La respuesta se pierde. El cliente agota el tiempo de espera.
3. El cliente reintenta con la misma `K`. El servidor la encuentra y devuelve la respuesta guardada.

Saldo total cobrado: 50 €, no 100 €.

Razonamiento: aprueba. La lista numerada no es una enumeración de hechos sueltos: es una traza en la que cada paso provoca el siguiente y el resultado final demuestra la regla.
Economía: aprueba. La última línea no recapitula, da el resultado numérico de la cuenta.
Trato: aprueba. Cuenta el caso con números, sin condescender.

## Ejemplo 12. Origen: apuntes «Idempotencia y reintentos seguros», precisión final

Extracto:

Para que funcione, la comprobación y el guardado de la clave deben ser atómicos (indivisibles), por ejemplo con una restricción de unicidad en base de datos. Si no, dos reintentos simultáneos podrían pasar la comprobación a la vez. Conviene también guardar la clave con una caducidad (24 horas es una cifra habitual, propia como orientación) y rechazar la misma clave con un cuerpo distinto.

Razonamiento: aprueba. Primero la condición, luego el fallo que ocurre si no se cumple, luego dos precauciones más.
Economía: aprueba. Todo es información nueva y no hay relleno. La cifra de 24 horas se marca como orientación propia, no como dato de una fuente.
Trato: aprueba. Dice «conviene» donde corresponde un consejo, no una orden.

## Ejemplo 13. Variante de un extracto real: se le quitaron los porqués

Esta variante parte de la apertura del ejemplo 2 y conserva los mismos hechos, pero se le han quitado las conexiones. Es un texto construido para que el juez vea cómo suspende el razonamiento sin que cambie nada más.

Extracto:

Los dos punteros son dos índices que se mueven por la secuencia. Nunca retroceden. El recorrido es $O(n)$ en tiempo. El espacio extra es $O(1)$. Hay un patrón de extremos opuestos. Hay otro de ventana deslizante.

Razonamiento: suspende. Enumera hechos correctos sin conectarlos: no dice qué problema resuelve la técnica ni por qué no retroceder da coste lineal. Se puede reordenar cualquier frase sin que se note.
Economía: aprueba. No hay relleno: las frases son cortas y todas dicen algo.
Trato: aprueba. No hay condescendencia.

## Ejemplo 14. Variante de un extracto real: trato condescendiente y relleno de evaluación

Esta variante parte del aviso del ejemplo 4 y le añade un tono que la guía prohíbe, más el texto de relleno que usa el propio harness de sesgos (evals.tono.medir) para probar la verbosidad. Está construida a propósito.

Extracto:

Esto es muy fácil, simplemente no guardes el JWT en `localStorage`. ¡Seguro que lo pillas enseguida! Como hemos visto, esto es importante. En resumen, conviene tenerlo presente, porque, como se ha dicho, lo anterior resume la idea principal de este apartado.

Razonamiento: suspende. Da la conclusión sin el camino: no explica por qué `localStorage` es un mal sitio, solo lo prohíbe.
Economía: suspende. «Como hemos visto», «en resumen» y «como se ha dicho» son metatexto: anuncian y recapitulan sin añadir nada.
Trato: suspende. «Muy fácil», «simplemente» y «seguro que lo pillas» tratan al lector como si no pudiera entender y lo adulan.

## Cómo usar estos ejemplos

Una sola dimensión suspendida no arrastra a las otras: un texto puede suspender la economía y aprobar el razonamiento y el trato, como los ejemplos 7 a 10. Y un giro marcado por el lint como sospecha, como «simplemente», no suspende por sí solo: en «simplemente no compila» el adverbio describe un hecho y no rebaja al lector. Suspende cuando la frase le dice al lector que algo es fácil o que debería entenderlo ya.
