// L5 · Índices y EXPLAIN, como guion gráfico. Escrito a mano con el método del núcleo (problema, intento ingenuo,
// la respuesta y su nombre; un ejemplo conductor; por dentro; el mapa que vuelve). Las cifras están medidas en el
// Postgres 16 de Magister, sobre una tabla temporal de 1.000.000 de pedidos (18-11-2026).
import type { GuionGrafico, Tablero } from './tipos.ts'

const PARTES: Tablero['partes'] = [
  { nombre: 'El problema', ideas: [{ nombre: 'Leerlo todo', que: 'la lectura secuencial' }] },
  {
    nombre: 'El índice',
    ideas: [
      { nombre: 'Una copia ordenada', que: 'cada valor, con su fila' },
      { nombre: 'El árbol B', que: 'tres saltos' },
      { nombre: 'Su precio', que: 'cada escritura, otra más' },
    ],
  },
  {
    nombre: 'Usarlo bien',
    ideas: [
      { nombre: 'Índice compuesto', que: 'el orden importa' },
      { nombre: 'Cuándo no se usa', que: 'tres trampas' },
      { nombre: 'EXPLAIN', que: 'pregúntale cómo' },
    ],
  },
]

const COLUMNAS = ['id', 'cliente', 'fecha', 'total']
const FILAS = [
  ['14', 'Luis', '2026-01-15', '84,10'],
  ['15', 'Lucía', '2026-01-16', '12,99'],
  ['16', 'Hugo', '2026-01-17', '130,25'],
  ['17', 'Ana', '2026-01-18', '45,00'],
  ['18', 'Sara', '2026-01-19', '9,90'],
  ['19', 'Pablo', '2026-01-20', '61,40'],
  ['20', 'Iván', '2026-01-21', '22,00'],
  ['21', 'Marta', '2026-01-22', '150,75'],
]
const CONSULTA = ['SELECT *', 'FROM pedidos', "WHERE cliente = 'Ana';"]

