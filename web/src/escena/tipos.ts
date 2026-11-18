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

export type Escena = Tablero | PorDentro | Pregunta | Contraste | Opciones | Tabla | Indice | Mitades | Arbol | Barras | Consulta | Pasos

export interface Tramo {
  concepto: string
  tesis: string
  narracion: string
  escena: Escena
}

export interface GuionGrafico {
  titulo: string
  tramos: Tramo[]
}

export const FPS = 30
export const ANCHO = 1280
export const ALTO = 720
const PALABRAS_MINUTO = 150

// Cada tramo dura lo que se tarda en decir su narración, con un respiro; nunca menos de 5 s.
export function duracionTramo(t: Tramo): number {
  const palabras = t.narracion.split(/\s+/).filter(Boolean).length
  return Math.round(Math.max(5, (palabras / PALABRAS_MINUTO) * 60 + 1.2) * FPS)
}

export function inicios(g: GuionGrafico): number[] {
  const salida: number[] = []
  let n = 0
  for (const t of g.tramos) {
    salida.push(n)
    n += duracionTramo(t)
  }
  return salida
}

// Las frases de una narración (para la voz y los subtítulos).
export function frases(narracion: string): string[] {
  return narracion.split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9«])/).filter(Boolean)
}

export const duracionTotal = (g: GuionGrafico) => g.tramos.reduce((n, t) => n + duracionTramo(t), 0)
