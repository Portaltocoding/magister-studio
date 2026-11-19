// El guion gráfico: lo que el modelo escribe (contenido) y el código convierte en escenas (formato).
// Cada tramo es un paso de la explicación con su tesis, su narración y una escena hecha de datos.
// El método (docs/estilo-video.md y cerebro/prompts/comun/explicar.md): problema, intento ingenuo,
// la respuesta y su nombre; un ejemplo conductor; «por dentro»; el mapa que vuelve.

export type Estado = 'bien' | 'mal' | 'foco' | 'nuevo'

export interface Tablero {
  tipo: 'tablero'
  partes: { nombre: string; ideas: { nombre: string; que: string }[] }[]
  // Índice de la idea actual, contando todas las ideas en orden. Las anteriores salen hechas.
  actual: number
  hechas_tambien?: boolean
}

export interface PorDentro {
  tipo: 'por_dentro'
  // `resaltar`: números de línea contando desde 1, los mismos que se ven a la izquierda del código.
  codigo: { fichero: string; lineas: string[]; resaltar?: number[] }
  memoria: { titulo: string; filas: { clave: string; valor: string; estado?: Estado }[] }
  pantalla: { titulo: string; lineas: { texto: string; estado?: Estado }[]; boton?: string }
  // Los cables, en el orden en que viaja el dato.
  flujo: { de: 'codigo' | 'memoria' | 'pantalla'; a: 'codigo' | 'memoria' | 'pantalla'; etiqueta: string; estado?: Estado }[]
  // Interactivo: al pulsar el botón de la pantalla se repite la acción.
  // «acumula» añade otra fila como la última (el fallo); «igual» la deja igual y la confirma.
  repetir?: 'acumula' | 'igual'
}

export interface Pregunta {
  tipo: 'pregunta'
  pregunta: string
  pista?: string
}

export interface Contraste {
  tipo: 'contraste'
  lados: { etiqueta: string; lineas: string[]; estado?: Estado; nota?: string }[]
  veredicto?: string
}

export interface Opciones {
  tipo: 'opciones'
  opciones: { nombre: string; como: string; explica: string; veredicto: 'bien' | 'mal' | 'depende'; usar_para: string }[]
  // Lo que precede a `usar_para` al pie de cada tarjeta («úsala para:» si no se dice).
  etiqueta_uso?: string
}

// Una tabla de verdad, con un lector que la recorre fila a fila si hay escaneo.
export interface Tabla {
  tipo: 'tabla'
  nombre: string
  columnas: string[]
  filas: string[][]
  // Lo que no se ve («999.992 filas más»).
  resto?: string
  escaneo?: { coincide: number[]; leidas: number; encontradas: number }
}

// Un índice: una copia ordenada de una o varias columnas, cada entrada apuntando a su fila de la tabla.
export interface Indice {
  tipo: 'indice'
  nombre: string
  columnas: string[]
  // Ordenadas. fila = id de la fila a la que apunta; null = «⋮».
  entradas: { clave: string[]; fila: number | null }[]
  tabla: { nombre: string; columnas: string[]; filas: { id: number | null; celdas: string[] }[] }
  // Valor de la primera columna que se busca: sus entradas se encienden y tiran cables a sus filas.
  buscar?: string
  // O las entradas exactas (por posición) que se encienden, si la búsqueda usa más de una columna.
  marcar?: number[]
}

// Buscar en una lista ordenada partiéndola por la mitad.
export interface Mitades {
  tipo: 'mitades'
  total: number
  objetivo: string
  desde: string
  hasta: string
}

// Un árbol B: niveles de nodos (cada nodo, sus claves) y el camino que baja hasta la hoja.
export interface Arbol {
  tipo: 'arbol'
  niveles: string[][][]
  // Índice del nodo del camino en cada nivel.
  camino: number[]
  hoja: string
  nota?: string
}

export interface Barras {
  tipo: 'barras'
  titulo?: string
  escala: 'log' | 'lineal'
  barras: { etiqueta: string; valor: number; texto: string; estado?: Estado }[]
}

// Una consulta, lo que devuelve (un plan, un resultado) y la cifra que importa, en grande.
export interface Consulta {
  tipo: 'consulta'
  sql: string[]
  salida_titulo?: string
  salida: { texto: string; estado?: Estado }[]
  metrica?: { etiqueta: string; valor: string; estado?: Estado; antes?: string }
}

// Una lista numerada que se va encendiendo (reglas, preguntas para decidir).
export interface Pasos {
  tipo: 'pasos'
  pasos: { texto: string; detalle?: string }[]
}