export const DEMO_INDICES: GuionGrafico = {
  titulo: 'L5 · Índices y EXPLAIN',
  tramos: [
    // ===== Parte 1: el problema =====
    {
      concepto: 'Índices',
      tesis: 'siete ideas en tres partes',
      narracion:
        'Cuando una consulta va lenta, casi siempre es por lo mismo: la base de datos lee mucho más de lo que necesita. Esta lección son siete ideas en tres partes: el problema, el índice y cómo usarlo bien.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 0 },
    },
    {
      concepto: 'La tienda',
      tesis: 'un millón de pedidos',
      narracion:
        'El ejemplo de toda la lección es una tienda con una tabla de pedidos. Cada pedido tiene su id, el cliente, la fecha y el total. Ya va por un millón de filas. Y Ana, una clienta fiel, tiene doce pedidos repartidos por toda la tabla.',
      escena: { tipo: 'tabla', nombre: 'pedidos', columnas: COLUMNAS, filas: FILAS, resto: '999.992 filas más' },
    },
    {
      concepto: 'Los pedidos de Ana',
      tesis: '90 milisegundos para 12 filas',
      narracion:
        'Su página pide sus pedidos con esta consulta. Devuelve doce filas y tarda noventa milisegundos, medido en un Postgres de verdad. Parece poco, hasta que la página se abre mil veces por minuto y cada vez paga lo mismo.',
      escena: {
        tipo: 'consulta',
        sql: CONSULTA,
        salida_titulo: 'resultado',
        salida: [{ texto: ' id     | cliente | fecha      | total' }, { texto: ' 17     | Ana     | 2026-01-18 | 45,00' }, { texto: ' 90412  | Ana     | 2026-03-05 | 19,90' }, { texto: ' … 12 filas' }],
        metrica: { etiqueta: 'tiempo', valor: '90 ms', estado: 'mal' },
      },
    },
    {
      concepto: 'Por dentro',
      tesis: 'fila a fila, el millón entero',
      narracion:
        '¿Por qué tanto? Porque la base de datos no sabe dónde están las filas de Ana. Así que las lee todas, una a una, y se queda con las que coinciden: lee un millón para quedarse con doce. Esto se llama lectura secuencial; en el plan lo verás como Seq Scan.',
      escena: {
        tipo: 'tabla',
        nombre: 'pedidos',
        columnas: COLUMNAS,
        filas: FILAS,
        resto: '999.992 filas más',
        escaneo: { coincide: [3], leidas: 1000000, encontradas: 12 },
      },
    },
    {
      concepto: 'Leerlo todo',
      tesis: 'el coste crece con la tabla',
      narracion:
        'Y lo peor es cómo crece. Con mil pedidos, lees mil filas. Con un millón, un millón. Si la tienda va bien y llega a cien millones, la página de Ana leerá cien millones de filas para enseñar las mismas doce. El coste crece con la tabla, no con lo que buscas.',
      escena: {
        tipo: 'barras',
        titulo: 'filas leídas para encontrar los 12 pedidos de Ana',
        escala: 'log',
        barras: [
          { etiqueta: 'mil pedidos', valor: 1000, texto: '1.000' },
          { etiqueta: 'un millón', valor: 1000000, texto: '1.000.000', estado: 'foco' },
          { etiqueta: 'cien millones', valor: 100000000, texto: '100.000.000', estado: 'mal' },
        ],
      },
    },
    {
      concepto: 'La pregunta',
      tesis: '¿cómo saltar a Ana?',
      narracion:
        'Así que la pregunta es esta: ¿cómo encuentras las doce filas de Ana sin leer el millón? Piensa en cómo buscas un tema en un libro de seiscientas páginas.',
      escena: { tipo: 'pregunta', pregunta: '¿Cómo encuentras las 12 filas de Ana sin leer el millón?', pista: 'Piensa en cómo buscas un tema en un libro de 600 páginas.' },
    },

    // ===== Parte 2: el índice =====
    {
      concepto: 'Índices',
      tesis: 'segunda parte: el índice',
      narracion:
        'No lo lees entero: vas al índice del final, que está ordenado y te dice la página. La base de datos hace exactamente lo mismo, y esa es la segunda parte.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 1 },
    },
    {
      concepto: 'Una copia ordenada',
      tesis: 'cada valor apunta a su fila',
      narracion:
        'Un índice es una copia de una columna, ordenada, en la que cada valor apunta a su fila. Como está ordenada, todas las Ana están juntas, al principio. Encuentras la primera y sigues las flechas: saltos directos a sus filas, estén donde estén en la tabla.',
      escena: {
        tipo: 'indice',
        nombre: 'idx_pedidos_cliente',
        columnas: ['cliente'],
        entradas: [
          { clave: ['Ana'], fila: 17 },
          { clave: ['Ana'], fila: 90412 },
          { clave: ['Ana'], fila: 230001 },
          { clave: [], fila: null },
          { clave: ['Hugo'], fila: 16 },
          { clave: ['Lucía'], fila: 15 },
          { clave: ['Sara'], fila: 18 },
          { clave: [], fila: null },
        ],
        tabla: {
          nombre: 'pedidos',
          columnas: ['id', 'cliente', 'fecha'],
          filas: [
            { id: 15, celdas: ['Lucía', '2026-01-16'] },
            { id: 16, celdas: ['Hugo', '2026-01-17'] },
            { id: 17, celdas: ['Ana', '2026-01-18'] },
            { id: 18, celdas: ['Sara', '2026-01-19'] },
            { id: null, celdas: [] },
            { id: 90412, celdas: ['Ana', '2026-03-05'] },
            { id: null, celdas: [] },
            { id: 230001, celdas: ['Ana', '2026-06-20'] },
            { id: null, celdas: [] },
          ],
        },
        buscar: 'Ana',
      },
    },
    {
      concepto: 'Ordenada',
      tesis: 'partir por la mitad, veinte veces',
      narracion:
        '¿Y cómo encuentras la primera Ana en una lista ordenada de un millón? Partiéndola por la mitad: miras el centro, decides en qué mitad está y descartas la otra. Cada paso deja la mitad. En veinte pasos, de un millón te quedas en una sola entrada.',
      escena: { tipo: 'mitades', total: 1000000, objetivo: 'Ana', desde: 'Aarón', hasta: 'Zoe' },
    },
    {
      concepto: 'El árbol B',
      tesis: 'tres saltos, no veinte',
      narracion:
        'Pero las bases de datos no guardan una lista plana: guardan un árbol B. Cada nodo es una página del disco con cientos de claves, así que se baja muy deprisa. El índice de los pedidos tiene tres niveles: la raíz, uno intermedio y las hojas. Tres saltos, y estás en Ana.',
      escena: {
        tipo: 'arbol',
        niveles: [
          [['F', 'M', 'S']],
          [['B', 'C', 'D', 'E'], ['G', 'H', 'J', 'L'], ['N', 'O', 'P', 'R'], ['T', 'U', 'V', 'X']],
          [['Aarón', 'Alba'], ['Ana', 'Ana', 'Ana'], ['Andrés', 'Ariadna'], ['Arturo', 'Ayla']],
        ],
        camino: [0, 0, 1],
        hoja: 'Ana → filas 17, 90412, 230001…',
        nota: 'Cada nodo es una página de 8 KB. El índice de los pedidos: 1.144 páginas en 3 niveles.',
      },
    },
    {
      concepto: 'CREATE INDEX',
      tesis: 'de 90 ms a 0,08',
      narracion:
        'Crearlo es una línea. La misma consulta pasa de noventa milisegundos a menos de una décima de milisegundo: más de mil veces más rápida. Y el índice ocupa nueve megas, frente a los sesenta y seis de la tabla.',
      escena: {
        tipo: 'consulta',
        sql: ['CREATE INDEX idx_pedidos_cliente', '  ON pedidos (cliente);', '', ...CONSULTA],
        salida_titulo: 'resultado',
        salida: [{ texto: ' 12 filas, las mismas', estado: 'bien' }, { texto: ' índice: 9 MB · tabla: 66 MB' }],
        metrica: { etiqueta: 'tiempo', valor: '0,078 ms', estado: 'bien', antes: '90 ms' },
      },
    },
    {
      concepto: 'Su precio',
      tesis: 'cada índice, una escritura más',
      narracion:
        'Pero nada sale gratis. Cada vez que entra un pedido, Postgres escribe la fila y, además, la mete en su sitio en cada índice, que tiene que seguir ordenado. Un índice más es una escritura más en cada INSERT, UPDATE y DELETE.',
      escena: {
        tipo: 'consulta',
        sql: ['INSERT INTO pedidos', "VALUES (1000001, 'Ana',", "        '2026-11-18', 39.90);"],
        salida_titulo: 'lo que hace Postgres',
        salida: [
          { texto: '1. escribe la fila en pedidos' },
          { texto: "2. mete 'Ana' en idx_pedidos_cliente", estado: 'foco' },
          { texto: '3. y lo mismo en cada índice que tengas', estado: 'foco' },
        ],
        metrica: { etiqueta: 'escrituras por pedido', valor: '1 + índices', estado: 'foco' },
      },
    },
    {
      concepto: 'Su precio',
      tesis: 'tres índices, nueve veces más lento',
      narracion:
        'Medido: insertar doscientos mil pedidos tarda ciento veinticinco milisegundos sin índices y más de un segundo con tres. Por eso no se indexa todo: se indexa lo que buscas a menudo.',
      escena: {
        tipo: 'barras',
        titulo: 'insertar 200.000 pedidos',
        escala: 'lineal',
        barras: [
          { etiqueta: 'sin índices', valor: 125, texto: '125 ms', estado: 'bien' },
          { etiqueta: 'con tres índices', valor: 1166, texto: '1.166 ms', estado: 'mal' },
        ],
      },
    },

    // ===== Parte 3: usarlo bien =====
    {
      concepto: 'Índices',
      tesis: 'tercera parte: usarlo bien',
      narracion:
        'Ya tienes el índice y sabes lo que cuesta. Falta la parte en la que más se falla: tener el índice y que la base de datos no lo use.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 4 },
    },
    {
      concepto: 'Índice compuesto',
      tesis: 'por cliente, y luego por fecha',
      narracion:
        'Muchas consultas filtran por dos columnas: los pedidos de Ana desde junio. Un índice compuesto ordena por la primera columna y, dentro de cada valor, por la segunda. Todas las Ana juntas y, entre ellas, por fecha: saltas a Ana en junio y lees solo lo que pides.',
      escena: {
        tipo: 'indice',
        nombre: 'idx_pedidos_cliente_fecha',
        columnas: ['cliente', 'fecha'],
        entradas: [
          { clave: ['Ana', '2026-01-18'], fila: 17 },
          { clave: ['Ana', '2026-03-05'], fila: 90412 },
          { clave: ['Ana', '2026-06-20'], fila: 230001 },
          { clave: ['Ana', '2026-08-11'], fila: 311223 },
          { clave: [], fila: null },
          { clave: ['Hugo', '2026-01-17'], fila: 16 },
          { clave: ['Lucía', '2026-01-16'], fila: 15 },
          { clave: [], fila: null },
        ],
        tabla: {
          nombre: 'pedidos',
          columnas: ['id', 'cliente', 'fecha'],
          filas: [
            { id: 16, celdas: ['Hugo', '2026-01-17'] },
            { id: 17, celdas: ['Ana', '2026-01-18'] },
            { id: 18, celdas: ['Sara', '2026-01-19'] },
            { id: null, celdas: [] },
            { id: 90412, celdas: ['Ana', '2026-03-05'] },
            { id: null, celdas: [] },
            { id: 230001, celdas: ['Ana', '2026-06-20'] },
            { id: 311223, celdas: ['Ana', '2026-08-11'] },
            { id: null, celdas: [] },
          ],
        },
        marcar: [2, 3],
      },
    },
    {
      concepto: 'La guía telefónica',
      tesis: 'el apellido va primero',
      narracion:
        'Es una guía telefónica: ordenada por apellido y luego por nombre. Buscar a todos los García es fácil. Buscar a todas las Ana, no: están repartidas por toda la guía. Un índice compuesto sirve de izquierda a derecha, sin saltarte la primera columna.',
      escena: {
        tipo: 'contraste',
        lados: [
          { etiqueta: 'Buscar «García»', estado: 'bien', lineas: ['García, Ana', 'García, Luis', 'García, Marta', 'Gómez, Ana'], nota: 'Todos juntos: saltas y lees tres.' },
          { etiqueta: 'Buscar «Ana»', estado: 'mal', lineas: ['García, Ana', 'Gómez, Ana', 'López, Ana', 'Ruiz, Ana'], nota: 'Repartidas por toda la guía: hay que leerla entera.' },
        ],
        veredicto: 'De izquierda a derecha, sin saltarte columnas',
      },
    },
    {
      concepto: '¿Lo usa?',
      tesis: 'tres consultas, un índice (cliente, fecha)',
      narracion:
        'Con el índice de cliente y fecha, tres consultas. Por cliente: lo usa. Por cliente y fecha: lo usa, y tarda cuatro centésimas de milisegundo. Solo por fecha: no lo usa y vuelve a leer el millón, ochenta milisegundos. En tu Postgres 16 es así; Postgres 18 a veces sabe saltar por el índice, pero solo si la primera columna tiene pocos valores distintos.',
      escena: {
        tipo: 'opciones',
        etiqueta_uso: 'medido:',
        opciones: [
          { nombre: 'Solo cliente', como: "WHERE cliente = 'Ana'", explica: 'Usa la primera columna: salta a las Ana.', veredicto: 'bien', usar_para: 'salta a Ana' },
          { nombre: 'Cliente y fecha', como: "cliente = 'Ana' AND fecha >= '2026-06-01'", explica: 'Las dos, en su orden: salta a Ana en junio.', veredicto: 'bien', usar_para: '0,04 ms' },
          { nombre: 'Solo fecha', como: "WHERE fecha = '2026-06-01'", explica: 'Se salta la primera columna: las fechas están por todo el índice.', veredicto: 'mal', usar_para: 'Seq Scan, 80 ms' },
        ],
      },
    },
    {
      concepto: 'La trampa',
      tesis: 'hay índice y aun así tarda',
      narracion:
        'Y ahora la trampa más común: el índice está creado, la consulta filtra por esa columna y aun así tarda lo mismo que sin índice. ¿Por qué?',
      escena: { tipo: 'pregunta', pregunta: '¿Por qué una consulta con índice vuelve a leer el millón?', pista: 'El índice está ahí. El problema es cómo preguntas.' },
    },
    {
      concepto: 'Cuándo no se usa',
      tesis: 'tres trampas',
      narracion:
        'Tres trampas. Una función sobre la columna: el índice guarda Ana, no Ana en minúsculas, y no puede buscar ahí. Un comodín al principio de un LIKE: el índice está ordenado por cómo empiezan los valores, y si no dices cómo empieza, no puede saltar. Y un valor que tiene casi todo el mundo: si el noventa y cinco por ciento de los pedidos están pagados, leer la tabla entera es más rápido que saltar fila a fila, y Postgres lo sabe.',
      escena: {
        tipo: 'opciones',
        etiqueta_uso: 'arreglo:',
        opciones: [
          { nombre: 'Una función encima', como: "WHERE lower(cliente) = 'ana'", explica: 'El índice guarda «Ana», no lower(«Ana»). Medido: 280 ms.', veredicto: 'mal', usar_para: 'índice sobre lower(cliente)' },
          { nombre: 'Comodín delante', como: "WHERE cliente LIKE '%na'", explica: 'Ordenado por el principio, y «%na» no dice cómo empieza. Medido: 110 ms.', veredicto: 'mal', usar_para: 'índice de trigramas (pg_trgm)' },
          { nombre: 'Casi todas coinciden', como: "WHERE estado = 'pagado'", explica: 'El 95 % de las filas: saltar una a una sale más caro que leerlo todo.', veredicto: 'depende', usar_para: 'ninguno: leer todo es lo rápido' },
        ],
      },
    },
    {
      concepto: 'EXPLAIN',
      tesis: 'pregúntale cómo lo va a hacer',
      narracion:
        '¿Cómo sabes cuál de estas cosas te pasa? Preguntándoselo. EXPLAIN ANALYZE ejecuta la consulta y te cuenta cómo lo ha hecho. Sin índice dice Seq Scan: leyó la tabla entera y descartó novecientas noventa y nueve mil novecientas ochenta y ocho filas.',
      escena: {
        tipo: 'consulta',
        sql: ['EXPLAIN ANALYZE', ...CONSULTA],
        salida_titulo: 'plan · sin índice',
        salida: [
          { texto: 'Seq Scan on pedidos (rows=12)', estado: 'mal' },
          { texto: "  Filter: (cliente = 'Ana')" },
          { texto: '  Rows Removed by Filter: 999988', estado: 'mal' },
          { texto: 'Execution Time: 90.630 ms' },
        ],
        metrica: { etiqueta: 'filas descartadas', valor: '999.988', estado: 'mal' },
      },
    },
    {
      concepto: 'EXPLAIN',
      tesis: 'con el índice, otro plan',
      narracion:
        'Con el índice, el plan cambia: Bitmap Index Scan sobre idx_pedidos_cliente. Ya no hay filas descartadas: va directo a las doce. Si después de crear un índice el plan sigue diciendo Seq Scan, estás en una de las tres trampas.',
      escena: {
        tipo: 'consulta',
        sql: ['EXPLAIN ANALYZE', ...CONSULTA],
        salida_titulo: 'plan · con índice',
        salida: [
          { texto: 'Bitmap Heap Scan on pedidos (rows=12)', estado: 'bien' },
          { texto: '  ->  Bitmap Index Scan on idx_pedidos_cliente', estado: 'bien' },
          { texto: "        Index Cond: (cliente = 'Ana')" },
          { texto: 'Execution Time: 0.078 ms' },
        ],
        metrica: { etiqueta: 'tiempo', valor: '0,078 ms', estado: 'bien', antes: '90 ms' },
      },
    },
    {
      concepto: 'Leer el plan',
      tesis: 'tres palabras',
      narracion:
        'Tres palabras bastan para leer casi cualquier plan. Seq Scan: leyó la tabla entera, que está bien si pides casi todo. Index Scan: saltó con el índice fila a fila, para pocas filas. Y Bitmap Heap Scan: usó el índice para marcar qué páginas leer y luego las leyó en orden. Es lo que eligió Postgres para Ana.',
      escena: {
        tipo: 'opciones',
        etiqueta_uso: 'cuándo:',
        opciones: [
          { nombre: 'Seq Scan', como: 'lee la tabla entera', explica: 'Bien si pides casi todo; mal si pides poco de una tabla grande.', veredicto: 'depende', usar_para: 'casi todas las filas' },
          { nombre: 'Index Scan', como: 'salta con el índice', explica: 'Va a cada fila por su puntero, una a una.', veredicto: 'bien', usar_para: 'pocas filas' },
          { nombre: 'Bitmap Heap Scan', como: 'índice, y luego páginas', explica: 'Marca en el índice qué páginas tocar y las lee en orden. Lo que salió con Ana.', veredicto: 'bien', usar_para: 'de pocas a bastantes filas' },
        ],
      },
    },
    {
      concepto: 'Los pedidos de Ana',
      tesis: 'antes y después',
      narracion:
        'Vuelve al principio: la página de Ana leía un millón de filas para enseñar doce y tardaba noventa milisegundos. Con una línea, CREATE INDEX, lee doce y tarda menos de una décima de milisegundo.',
      escena: {
        tipo: 'contraste',
        lados: [
          { etiqueta: 'Sin índice', estado: 'mal', lineas: ['Seq Scan', '1.000.000 filas leídas', '90 ms'] },
          { etiqueta: 'Con índice', estado: 'bien', lineas: ['Bitmap Index Scan', '12 filas leídas', '0,078 ms'] },
        ],
        veredicto: 'Leer menos para encontrar antes',
      },
    },
    {
      concepto: '¿Índice o no?',
      tesis: 'cuatro preguntas',
      narracion:
        'Para decidir, cuatro preguntas. ¿Filtras, unes u ordenas por esa columna a menudo? ¿La consulta devuelve pocas filas de muchas? ¿Preguntas por la columna tal cual, sin funciones ni comodines delante? Y si son varias columnas, ¿va primero la que siempre filtras? Después, compruébalo con EXPLAIN.',
      escena: {
        tipo: 'pasos',
        pasos: [
          { texto: '¿Filtras, unes u ordenas por esa columna a menudo?', detalle: 'Si no, el índice solo cuesta.' },
          { texto: '¿Devuelve pocas filas de muchas?', detalle: 'Si devuelve casi todas, leerlo todo es más rápido.' },
          { texto: '¿Preguntas por la columna tal cual?', detalle: 'Sin funciones encima ni comodines delante; si no, indexa la expresión.' },
          { texto: '¿Varias columnas? Primero la que siempre filtras', detalle: 'Y comprueba con EXPLAIN que lo usa.' },
        ],
      },
    },
    {
      concepto: 'Índices',
      tesis: 'siete ideas, hechas',
      narracion:
        'Recapitula. Leerlo todo es lento y crece con la tabla. Un índice es una copia ordenada, guardada como árbol B, que te lleva a la fila en tres saltos. Cuesta una escritura más y solo se usa si preguntas bien. Y EXPLAIN te dice si lo está usando. Lo siguiente de la lección: transacciones.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 6, hechas_tambien: true },
    },
  ],
}
