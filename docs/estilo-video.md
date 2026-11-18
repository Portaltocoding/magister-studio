# Estilo de vídeo: referencia

Análisis de *Give Me 1 Hour, I'll Make React Click Forever* (Zachary Huang, @ZacharyLLM, 1 h 12 min),
hecho sobre fotogramas cada 20 s y tramos a 2 fps. Es la referencia de cómo queremos que se vean y se
expliquen los vídeos de Magister. Lo de «cómo está hecho» es inferencia: el autor no lo cuenta.

## 1. La explicación

- **Un solo ejemplo de principio a fin.** Una app de juguete (votar dónde comer: «Lunch Roulette») vive
  los 72 minutos. Cada concepto nuevo se añade a esa misma app; nunca cambia de ejemplo.
- **El problema antes que la idea.** Primero lo construye a mano (JavaScript puro) y deja que salgan los
  fallos: «Ben's Unvote · two places forgotten», «The crown · added, never taken off». Cuando duele,
  aparece la idea que lo arregla (`render()`, plantilla, UI declarativa) y solo después el nombre que le
  da React: «What we built · React's name for each piece».
- **Cada tramo tiene una tesis.** El título cambia cada ~20 s y siempre es `Concepto · la idea en 4-6
  palabras`: «Declarative UI · data in, page out», «Steps · each change needs its undo». Leyendo solo
  los títulos se entiende el vídeo entero.
- **«Under the hood».** Tras ver qué pasa, enseña por qué: la memoria de React, la descripción (copia de
  la página en memoria) y el DOM, lado a lado, y cómo compara la vieja con la nueva.
- **Comparar opciones con veredicto.** «Which key? · four choices»: cuatro columnas, cada una con su
  resultado, ✓ o ✗ y «úsalo para…».
- **Reglas numeradas con progreso.** «JSX rule 1 · curly braces», «rule 2 · one outer tag»: chips arriba
  que se van marcando.
- **Errores de verdad.** El aviso de la consola, la pantalla de error de Vite, «expected 2, got 1».
- **El mapa vuelve.** «The whole board · nine ideas in five parts» aparece al empezar cada parte con la
  actual iluminada. Al final, las nueve ideas con ✓ alrededor de `UI = f(state)`.
- **Cierre en dos pasos.** «The whole app · every line» (cada línea etiquetada con la idea que usa) y
  «The finished app · every bug from the start, fixed».

## 2. Lo visual

- **Un escenario, sin cortes.** Un lienzo 16:9 casi negro (≈ `#1a1a1a`). Las piezas entran, se atenúan,
  se mueven y se transforman en su sitio; no hay cambios de plano.
- **Título fijo** arriba a la izquierda, con serif: el concepto en blanco, la tesis en gris tras un `·`.
- **Paneles con forma de herramienta real.** Editor (tres puntos, pestaña con el nombre del fichero,
  números de línea, monoespaciada), navegador con su dirección, consola, árbol del DOM. La disposición
  típica, de izquierda a derecha: código · lo que pasa por dentro · lo que se ve.
- **Color con significado, y poco:**
  - ámbar: lo que importa ahora (marco de resaltado, línea activa, la palabra clave);
  - cian: el estado en memoria y sus cables;
  - verde: correcto o añadido (✓, líneas nuevas);
  - rojo: el fallo o lo olvidado (✗, líneas borradas, errores);
  - todo lo demás, gris.
- **Foco por atenuación.** Lo que no toca baja a ~25 % de opacidad; lo que toca se enmarca en ámbar. El
  ojo nunca duda adónde mirar.
- **Cables.** Curvas que unen el código, la memoria y la pantalla; un punto viaja por ellas cuando pasa
  un dato. El flujo se ve.
- **Valores vivos.** Chips como `pizza: 2` que cambian cuando la voz lo dice; contadores que suben.
- **Personajes mínimos, a línea.** Dos programadores (Sam, Ben) que provocan los fallos y un robot
  «React» que hace el trabajo: el motor se vuelve alguien.
- **Metáforas de un vistazo.** Una balanza («describir todo» frente a «rehacer todo»), una máquina `f`
  con engranajes (`UI = f(state)`), un «?» enorme, un año grande para la historia, un gráfico con datos reales.
- **Efectos de sonido** discretos; hay versión sin ellos.

### Movimiento

Nada aparece de golpe y nada se queda quieto mientras la voz habla de ello:

- **El código se escribe** letra a letra, y la línea nueva se marca en verde en el margen.
- **Zoom al sitio de la acción.** Cuando toca escribir en la app, el panel del navegador crece al centro,
  el resto se aparta y, al acabar, vuelve a su sitio.
- **Interacción simulada.** Un cursor pulsa «Vote», el botón responde, el número sube, la corona salta de
  una tarjeta a otra; se escribe «Ram…» en la caja y el texto se ve llegar.
- **Las cosas viajan.** Las tarjetas se reordenan con su trayectoria (arcos discontinuos ámbar de «antes» a
  «después»); los valores salen del código y entran en la memoria por un cable.