// Una figura geométrica en un plano (coordenadas del mundo; el norte arriba), dibujada por pasos.
// Los ángulos van como acimut en gon: 0 = norte, en sentido horario (100 = este, 200 = sur, 300 = oeste).
export type ElementoFigura = { paso?: number; estado?: Estado } & (
  | { tipo: 'punto'; id: string; x: number; y: number; etiqueta?: string; coords?: string; lado?: 'n' | 's' | 'e' | 'o' }
  | { tipo: 'segmento'; de: string; a: string; etiqueta?: string; etiqueta_lado?: 'izquierda' | 'derecha'; discontinuo?: boolean; flecha?: boolean }
  | { tipo: 'angulo'; vertice: string; desde: number; hasta: number; etiqueta?: string; radio?: number }
  | { tipo: 'proyeccion'; de: string; a: string; etiqueta_x?: string; etiqueta_y?: string }
  | { tipo: 'norte'; en: string; largo?: number }
  | { tipo: 'texto'; x: number; y: number; texto: string; tamano?: number }
)

export interface Figura {
  tipo: 'figura'
  elementos: ElementoFigura[]
  // La rejilla de coordenadas alineada con el mundo, con sus valores en los bordes (por defecto, sí).
  rejilla?: boolean
  ejes?: { x: string; y: string }
  // Ancho de la zona de dibujo (por defecto, casi toda la pantalla).
  ancho?: number
}

// Fórmulas en LaTeX, de una en una, y qué es cada símbolo.
export interface Formula {
  tipo: 'formula'
  formulas: { tex: string; nota?: string; estado?: Estado }[]
  simbolos?: { simbolo: string; significa: string }[]
}

// Una cuenta hecha a mano: qué se calcula, con qué números y qué sale (todo en LaTeX).
export interface Calculo {
  tipo: 'calculo'
  datos?: string
  filas: { que: string; sustitucion?: string; resultado: string; estado?: Estado }[]
  nota?: string
}

export type Escena = Tablero | PorDentro | Pregunta | Contraste | Opciones | Tabla | Indice | Mitades | Arbol | Barras | Consulta | Pasos | Figura | Formula | Calculo

export interface Tramo {
  concepto: string
  tesis: string
  narracion: string
  escena: Escena
}

export interface GuionGrafico {
  titulo: string
  tramos: Tramo[]
  // «cartesiano»: una rejilla suave de fondo en todas las escenas, al estilo de 3Blue1Brown (matemáticas, topografía).
  fondo?: 'liso' | 'cartesiano'
}

export const FPS = 30
export const ANCHO = 1280
export const ALTO = 720
const PALABRAS_MINUTO = 150

// La estimación, para cuando no hay voz medida (la del navegador): cada tramo dura lo que se tarda en decir su
// narración a 150 palabras por minuto, con un respiro; nunca menos de 5 s. `ritmo` es la velocidad de voz elegida
// (0,8× a 2×): a voz lenta, tramos más largos, para que la narración no se corte al pasar al siguiente.
export function duracionTramo(t: Tramo, ritmo = 1): number {
  const palabras = t.narracion.split(/\s+/).filter(Boolean).length
  return Math.round(Math.max(5, (palabras / (PALABRAS_MINUTO * ritmo)) * 60 + 1.2) * FPS)
}

// ===== La línea de tiempo: la usan a la vez el Player (duración, saltos) y la composición (secuencias, voz) =====

// Entre dos tramos, la salida de uno y la entrada del siguiente se cruzan durante SOLAPE fotogramas (sin bajar a fondo).
export const SOLAPE = 8
// Con la voz medida, el respiro de 1,2 s de siempre se reparte: ENTRADA antes de la primera frase (el tramo ya ha
// entrado del todo) y COLA tras la última. Como COLA > SOLAPE, la voz de un tramo acaba antes de que entre el siguiente.
const ENTRADA = 12
const COLA = 24
// Entre trozos: tras una coma, lo que tardaba el Locutor en encadenar dos audios; entre frases, algo más.
const PAUSA_COMA = 3
const PAUSA_FRASE = 7
const MINIMO = 5 * FPS

// Un trozo de narración: lo que se dice de una vez (una frase cortada en sus comas) y a qué frase pertenece.
export interface Trozo {
  texto: string
  frase: number
}
// Un trozo colocado en su tramo: desde qué fotograma del tramo suena y cuántos dura.
export interface TrozoEnLinea extends Trozo {
  desde: number
  dur: number
}
export interface TramoEnLinea {
  desde: number
  dur: number
  trozos: TrozoEnLinea[]
}
export interface Linea {
  tramos: TramoEnLinea[]
  total: number
}
// Lo que dura de verdad cada trozo de cada tramo, en segundos y a velocidad 1 (null: no hay nada que decir).
export type Medidas = (number | null)[][]

