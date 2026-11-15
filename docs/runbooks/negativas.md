# Alerta «negativas»

**Qué significa.** Más del 2 % de las respuestas empiezan con una negativa.

**Qué mirar primero.** `select traza_id from puntuaciones where nombre = 'negativa' and valor = 1 order by creada desc limit 10;` y lee esas conversaciones.

**Qué hacer.** Si son falsas alarmas, ajusta `observar/negativas.txt`; si son de verdad, revisa el prompt de sistema o los fragmentos que llegan.
