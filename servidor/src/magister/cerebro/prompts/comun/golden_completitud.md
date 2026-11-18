Estos son ejemplos ya juzgados, para que calibres el listón de «explicado». Cada uno trae el concepto, un extracto de apuntes, la cita y el veredicto con su porqué. Aprende de ellos el criterio, no las frases.

Origen de las etiquetas. Los extractos son texto real de los apuntes generados por Magister (materiales de la base sobre HTTP, algoritmos y APIs REST). Todavía no hay etiquetas humanas guardadas: los veredictos son provisionales, puestos releyendo el extracto con la definición de arriba (define y explica el mecanismo, no solo nombra).

El criterio, en una línea: un concepto está explicado si el lector, tras leer el extracto, sabría decir qué es y cómo o por qué funciona. Si solo se le pone nombre, o se le añade una glosa de media frase que dice qué es pero no cómo funciona, no está explicado: la cita es entonces la frase que lo nombra.

## Ejemplo 1. Concepto: idempotencia. Otras formas de nombrarlo: idempotente

Extracto de apuntes:

Una red falla de forma incómoda: el cliente envía una petición, el servidor la procesa, pero la respuesta se pierde por el camino. Desde fuera, el cliente no sabe si la operación se hizo o no. Lo único razonable es reintentar, y eso solo es seguro si repetir no cambia el resultado. Una operación es **idempotente** (repetirla deja el sistema en el mismo estado que ejecutarla una vez) cuando aplicarla n veces equivale a aplicarla una. Por eso `GET`, `PUT` y `DELETE` se pueden reintentar sin miedo: `PUT /pedidos/42` con el mismo cuerpo deja el pedido igual la primera vez y la décima. `POST` no lo es: dos `POST /pagos` crean dos pagos.

Cita: Una operación es **idempotente** (repetirla deja el sistema en el mismo estado que ejecutarla una vez) cuando aplicarla n veces equivale a aplicarla una.
Razón: define la propiedad, la motiva con el fallo de red y la ilustra con PUT frente a POST.
Explicado: sí.

## Ejemplo 2. Concepto: ventana deslizante. Otras formas de nombrarlo: sliding window

Extracto de apuntes:

En el segundo, la **ventana deslizante** (sliding window), ambos punteros avanzan en el mismo sentido y delimitan un tramo contiguo `[izq, der]`. `der` amplía la ventana; cuando deja de cumplir la condición, `izq` la encoge hasta que la cumple otra vez. El `while` interior no hace el coste cuadrático: `izq` solo avanza, así que en total hace como mucho n movimientos, más otros n de `der`.

Cita: `der` amplía la ventana; cuando deja de cumplir la condición, `izq` la encoge hasta que la cumple otra vez.
Razón: explica el mecanismo (quién amplía, quién encoge y cuándo) y por qué el coste es lineal.
Explicado: sí.

## Ejemplo 3. Concepto: JWT. Otras formas de nombrarlo: JSON Web Token, token

Extracto de apuntes:

Un **JWT** (JSON Web Token) invierte el planteamiento: el estado viaja en el propio token. Son tres partes en Base64 separadas por puntos: cabecera, **payload** (carga útil, con datos como `sub: 42` y `exp`, la caducidad) y **firma**. El servidor firma las dos primeras partes con una clave secreta. Al recibirlo, recalcula la firma: si coincide, nadie ha tocado el contenido y no hace falta consultar ninguna tabla. Por eso escala bien entre servidores.

Cita: Al recibirlo, recalcula la firma: si coincide, nadie ha tocado el contenido y no hace falta consultar ninguna tabla.
Razón: dice de qué partes consta y cómo se verifica sin consultar estado, que es el mecanismo.
Explicado: sí.

## Ejemplo 4. Concepto: atomicidad. Otras formas de nombrarlo: atómico, indivisible

Extracto de apuntes:

Para que funcione, la comprobación y el guardado de la clave deben ser atómicos (indivisibles), por ejemplo con una restricción de unicidad en base de datos. Si no, dos reintentos simultáneos podrían pasar la comprobación a la vez.