// Los trozos de una narración, en orden: los mismos que decía el Locutor (frase a frase, cortadas en sus comas).
export function trozos(narracion: string): Trozo[] {
  return frases(narracion).flatMap((f, frase) => respiros(f).map((texto) => ({ texto, frase })))
}

const contarPalabras = (t: string) => t.split(/\s+/).filter(Boolean).length

// Sin medir: los trozos, uno tras otro desde el principio del tramo, a 150 palabras por minuto (como la estimación).
function estimado(t: Tramo, ritmo: number): Omit<TramoEnLinea, 'desde'> {
  const porPalabra = (60 / (PALABRAS_MINUTO * ritmo)) * FPS
  let dichas = 0
  const lista = trozos(t.narracion).map((z) => {
    const n = contarPalabras(z.texto)
    const desde = Math.round(dichas * porPalabra)
    dichas += n
    return { ...z, desde, dur: Math.max(1, Math.round(n * porPalabra)) }
  })
  return { dur: duracionTramo(t, ritmo), trozos: lista }
}

// Medido: cada trozo dura lo que dura su audio; el tramo, la voz entera más el respiro (nunca menos de 5 s).
function medido(t: Tramo, segundos: (number | null)[]): Omit<TramoEnLinea, 'desde'> {
  const base = trozos(t.narracion)
  let f = ENTRADA
  let fin = ENTRADA
  const lista = base.map((z, k) => {
    const dur = Math.ceil(Math.max(0, segundos[k] ?? 0) * FPS)
    const salida = { ...z, desde: f, dur }
    if (dur > 0) {
      fin = f + dur
      f = fin + (base[k + 1] && base[k + 1].frase !== z.frase ? PAUSA_FRASE : PAUSA_COMA)
    }
    return salida
  })
  return { dur: Math.max(MINIMO, fin + COLA), trozos: lista }
}

// Dónde empieza y cuánto dura cada tramo y cada trozo. Con `medidas` (la voz de Magister), lo que dura su audio, a
// velocidad 1: la velocidad la pone el Player a imagen y voz a la vez. Sin ellas, la estimación con su `ritmo`.
export function lineaDeTiempo(g: GuionGrafico, ritmo = 1, medidas?: Medidas | null): Linea {
  const tramos: TramoEnLinea[] = []
  let desde = 0
  g.tramos.forEach((t, i) => {
    const m = medidas?.[i]
    const x = m && m.length === trozos(t.narracion).length ? medido(t, m) : estimado(t, ritmo)
    tramos.push({ desde, ...x })
    desde += x.dur - SOLAPE
  })
  const ultimo = tramos[tramos.length - 1]
  return { tramos, total: ultimo ? ultimo.desde + ultimo.dur : 0 }
}

export function inicios(g: GuionGrafico, ritmo = 1, medidas?: Medidas | null): number[] {
  return lineaDeTiempo(g, ritmo, medidas).tramos.map((t) => t.desde)
}

// El tramo que se ve en un fotograma del vídeo (en el cruce, el que entra).
export function tramoEn(desde: number[], frame: number): number {
  let i = 0
  while (i + 1 < desde.length && desde[i + 1] <= frame) i++
  return i
}

// La frase que suena en el fotograma `f` del tramo: la del último trozo que ya ha empezado (antes, la primera).
export function fraseEn(lista: TrozoEnLinea[], f: number): number {
  let frase = lista[0]?.frase ?? 0
  for (const z of lista) if (z.dur > 0 && z.desde <= f) frase = z.frase
  return frase
}

// Por qué trozo seguir si se reanuda en el fotograma `f` del tramo: el que sonaba (otra vez), o el siguiente si se
// paró entre dos. Devuelve lista.length si ya no queda nada por decir.
export function trozoEn(lista: TrozoEnLinea[], f: number): number {
  let k = 0
  for (let i = 0; i < lista.length; i++) if (lista[i].desde <= f) k = i
  return lista[k] && f >= lista[k].desde + lista[k].dur ? k + 1 : k
}

// Las frases de una narración (para la voz y los subtítulos).
export function frases(narracion: string): string[] {
  return narracion.split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9«])/).filter(Boolean)
}

// Una frase en tramos para respirar: corta tras «,», «;» o «:» seguidos de espacio (la coma decimal de «121,353» no
// lleva espacio y no corta). Cada tramo se dice aparte, con su pausa: «mil, dos mil» suena como dos coordenadas.
export function respiros(frase: string): string[] {
  return frase.split(/(?<=[,;:])\s+/).filter(Boolean)
}

export const duracionTotal = (g: GuionGrafico, ritmo = 1, medidas?: Medidas | null) => lineaDeTiempo(g, ritmo, medidas).total
