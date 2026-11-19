// Una lección de muestra escrita a mano con el método del núcleo (L4 · Idempotencia), para ver el motor
// de escena entero antes de que el guion gráfico lo escriba el modelo.
import type { GuionGrafico } from './tipos.ts'

const PARTES = [
  { nombre: 'Recursos', ideas: [{ nombre: 'Recursos y verbos', que: 'qué se pide y cómo' }] },
  { nombre: 'Repetir', ideas: [{ nombre: 'Idempotencia', que: 'repetir sin romper nada' }] },
  { nombre: 'Estilos', ideas: [{ nombre: 'REST, GraphQL y gRPC', que: 'tres formas de hablar' }] },
  { nombre: 'Crecer', ideas: [{ nombre: 'Paginación y versionado', que: 'listas largas y cambios' }] },
  { nombre: 'Contrato', ideas: [{ nombre: 'Errores y contrato', que: 'lo que prometes al cliente' }] },
]

const PETICION = ['POST /pagos', 'Content-Type: application/json', '', '{ "pedido": 42, "importe": 30 }']

export const DEMO_IDEMPOTENCIA: GuionGrafico = {
  titulo: 'L4 · Idempotencia',
  tramos: [
    {
      concepto: 'Diseñar una API',
      tesis: 'cinco ideas en una lección',
      narracion:
        'Esta lección tiene cinco ideas. La primera ya la tienes: recursos y verbos. Ahora toca la segunda, la idempotencia, que es lo que impide que un cliente pague dos veces por lo mismo.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 1 },
    },
    {
      concepto: 'Pagar',
      tesis: 'una petición, un cobro',
      narracion:
        'Ana compra en una tienda y pulsa Pagar. Su app manda un POST con el pedido 42 y el importe, 30 euros. El servidor cobra, lo apunta y responde 200: pagado.',
      escena: {
        tipo: 'por_dentro',
        codigo: { fichero: 'peticion.http', lineas: PETICION, resaltar: [1] },
        memoria: { titulo: 'servidor · cobros', filas: [{ clave: 'pedido 42', valor: '30 €', estado: 'nuevo' }] },
        pantalla: { titulo: 'tienda.app', lineas: [{ texto: 'Pagado ✓', estado: 'bien' }], boton: 'Pagar' },
        flujo: [
          { de: 'pantalla', a: 'memoria', etiqueta: 'POST /pagos' },
          { de: 'memoria', a: 'pantalla', etiqueta: '200 OK', estado: 'bien' },
        ],
      },
    },
    {
      concepto: 'La red se corta',
      tesis: 'el cobro llega, la respuesta no',
      narracion:
        'Ahora la respuesta se pierde por el camino: Ana entra en un túnel. El servidor sí cobró, pero la app no lo sabe. Solo ve que no ha llegado nada.',
      escena: {
        tipo: 'por_dentro',
        codigo: { fichero: 'peticion.http', lineas: PETICION, resaltar: [1] },
        memoria: { titulo: 'servidor · cobros', filas: [{ clave: 'pedido 42', valor: '30 €', estado: 'nuevo' }] },
        pantalla: { titulo: 'tienda.app', lineas: [{ texto: 'Sin respuesta', estado: 'mal' }, { texto: '¿Reintentar?' }] },
        flujo: [
          { de: 'pantalla', a: 'memoria', etiqueta: 'POST /pagos' },
          { de: 'memoria', a: 'pantalla', etiqueta: '200 OK', estado: 'mal' },
        ],
      },
    },
    {
      concepto: 'Reintentar',
      tesis: '60 euros por un pedido de 30',
      narracion:
        'El intento ingenuo es reintentar. Para el servidor, ese segundo POST es un pago nuevo: cobra otra vez. Ana ve 60 euros en su tarjeta por un pedido de 30. Y cada reintento más, otros 30.',
      escena: {
        tipo: 'por_dentro',
        codigo: { fichero: 'peticion.http', lineas: PETICION, resaltar: [1] },
        memoria: {
          titulo: 'servidor · cobros',
          filas: [
            { clave: 'pedido 42', valor: '30 €', estado: 'nuevo' },
            { clave: 'pedido 42', valor: '30 €', estado: 'mal' },
          ],
        },
        pantalla: { titulo: 'tienda.app', lineas: [{ texto: 'Pagado ✓' }, { texto: 'Cargo: 60 €', estado: 'mal' }], boton: 'Reintentar' },
        flujo: [
          { de: 'pantalla', a: 'memoria', etiqueta: 'POST /pagos, otra vez' },
          { de: 'memoria', a: 'pantalla', etiqueta: '200 OK', estado: 'bien' },
        ],
        repetir: 'acumula',
      },
    },
    {
      concepto: 'La pregunta',
      tesis: '¿reintento o pago nuevo?',
      narracion:
        'Así que la pregunta es esta: si las dos peticiones son idénticas, ¿cómo distingue el servidor un reintento de un segundo pago de verdad?',
      escena: { tipo: 'pregunta', pregunta: '¿Cómo distingue el servidor un reintento de un segundo pago?', pista: 'Las dos peticiones son idénticas, byte a byte.' },
    },
    {
      concepto: 'La clave',
      tesis: 'un nombre único para cada intento',
      narracion:
        'La app inventa una clave única antes del primer intento y la manda en cada reintento. El servidor apunta la clave junto a su respuesta. Si vuelve a ver la misma clave, no cobra: devuelve la respuesta que guardó. Reintenta las veces que quieras: siguen siendo 30 euros.',
      escena: {
        tipo: 'por_dentro',
        codigo: { fichero: 'peticion.http', lineas: ['POST /pagos', 'Idempotency-Key: a41e-77c2', '', '{ "pedido": 42, "importe": 30 }'], resaltar: [2] },
        memoria: {
          titulo: 'servidor · claves vistas',
          filas: [
            { clave: 'a41e-77c2', valor: '200 · pagado', estado: 'bien' },
            { clave: 'pedido 42', valor: '30 €', estado: 'nuevo' },
          ],
        },
        pantalla: { titulo: 'tienda.app', lineas: [{ texto: 'Pagado ✓', estado: 'bien' }, { texto: 'Cargo: 30 €', estado: 'bien' }], boton: 'Reintentar' },
        flujo: [
          { de: 'pantalla', a: 'memoria', etiqueta: 'POST + clave' },
          { de: 'memoria', a: 'pantalla', etiqueta: 'respuesta guardada', estado: 'bien' },
        ],
        repetir: 'igual',
      },
    },
    {
      concepto: 'Idempotente',
      tesis: 'repetir no cambia nada más',
      narracion:
        'A esto se le llama idempotencia: hacer la operación una vez o diez deja el mismo estado. GET, PUT y DELETE ya lo son por cómo están definidos. POST no lo es, y por eso necesita la clave.',
      escena: {
        tipo: 'contraste',
        lados: [
          { etiqueta: 'Sin clave', estado: 'mal', lineas: ['1 intento  → 30 €', '2 intentos → 60 €', '3 intentos → 90 €'], nota: 'Cada repetición suma.' },
          { etiqueta: 'Con clave', estado: 'bien', lineas: ['1 intento  → 30 €', '2 intentos → 30 €', '3 intentos → 30 €'], nota: 'La primera cuenta; las demás devuelven lo mismo.' },
        ],
        veredicto: 'Una vez o diez: el mismo estado',
      },
    },
    {
      concepto: '¿Cuál, cuándo?',
      tesis: 'tres formas de no cobrar dos veces',
      narracion:
        'Hay tres formas. La clave de idempotencia, para pagos y pedidos. Un PUT con un id que elige el cliente, cuando ya sabes cómo se llamará lo que creas. Y mirar si ya existe antes de insertar, que falla: dos peticiones a la vez miran, no ven nada y cobran las dos.',
      escena: {
        tipo: 'opciones',
        opciones: [
          { nombre: 'Clave de idempotencia', como: 'Idempotency-Key: a41e…', explica: 'El cliente nombra cada intento; el servidor guarda la respuesta un tiempo.', veredicto: 'bien', usar_para: 'pagos y pedidos' },
          { nombre: 'PUT con id del cliente', como: 'PUT /pagos/a41e', explica: 'El cliente elige el id; repetir el PUT reescribe lo mismo.', veredicto: 'bien', usar_para: 'crear con id conocido' },
          { nombre: 'Mirar si ya existe', como: 'SELECT… y luego INSERT', explica: 'Dos peticiones a la vez miran, no ven nada y cobran las dos.', veredicto: 'mal', usar_para: 'nada con dinero' },
        ],
      },
    },
    {
      concepto: 'Diseñar una API',
      tesis: 'idempotencia, hecha',
      narracion:
        'Recapitula: el fallo era cobrar dos veces al reintentar. La respuesta es una clave por intento que el servidor recuerda. Idempotente quiere decir que repetir no cambia nada más. Siguiente idea: REST, GraphQL y gRPC.',
      escena: { tipo: 'tablero', partes: PARTES, actual: 1, hechas_tambien: true },
    },
  ],
}