Cita: la comprobación y el guardado de la clave deben ser atómicos (indivisibles), por ejemplo con una restricción de unicidad en base de datos. Si no, dos reintentos simultáneos podrían pasar la comprobación a la vez.
Razón: define atómico como indivisible, da cómo conseguirlo y el fallo concreto que evita, aunque sea de forma breve.
Explicado: sí.

## Ejemplo 5. Concepto: XSS. Otras formas de nombrarlo: cross-site scripting

Extracto de apuntes:

Se protege con atributos: `HttpOnly` (el JavaScript de la página no puede leerla, lo que frena el robo por XSS) y `Secure` (solo viaja por HTTPS).

Cita: lo que frena el robo por XSS
Razón: solo lo nombra como amenaza; no dice qué es un ataque XSS ni cómo ocurre. Lo explicado aquí es HttpOnly, no XSS.
Explicado: no.

## Ejemplo 6. Concepto: CSRF. Otras formas de nombrarlo: petición forzada entre sitios

Extracto de apuntes:

Además, `SameSite` limita que se envíe desde otros sitios y frena el CSRF, es decir, las peticiones forzadas desde una web ajena.

Cita: frena el CSRF, es decir, las peticiones forzadas desde una web ajena
Razón: da una glosa de media frase (qué es) pero no el mecanismo: no explica por qué el navegador enviaría la cookie desde otro sitio ni cómo se aprovecha. Glosar no es explicar.
Explicado: no.

## Ejemplo 7. Concepto: UUID. Otras formas de nombrarlo: identificador único

Extracto de apuntes:

Para hacer seguro un `POST`, el cliente genera un identificador único (por ejemplo un UUID, un código aleatorio de 128 bits) y lo manda en una cabecera.

Cita: por ejemplo un UUID, un código aleatorio de 128 bits
Razón: el UUID aparece como ejemplo con una glosa; no se explica cómo se genera ni por qué es prácticamente único. Se usa como herramienta, no se explica.
Explicado: no.

## Ejemplo 8. Concepto: Base64. Otras formas de nombrarlo: ninguna

Extracto de apuntes:

Son tres partes en Base64 separadas por puntos: cabecera, **payload** (carga útil) y **firma**. Pero el payload está codificado, **no cifrado**: cualquiera puede leerlo, así que nunca metas secretos.

Cita: Son tres partes en Base64 separadas por puntos
Razón: solo se nombra la codificación; el texto aclara que no es cifrado, pero no explica qué hace Base64 ni cómo se lee.
Explicado: no.

## Ejemplo 9. Concepto: cookie. Otras formas de nombrarlo: Set-Cookie

Extracto de apuntes:

Una **cookie** es un pequeño dato que el servidor manda con la cabecera `Set-Cookie` y que el navegador devuelve solo, con la cabecera `Cookie`, en cada petición posterior al mismo sitio. Por sí sola es un mecanismo de transporte: lo que lleve dentro es cosa nuestra. En una **sesión**, la cookie lleva solo un identificador largo y aleatorio (`sid=a9f3...`). El servidor guarda en memoria o en una base de datos la tabla «identificador → usuario».

Cita: Una **cookie** es un pequeño dato que el servidor manda con la cabecera `Set-Cookie` y que el navegador devuelve solo, con la cabecera `Cookie`, en cada petición posterior al mismo sitio.
Razón: dice qué es, quién la manda, quién la devuelve, con qué cabeceras y cuándo; es el mecanismo completo.
Explicado: sí.

## Cómo usar estos ejemplos

Mira siempre dónde se explica el concepto, no solo dónde aparece: la cita debe ser la frase literal que mejor lo explica, o, si no se explica, la que lo nombra. Que el concepto aparezca entre paréntesis, como ejemplo o de pasada, suele ser un nombrado sin explicar. Una definición correcta con su mecanismo en una sola frase sí cuenta como explicada.