- **Atenuar y avivar** en lugar de cortar: la escena siguiente nace de la anterior.
- **Huecos que se llenan.** Las rejillas empiezan con casillas vacías de borde discontinuo («Hooks · one
  idea»: seis huecos alrededor del componente; «Which key?»: cuatro columnas) y se rellenan una a una.
  La que se está explicando lleva marco ámbar; las hechas, su ✓ verde o ✗ rojo.

### Pantallas completas

Las pantallas de síntesis están llenísimas y aun así se leen, porque todas siguen la misma rejilla:

- **«The whole board».** Cinco columnas (las partes) y nueve tarjetas (las ideas). Cada tarjeta lleva
  número en círculo, nombre, una línea de qué es y un **microdiagrama propio** (la máquina `f`, el árbol
  de ficheros, la tarjeta con su prop, la caja «count 1» con su cable, el reloj de `useEffect`). Lo hecho,
  con ✓ verde; lo actual, encendido; lo que falta, atenuado. Al pie, una tira con todos los ficheros de la app.
- **Tres zonas fijas** en «Under the hood»: código · memoria y descripción · navegador y DOM. Siempre en el
  mismo sitio, así el ojo ya sabe dónde buscar cada cosa.
- **Rotuladas en pequeño.** Cada zona tiene su etiqueta gris («React's memory», «the description», «the DOM»,
  «before / after», «use for:»).

### Color, más fino

Además de la paleta semántica (ámbar, cian, verde, rojo sobre gris):

- **Código** con resaltado propio y sobrio: morado para palabras clave, amarillo para nombres de función,
  azul claro para expresiones `{…}`, gris para lo demás. El prefijo `use` de los hooks, en ámbar.
- **La app de ejemplo** tiene su identidad: botones naranja de contorno, emojis de comida, corona dorada.
  Se distingue de la explicación de un vistazo.
- **Cajas de estado** en azul claro con el número grande; cuando cambian, parpadean en ámbar.
- **Título**: concepto en blanco roto, tesis en gris medio; jamás color en el título.

## 3. Cómo está hecho (inferencia)

Vectorial nítido, código como texto, interpolaciones suaves y ni un corte: se genera por código (escenas
descritas como datos y animadas por un motor), no se edita a mano en un editor de vídeo. Encaja con el
autor, investigador de agentes LLM. No sabemos qué herramienta usa.

## 4. Lo que ya está

- **El método de explicar**, desgranado de los ~200 títulos del vídeo, es el núcleo común
  `servidor/src/magister/cerebro/prompts/comun/explicar.md`. Lo incluyen (`@incluir explicar`) `responder`,
  `conversar`, `apuntes_bloque` y `guion`; la versión de cada uno se calcula sobre el texto expandido.
- **El motor de escena** con Remotion en `web/src/escena/`: el formato del guion gráfico (`tipos.ts`), los tokens
  (`estilo.ts`), las piezas (título-tesis, ventana, código que se escribe, cable con su dato, marcas), cinco escenas
  (tablero, por dentro, pregunta, contraste, opciones con veredicto) y el reproductor con la voz de Magister y el
  esqueleto de tesis. «Por dentro» se puede tocar con el vídeo parado.
- **Una lección de muestra** escrita a mano con el método (L4 · Idempotencia): Vídeo → «Vídeo animado (demo)», o
  `#/video/demo?t=40`.

Falta: que el modelo escriba el guion gráfico (un prompt `guion_grafico` que pase por `estructurar`), más escenas
(flujo `f(estado)`, árbol, línea de tiempo, personajes) y exportar a MP4 con `@remotion/renderer`.

## 5. Qué cogemos para Magister

1. **El guion pasa a guion gráfico.** Cada tramo: título `Concepto · tesis`, narración y acciones visuales
   como datos (mostrar panel, resaltar, atenuar, unir con cable, cambiar un valor). El modelo escribe
   el contenido y el código monta la escena (regla IV.1); la salida pasa por `estructurar`.
2. **Un motor de escena en `web/`**, con SVG y CSS (o la Web Animations API), sin dependencias nuevas,
   sincronizado frase a frase con la voz que ya tenemos.
3. **Un ejemplo conductor por lección**, elegido al planificar el vídeo y usado en todas las escenas.
4. **Las escenas actuales encajan:** `choque` es el «problema antes que la idea» y `nombre` es «el nombre
   que le da React». Falta el «por dentro» y el cierre.
5. **El mapa de conceptos de la lección** como tablero que vuelve al empezar cada parte.
6. **La paleta semántica** en tokens: foco, estado, bien, mal; y una identidad aparte para el ejemplo.
7. **Interactivo de verdad.** Nuestro «vídeo» no es un MP4: es una escena viva en el navegador. Pausas y
   puedes tocarla: pulsar el botón del ejemplo, cambiar un valor y ver cómo se propaga por los cables, abrir
   una tarjeta del tablero. Lo que en su vídeo es interacción simulada, en Magister la haces tú.
8. **Pantallas de síntesis** con la rejilla del tablero: tarjeta por idea, microdiagrama en cada una, ✓ a
   medida que avanzas. Sirve de portada de la lección y de cierre.
