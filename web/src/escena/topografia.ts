// Topografía · Coordenadas, como guion gráfico: del acimut y la distancia a las coordenadas, el problema inverso con
// su cuadrante y la poligonal cerrada con su error de cierre y su compensación. Ángulos en gon (centesimales), como se
// trabaja en topografía en España. Todas las cuentas están hechas y comprobadas en Python (18-11-2026).
import type { GuionGrafico, Tablero } from './tipos.ts'

const r = String.raw

const PARTES: Tablero['partes'] = [
  { nombre: 'Medir', ideas: [{ nombre: 'El acimut', que: 'desde el norte, con el reloj' }] },
  {
    nombre: 'Calcular',
    ideas: [
      { nombre: 'Problema directo', que: 'de θ y D a un punto' },
      { nombre: 'Problema inverso', que: 'de dos puntos a θ y D' },
    ],
  },
  {
    nombre: 'Encadenar',
    ideas: [
      { nombre: 'Poligonal', que: 'de punto en punto' },
      { nombre: 'Error de cierre', que: 'la vuelta no cierra' },
      { nombre: 'Compensar', que: 'repartir según D' },
    ],
  },
]

// Los puntos de la obra (metros).
const A = { tipo: 'punto' as const, id: 'A', x: 1000, y: 2000, etiqueta: 'A', coords: '(1000,000 ; 2000,000)', lado: 'o' as const }
const B = { x: 1121.353, y: 2088.168 }

