Escribes el guion gráfico de un vídeo animado de la lección «{titulo}»: una serie de tramos, cada uno con un título (concepto · tesis), lo que dice la voz y una escena hecha de datos que un motor anima. Tú escribes el contenido; el motor pone el diseño, los colores y el movimiento.

@incluir explicar

Cómo se ve un buen vídeo:
- Un solo ejemplo conductor de principio a fin, con nombres y números (una persona, un caso, una obra, una tabla pequeña). Cada concepto nuevo se le añade; no cambias de ejemplo.
- El problema antes que la idea: primero el caso funciona, luego el intento ingenuo falla y se ve dónde (en la escena, con estado «mal»), y solo entonces llega la idea y su nombre.
- Cada tramo, una sola tesis de 3 a 6 palabras. Leyendo solo los títulos se entiende el vídeo.
- El mapa vuelve: un tramo de mapa al empezar (actual 0) y otro al empezar cada parte, con la idea que empieza.
- Cierra con un tramo de repaso: un contraste o unos pasos con lo esencial, o el mapa con la última idea.

El mapa (`partes`): de 2 a 4 partes con sus ideas (de 3 a 9 ideas en total), en el orden en que salen en el vídeo. `actual` de un tablero cuenta todas las ideas en orden desde 0.

Las escenas, y cuándo usar cada una:
- tablero: el mapa de la lección. Al empezar y al empezar cada parte.
- pregunta: una pregunta grande que abre un problema («¿Y si pagas dos veces?»), con una pista opcional. Úsala para abrir, no para cerrar.
- contraste: dos o tres lados frente a frente (antes y después, ingenuo y bueno, dos teorías, dos casos), cada uno con unas líneas y su estado («mal» lo que falla, «bien» lo que funciona), y un veredicto.
- opciones: de 2 a 4 alternativas en tarjetas, cada una con cómo es, qué pasa, su veredicto (bien, mal o depende) y para qué usarla.
- pasos: un procedimiento o unas reglas numeradas, de 2 a 6, que se encienden una a una.
- tabla: unos datos de ejemplo (como mucho 7 filas); `resto` para decir lo que no se ve.
- barras: una comparación de magnitudes con números de verdad (lineal, o log si van de 10 a 1.000.000).
- consulta: una orden, consulta o fórmula de hoja de cálculo, lo que devuelve y la cifra que importa en grande.
- por_dentro: tres zonas fijas, código · memoria · pantalla, unidas por cables en el orden en que viaja el dato. Solo para programación.
- figura: geometría en un plano con coordenadas del mundo (puntos, segmentos, ángulos como acimut en gon, proyecciones, norte, textos), dibujada por pasos (`paso` 0, 1, 2…). Para topografía, física, geometría o cualquier dibujo con medidas. Los puntos con id; los segmentos, ángulos y proyecciones se refieren a esos ids.
- formula: de 1 a 4 fórmulas en LaTeX, de una en una, con una nota y qué es cada símbolo.
- calculo: una cuenta hecha a mano: datos, y por cada paso qué se calcula, la sustitución con los números y el resultado (en LaTeX). Las cuentas, hechas y comprobadas: un número mal es peor que no ponerlo.

Elige la escena que mejor enseña ese tramo y varía: no más de tres tramos seguidos con el mismo tipo. Las materias de letras (derecho, filosofía, historia) viven sobre todo de contraste, opciones, pasos, pregunta y tabla; las de números, de figura, formula, calculo, barras y tabla.

`fondo`: «cartesiano» (una rejilla suave, como en los vídeos de matemáticas) si la lección es de matemáticas, física, topografía o cualquier materia con figuras y coordenadas; si no, «liso».

`momento` de cada tramo: mapa (los tableros), intuicion (la situación concreta), choque (lo ingenuo falla), nombre (la idea y su nombre), teoria (cómo funciona por dentro, el ejemplo resuelto) o repaso.

La narración:
- Se lee en voz alta, a la par que la escena: habla de lo que se ve («a la izquierda…», «fíjate en la fila de Ana»). De 25 a 90 palabras por tramo, frases cortas.
- Nada de fórmulas escritas ni símbolos (sin $, \, ^, =): dilas con palabras. Las siglas, la primera vez, di qué significan.
- No digas más de tres cifras seguidas: agrupa o deja el resto en la escena.
- Español de España, tuteo, sin el carácter de la raya larga.
- Presupuesto: unas {palabras} palabras de narración en total ({minutos} minutos a 150 palabras por minuto).

Los textos de las escenas son cortos (se leen en un vistazo): etiquetas de 1 a 4 palabras, líneas de menos de 10 palabras. En las escenas, los acentos y la ñ van tal cual; las fórmulas, en LaTeX sin $.

Estilo de este vídeo: {estilo}

Conceptos del núcleo, en orden: {conceptos}. Cúbrelos todos; si no caben en el presupuesto, dilo en el último tramo y nombra los que quedan fuera.

<apuntes>
{apuntes}
</apuntes>
