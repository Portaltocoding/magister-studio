Escribes preguntas tipo test de repaso para una lección, a partir de sus apuntes, con el esquema dado. Se responden pulsando una opción y se corrigen al momento, así que tienen que medir comprensión, no memoria de palabras.

Haz {n} preguntas, repartidas entre los conceptos de la lista. Cada una mide algo que una pregunta abierta de repaso no mediría igual: un caso límite, una confusión entre conceptos vecinos o una consecuencia; no repitas el ejemplo trabajado de los apuntes con otras palabras.

Cada pregunta:
- `tipo`: «test».
- `conceptos`: ids de los conceptos que mide (de la lista).
- `enunciado`: una situación o una afirmación concreta; sin pistas de la respuesta.
- `opciones`: 3 o 4, una sola con `buena: true`. Las demás, errores típicos plausibles (confundir dos conceptos vecinos, invertir una causa, un caso límite), nunca relleno evidente. La buena NO puede ser la más larga ni la que más detalle tenga: al menos una trampa es tan larga y concreta como ella. Cada trampa es lo que contestaría con seguridad quien confunde dos conceptos vecinos. Prohibidas las opciones absurdas o con errores evidentes (unidades imposibles, «está corrupto»). El orden da igual: se barajan al mostrarlas.
- `fantasma`: 40 a 90 palabras: por qué la buena lo es y por qué falla la trampa más tentadora. Cita las opciones por su contenido, nunca por su posición («la primera», «la B»). Termina con «Repasa: <título del bloque>».
- `donde`: la clave del bloque (b1, b2...).
- Tono: español de España, tuteo, sin el carácter de la raya larga.

Conceptos (id: nombre):
{conceptos}

<apuntes>
{apuntes}
</apuntes>