export const DEMO_TOPOGRAFIA: GuionGrafico = {
  titulo: 'Topografía · Coordenadas',
  tramos: [
    // ===== Parte 1: medir =====
    {
      concepto: 'Coordenadas',
      tesis: 'seis ideas en tres partes',
      narracion:
        'En topografía casi todo acaba en coordenadas: dónde está cada punto, en metros, sobre un plano. Esta lección son seis ideas en tres partes: medir, calcular, y encadenar puntos sin que el error se acumule.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 0 },
    },
    {
      concepto: 'El replanteo',
      tesis: 'llegar a un punto que aún no está',
      narracion:
        'Lucía es topógrafa en una obra. Tiene la estación en el punto A, de coordenadas conocidas: mil, dos mil. Tiene que marcar en el suelo el punto B, donde irá una esquina del edificio. Desde A solo puede medir una dirección y una distancia.',
      escena: {
        tipo: 'figura',
        elementos: [
          { ...A, paso: 0 },
          { tipo: 'norte', en: 'A', paso: 1 },
          { tipo: 'punto', id: 'B', ...B, etiqueta: 'B ?', lado: 'e', estado: 'foco', paso: 2 },
          { tipo: 'segmento', de: 'A', a: 'B', etiqueta: 'D = 150,000 m', discontinuo: true, flecha: true, paso: 3 },
        ],
      },
    },
    {
      concepto: 'El acimut',
      tesis: 'desde el norte, con el reloj',
      narracion:
        'La dirección se da con el acimut: el ángulo desde el norte hasta la visual, girando como las agujas del reloj. En topografía se mide en grados centesimales, o gon: la vuelta entera son cuatrocientos. El este está a cien, el sur a doscientos y el oeste a trescientos. B está a sesenta gon.',
      escena: {
        tipo: 'figura',
        ancho: 700,
        elementos: [
          { ...A, coords: undefined, lado: 's', paso: 0 },
          { tipo: 'punto', id: 'N', x: 1000, y: 2100, etiqueta: 'N · 0 g', lado: 'n', paso: 1 },
          { tipo: 'punto', id: 'E', x: 1100, y: 2000, etiqueta: 'E · 100 g', lado: 'e', paso: 1 },
          { tipo: 'punto', id: 'S', x: 1000, y: 1900, etiqueta: 'S · 200 g', lado: 's', paso: 1 },
          { tipo: 'punto', id: 'O', x: 900, y: 2000, etiqueta: 'O · 300 g', lado: 'o', paso: 1 },
          { tipo: 'segmento', de: 'A', a: 'N', estado: 'nuevo', discontinuo: true, paso: 1 },
          { tipo: 'segmento', de: 'A', a: 'E', discontinuo: true, paso: 1 },
          { tipo: 'segmento', de: 'A', a: 'S', discontinuo: true, paso: 1 },
          { tipo: 'segmento', de: 'A', a: 'O', discontinuo: true, paso: 1 },
          { tipo: 'angulo', vertice: 'A', desde: 0, hasta: 300, etiqueta: '', radio: 34, estado: 'nuevo', paso: 2 },
          { tipo: 'punto', id: 'B', x: 1000 + 85 * Math.sin(0.3 * Math.PI), y: 2000 + 85 * Math.cos(0.3 * Math.PI), etiqueta: 'B', lado: 'e', paso: 3 },
          { tipo: 'segmento', de: 'A', a: 'B', flecha: true, estado: 'foco', paso: 3 },
          { tipo: 'angulo', vertice: 'A', desde: 0, hasta: 60, etiqueta: 'θ = 60 g', radio: 70, estado: 'foco', paso: 4 },
        ],
      },
    },
    {
      concepto: 'Dos ceros distintos',
      tesis: 'el norte no es el eje X',
      narracion:
        'Aquí está la trampa. En clase de matemáticas el ángulo sale del eje X, el este, y gira al revés que el reloj. El acimut sale del norte y gira con el reloj. Al cambiar de dónde se mide, el seno y el coseno se cambian el papel: en topografía, el seno va con la X.',
      escena: {
        tipo: 'contraste',
        lados: [
          { etiqueta: 'Matemáticas', lineas: ['sale del eje X (el este)', 'gira contra el reloj', 'x = r · cos α', 'y = r · sen α', 'vuelta: 360°'] },
          { etiqueta: 'Topografía', estado: 'foco', lineas: ['sale del norte (eje Y)', 'gira con el reloj', 'ΔX = D · sen θ', 'ΔY = D · cos θ', 'vuelta: 400 g (gon)'] },
        ],
        veredicto: 'Por eso el seno va con la X',
      },
    },

    // ===== Parte 2: calcular =====
    {
      concepto: 'Coordenadas',
      tesis: 'segunda parte: calcular',
      narracion: 'Con eso ya puedes calcular. Segunda parte: los dos problemas que se resuelven a diario en una obra, el directo y el inverso.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 1 },
    },
    {
      concepto: 'Problema directo',
      tesis: 'de una dirección a dos números',
      narracion:
        'El problema directo: conoces A, el acimut y la distancia, y buscas B. Proyectas la distancia sobre los dos ejes. Hacia el este, la distancia por el seno del acimut. Hacia el norte, la distancia por el coseno. Y sumas esos incrementos a las coordenadas de A.',
      escena: {
        tipo: 'formula',
        formulas: [
          { tex: r`\Delta X = D \cdot \sin\theta` },
          { tex: r`\Delta Y = D \cdot \cos\theta` },
          { tex: r`X_B = X_A + \Delta X \qquad Y_B = Y_A + \Delta Y`, estado: 'foco' },
        ],
        simbolos: [
          { simbolo: r`\theta`, significa: 'acimut de A a B, desde el norte, con el reloj (gon)' },
          { simbolo: r`D`, significa: 'distancia reducida al horizonte (m)' },
          { simbolo: r`\Delta X`, significa: 'cuánto se avanza hacia el este (m)' },
          { simbolo: r`\Delta Y`, significa: 'cuánto se avanza hacia el norte (m)' },
        ],
      },
    },
    {
      concepto: 'Por dentro',
      tesis: 'el triángulo de las proyecciones',
      narracion:
        'Por dentro es un triángulo rectángulo. La visual de A a B es la hipotenusa. El acimut está en A, contado desde el norte, así que el cateto pegado a él es el que sube hacia el norte: lleva el coseno. El de enfrente, el que va hacia el este, lleva el seno.',
      escena: {
        tipo: 'figura',
        elementos: [
          { ...A, coords: undefined, lado: 's', paso: 0 },
          { tipo: 'punto', id: 'B', ...B, etiqueta: 'B', lado: 'e', paso: 0 },
          { tipo: 'norte', en: 'A', largo: 200, paso: 0 },
          { tipo: 'segmento', de: 'A', a: 'B', etiqueta: 'D = 150 m', etiqueta_lado: 'derecha', flecha: true, paso: 0 },
          { tipo: 'angulo', vertice: 'A', desde: 0, hasta: 60, etiqueta: 'θ', radio: 60, estado: 'foco', paso: 1 },
          { tipo: 'proyeccion', de: 'A', a: 'B', etiqueta_y: 'ΔY = D · cos θ', etiqueta_x: 'ΔX = D · sen θ', paso: 2 },
        ],
      },
    },
    {
      concepto: 'La cuenta',
      tesis: 'B, a 150 metros',
      narracion:
        'Con los números de Lucía: acimut sesenta gon, distancia ciento cincuenta metros. El incremento de X sale ciento veintiuno con trescientos cincuenta y tres; el de Y, ochenta y ocho con ciento sesenta y ocho. B queda en mil ciento veintiuno con trescientos cincuenta y tres, dos mil ochenta y ocho con ciento sesenta y ocho. Y la calculadora, en modo gon.',
      escena: {
        tipo: 'calculo',
        datos: 'A = (1000,000 ; 2000,000) · θ = 60,0000 g · D = 150,000 m',
        filas: [
          { que: r`\Delta X = D\sin\theta`, sustitucion: r`150{,}000 \cdot \sin 60{,}0000^{g}`, resultado: r`+121{,}353\ \text{m}` },
          { que: r`\Delta Y = D\cos\theta`, sustitucion: r`150{,}000 \cdot \cos 60{,}0000^{g}`, resultado: r`+88{,}168\ \text{m}` },
          { que: r`X_B = X_A + \Delta X`, sustitucion: r`1000{,}000 + 121{,}353`, resultado: r`1121{,}353\ \text{m}`, estado: 'bien' },
          { que: r`Y_B = Y_A + \Delta Y`, sustitucion: r`2000{,}000 + 88{,}168`, resultado: r`2088{,}168\ \text{m}`, estado: 'bien' },
        ],
        nota: '60 gon son 54°: la calculadora, en modo GRAD, o pasa los gon a grados antes (× 0,9).',
      },
    },
    {
      concepto: 'El error típico',
      tesis: 'seno y coseno al revés',
      narracion:
        'Ahora el intento ingenuo: Lucía usa la fórmula de matemáticas, con el coseno para la X. El punto sale reflejado respecto a la diagonal y cae a casi cuarenta y siete metros del bueno. La esquina del edificio, en la parcela de al lado.',
      escena: {
        tipo: 'figura',
        elementos: [
          { ...A, coords: undefined, lado: 's', paso: 0 },
          { tipo: 'norte', en: 'A', paso: 0 },
          { tipo: 'punto', id: 'B', ...B, etiqueta: 'B (bien)', lado: 'e', estado: 'bien', paso: 0 },
          { tipo: 'segmento', de: 'A', a: 'B', estado: 'bien', flecha: true, paso: 0 },
          { tipo: 'punto', id: 'Bm', x: 1088.168, y: 2121.353, etiqueta: 'B′ (cos con la X)', lado: 'n', estado: 'mal', paso: 1 },
          { tipo: 'segmento', de: 'A', a: 'Bm', estado: 'mal', discontinuo: true, flecha: true, paso: 1 },
          { tipo: 'segmento', de: 'Bm', a: 'B', etiqueta: '46,93 m', estado: 'mal', discontinuo: true, paso: 2 },
        ],
      },
    },
    {
      concepto: 'Al revés',
      tesis: 'de dos puntos a una dirección',
      narracion:
        'Y la pregunta contraria, la de todos los días: tienes las coordenadas de dos puntos. ¿Qué acimut y qué distancia los unen?',
      escena: { tipo: 'pregunta', pregunta: 'Tienes dos puntos con coordenadas. ¿Qué acimut y qué distancia los unen?', pista: 'Es lo que haces al orientar la estación o al comprobar un replanteo.' },
    },
    {
      concepto: 'Problema inverso',
      tesis: 'Pitágoras y un arco tangente',
      narracion:
        'La distancia sale por Pitágoras: la raíz de la suma de los cuadrados de los incrementos. El acimut, con el arco tangente del incremento de X entre el de Y. Pero ese arco tangente esconde una trampa.',
      escena: {
        tipo: 'formula',
        formulas: [
          { tex: r`D = \sqrt{\Delta X^2 + \Delta Y^2}` },
          { tex: r`\alpha = \arctan\left|\frac{\Delta X}{\Delta Y}\right|` },
          { tex: r`\theta = \alpha \text{ colocado en su cuadrante}`, estado: 'foco' },
        ],
        simbolos: [
          { simbolo: r`\Delta X,\ \Delta Y`, significa: 'coordenadas del final menos las del principio' },
          { simbolo: r`\alpha`, significa: 'ángulo auxiliar, entre 0 y 100 g' },
        ],
      },
    },
    {
      concepto: 'La cuenta',
      tesis: 'de A a C',
      narracion:
        'Lucía quiere orientarse de A a C, que está en novecientos sesenta, mil novecientos diez. Los incrementos son menos cuarenta y menos noventa. La distancia, noventa y ocho con cuatrocientos ochenta y nueve metros. El arco tangente de cuarenta entre noventa da veintiséis con seis mil doscientos cincuenta gon. Pero el acimut bueno es doscientos veintiséis con seis mil doscientos cincuenta.',
      escena: {
        tipo: 'calculo',
        datos: 'A = (1000,000 ; 2000,000) · C = (960,000 ; 1910,000)',
        filas: [
          { que: r`\Delta X = X_C - X_A`, sustitucion: r`960 - 1000`, resultado: r`-40{,}000\ \text{m}` },
          { que: r`\Delta Y = Y_C - Y_A`, sustitucion: r`1910 - 2000`, resultado: r`-90{,}000\ \text{m}` },
          { que: r`D`, sustitucion: r`\sqrt{40^2 + 90^2}`, resultado: r`98{,}489\ \text{m}` },
          { que: r`\alpha`, sustitucion: r`\arctan\tfrac{40}{90}`, resultado: r`26{,}6250^{g}`, estado: 'foco' },
          { que: r`\theta_{AC}`, sustitucion: r`200^{g} + 26{,}6250^{g}`, resultado: r`226{,}6250^{g}`, estado: 'bien' },
        ],
      },
    },
    {
      concepto: 'El cuadrante',
      tesis: 'la calculadora no lo sabe',
      narracion:
        'Mira el dibujo. Los dos incrementos son negativos: C está al suroeste. Pero menos cuarenta entre menos noventa es lo mismo que cuarenta entre noventa, y la calculadora te devuelve una dirección al noreste. Te mandaría justo al lado contrario.',
      escena: {
        tipo: 'figura',
        elementos: [
          { ...A, coords: undefined, lado: 'e', paso: 0 },
          { tipo: 'norte', en: 'A', largo: 90, paso: 0 },
          { tipo: 'punto', id: 'C', x: 960, y: 1910, etiqueta: 'C · 226,6250 g', lado: 'o', estado: 'bien', paso: 0 },
          { tipo: 'segmento', de: 'A', a: 'C', estado: 'bien', flecha: true, paso: 0 },
          { tipo: 'angulo', vertice: 'A', desde: 0, hasta: 226.625, etiqueta: '', radio: 45, estado: 'bien', paso: 1 },
          { tipo: 'punto', id: 'Cm', x: 1040, y: 2090, etiqueta: 'lo que da arctan: 26,6250 g', lado: 'e', estado: 'mal', paso: 2 },
          { tipo: 'segmento', de: 'A', a: 'Cm', estado: 'mal', discontinuo: true, flecha: true, paso: 2 },
        ],
      },
    },
    {
      concepto: 'Los cuatro cuadrantes',
      tesis: 'mira los signos antes',
      narracion:
        'Por eso, antes del arco tangente, mira los signos. Calculas el ángulo con los valores absolutos, que sale entre cero y cien, y lo colocas según el cuadrante: tal cual al noreste; doscientos menos él al sureste; doscientos más él al suroeste; y cuatrocientos menos él al noroeste.',
      escena: {
        tipo: 'pasos',
        pasos: [
          { texto: 'ΔX + y ΔY +   →   noreste   →   θ = α', detalle: 'C cae arriba a la derecha de A' },
          { texto: 'ΔX + y ΔY −   →   sureste   →   θ = 200 − α', detalle: 'abajo a la derecha' },
          { texto: 'ΔX − y ΔY −   →   suroeste   →   θ = 200 + α', detalle: 'el caso de C: 200 + 26,6250 = 226,6250 g' },
          { texto: 'ΔX − y ΔY +   →   noroeste   →   θ = 400 − α', detalle: 'arriba a la izquierda' },
        ],
      },
    },

    // ===== Parte 3: encadenar =====
    {
      concepto: 'Coordenadas',
      tesis: 'tercera parte: encadenar',
      narracion:
        'Con un solo tramo no hay sorpresas. Pero en una obra no se ve todo desde A: hay que ir de punto en punto. Tercera parte: la poligonal, y el error que se va acumulando.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 3 },
    },
    {
      concepto: 'Poligonal',
      tesis: 'de punto en punto, y vuelta a A',
      narracion:
        'Lucía hace una poligonal cerrada: de A a B, de B a P, de P a Q, y de vuelta a A. En cada estación mide acimut y distancia y aplica el problema directo. Si todo fuera perfecto, acabaría exactamente en A. No acaba en A: acaba un poco al lado.',
      escena: {
        tipo: 'figura',
        elementos: [
          { ...A, coords: undefined, lado: 'o', paso: 0 },
          { tipo: 'punto', id: 'B', ...B, etiqueta: 'B', lado: 'n', paso: 0 },
          { tipo: 'punto', id: 'P', x: 1210, y: 1985, etiqueta: 'P', lado: 'e', paso: 1 },
          { tipo: 'punto', id: 'Q', x: 1075, y: 1890, etiqueta: 'Q', lado: 's', paso: 2 },
          { tipo: 'segmento', de: 'A', a: 'B', flecha: true, paso: 0 },
          { tipo: 'segmento', de: 'B', a: 'P', flecha: true, paso: 1 },
          { tipo: 'segmento', de: 'P', a: 'Q', flecha: true, paso: 2 },
          { tipo: 'punto', id: 'A2', x: 1024, y: 1968, etiqueta: 'A′', lado: 'e', estado: 'mal', paso: 3 },
          { tipo: 'segmento', de: 'Q', a: 'A2', flecha: true, paso: 3 },
          { tipo: 'segmento', de: 'A2', a: 'A', estado: 'mal', paso: 4 },
          { tipo: 'texto', x: 935, y: 1972, texto: 'error de cierre, ×400', tamano: 18, estado: 'mal', paso: 4 },
        ],
      },
    },
    {
      concepto: 'La libreta',
      tesis: 'cuatro tramos, y no suma cero',
      narracion:
        'Esta es su libreta: cada tramo con su distancia, su acimut y sus incrementos. Como la vuelta empieza y acaba en A, la suma de los incrementos de X debería dar cero, y la de Y también. Dan sesenta milímetros y menos ochenta.',
      escena: {
        tipo: 'tabla',
        nombre: 'libreta de la poligonal',
        columnas: ['tramo', 'D (m)', 'θ (g)', 'ΔX (m)', 'ΔY (m)'],
        filas: [
          ['A → B', '150,002', '60,0136', '+121,373', '+88,143'],
          ['B → P', '136,040', '154,8113', '+88,657', '−103,183'],
          ['P → Q', '165,074', '260,9511', '−134,982', '−95,022'],
          ['Q → A', '133,114', '361,9034', '−74,988', '+109,982'],
          ['Σ', '584,230', '', '+0,060', '−0,080'],
        ],
      },
    },
    {
      concepto: 'Error de cierre',
      tesis: 'cuánto, y si se acepta',
      narracion:
        'Esas sumas son el error de cierre en cada eje. Juntas, por Pitágoras, dan diez centímetros. Parece mucho, pero hay que compararlo con lo recorrido: diez centímetros en quinientos ochenta y cuatro metros es uno entre cinco mil ochocientos cuarenta y dos. La obra pide al menos uno entre cinco mil, así que se acepta.',
      escena: {
        tipo: 'calculo',
        datos: 'La vuelta empieza y acaba en A: las dos sumas deberían dar cero.',
        filas: [
          { que: r`e_X = \textstyle\sum \Delta X`, sustitucion: r`121{,}373 + 88{,}657 - 134{,}982 - 74{,}988`, resultado: r`+0{,}060\ \text{m}`, estado: 'mal' },
          { que: r`e_Y = \textstyle\sum \Delta Y`, sustitucion: r`88{,}143 - 103{,}183 - 95{,}022 + 109{,}982`, resultado: r`-0{,}080\ \text{m}`, estado: 'mal' },
          { que: r`e = \sqrt{e_X^2 + e_Y^2}`, sustitucion: r`\sqrt{0{,}060^2 + 0{,}080^2}`, resultado: r`0{,}100\ \text{m}` },
          { que: r`e \,/ \textstyle\sum D`, sustitucion: r`0{,}100 \,/\, 584{,}230`, resultado: r`1/5842`, estado: 'bien' },
        ],
        nota: 'Tolerancia de la obra: 1/5.000. Como 1/5.842 es menor, se acepta y se compensa.',
      },
    },
    {
      concepto: 'Compensar',
      tesis: 'repartir según la distancia',
      narracion:
        'Aceptado, el error se reparte. El método más usado lo reparte en proporción a la longitud de cada tramo, con el signo contrario al error: un tramo largo ha acumulado más, así que corrige más. Es la compensación proporcional, o regla de Bowditch.',
      escena: {
        tipo: 'formula',
        formulas: [
          { tex: r`c_{X,i} = -\,e_X \cdot \frac{D_i}{\sum D}` },
          { tex: r`c_{Y,i} = -\,e_Y \cdot \frac{D_i}{\sum D}` },
          { tex: r`\textstyle\sum c_X = -e_X \qquad \sum c_Y = -e_Y`, estado: 'foco' },
        ],
        simbolos: [
          { simbolo: r`c_{X,i}`, significa: 'corrección del incremento de X del tramo i' },
          { simbolo: r`D_i`, significa: 'longitud del tramo i' },
        ],
      },
    },
    {
      concepto: 'La cuenta',
      tesis: 'cada tramo, su parte',
      narracion:
        'Para el primer tramo: menos sesenta milímetros por ciento cincuenta entre quinientos ochenta y cuatro, unos quince milímetros menos en X; y veintiuno más en Y. Igual con los demás. Las correcciones suman justo el error, con el signo cambiado.',
      escena: {
        tipo: 'calculo',
        datos: 'Cada tramo corrige en proporción a su longitud, con el signo contrario al error.',
        filas: [
          { que: r`c_X(A\!\to\!B)`, sustitucion: r`-0{,}060 \cdot \tfrac{150{,}002}{584{,}230}`, resultado: r`-0{,}015\ \text{m}` },
          { que: r`c_Y(A\!\to\!B)`, sustitucion: r`+0{,}080 \cdot \tfrac{150{,}002}{584{,}230}`, resultado: r`+0{,}021\ \text{m}` },
          { que: r`c_X(P\!\to\!Q)`, sustitucion: r`-0{,}060 \cdot \tfrac{165{,}074}{584{,}230}`, resultado: r`-0{,}017\ \text{m}` },
          { que: r`\textstyle\sum c_X,\ \sum c_Y`, sustitucion: r`\text{los cuatro tramos}`, resultado: r`-0{,}060;\ +0{,}080`, estado: 'bien' },
        ],
      },
    },
    {
      concepto: 'Compensado',
      tesis: 'la vuelta cierra',
      narracion:
        'Con los incrementos corregidos, las coordenadas se encadenan de nuevo y la vuelta cierra exactamente en A: mil, dos mil. Ahora Lucía tiene las coordenadas de B, P y Q para replantear.',
      escena: {
        tipo: 'tabla',
        nombre: 'poligonal compensada',
        columnas: ['tramo', 'ΔX comp. (m)', 'ΔY comp. (m)', 'X (m)', 'Y (m)'],
        filas: [
          ['A → B', '+121,358', '+88,164', '1121,358', '2088,164'],
          ['B → P', '+88,643', '−103,164', '1210,001', '1985,000'],
          ['P → Q', '−134,999', '−94,999', '1075,002', '1890,001'],
          ['Q → A', '−75,002', '+109,999', '1000,000', '2000,000'],
          ['Σ', '0,000', '0,000', 'vuelve a A', '✓'],
        ],
      },
    },
    {
      concepto: 'El método',
      tesis: 'cinco pasos',
      narracion:
        'El método entero: mide acimuts y distancias. Calcula los incrementos, con el seno para la X y el coseno para la Y. Suma: es el error de cierre. Compáralo con la tolerancia. Y si se acepta, compensa en proporción a las distancias y calcula las coordenadas.',
      escena: {
        tipo: 'pasos',
        pasos: [
          { texto: 'Medir acimut y distancia en cada tramo', detalle: 'ángulos en gon, distancias reducidas al horizonte' },
          { texto: 'ΔX = D · sen θ,  ΔY = D · cos θ', detalle: 'el seno con la X: el acimut sale del norte' },
          { texto: 'Sumar los incrementos: el error de cierre', detalle: 'en una poligonal cerrada, deberían dar cero' },
          { texto: 'Comparar e / ΣD con la tolerancia', detalle: '1/5.842 frente a 1/5.000: se acepta' },
          { texto: 'Compensar según la distancia y encadenar', detalle: 'la vuelta tiene que cerrar en A' },
        ],
      },
    },
    {
      concepto: 'Coordenadas',
      tesis: 'seis ideas, hechas',
      narracion:
        'Recapitula. El acimut sale del norte y gira con el reloj; por eso el seno va con la X. El problema directo proyecta; el inverso usa Pitágoras y mira el cuadrante. Y en una poligonal, el error de cierre se mide, se compara con la tolerancia y se reparte según la distancia.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 5, hechas_tambien: true },
    },
  ],
}
