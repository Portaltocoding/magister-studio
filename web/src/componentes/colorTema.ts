// Cada tema (cada plan de estudio), su color, el mismo en toda la app: Calendario, Roadmap, Lecciones, Vídeo, Progreso,
// Examen y Hoy. Lógica pura, sin React ni almacenamiento: se prueba en web/pruebas/colorTema.test.ts.
//
// - Estable: el color sale del id del tema, no de su sitio en la lista. Añadir o borrar otro plan no lo cambia
//   (salvo que ese tema hubiera chocado con el borrado y se hubiera corrido de casilla: ver asignarColores).
// - Distinto entre los temas que hay: si dos piden la misma casilla, el de id menor se la queda y el otro pasa a la
//   siguiente libre. Siempre igual con los mismos temas.
// - Se lee en claro, en oscuro y en Parchís: el acento se mezcla con la tinta del tema (oscurece sobre papel claro,
//   aclara sobre fondo oscuro) y el fondo suave, con el de las tarjetas. Contraste del acento sobre la tarjeta y sobre
//   su fondo suave de 3,4:1 o más en los tres aspectos (borde y punto: no es texto). El nombre va en la tinta normal.
// - El color nunca va solo: el nombre del tema siempre se escribe al lado.
import type { CSSProperties } from 'react'

export interface Tono {
  id: string
  nombre: string
  base: string
}

// Ocho tonos de saturación media, que no se confunden con el rojo de «Examen». En este orden, dos ids seguidos (los
// planes se crean uno detrás de otro) caen en tonos bien distintos, también al dar la vuelta.
export const PALETA_TEMAS: readonly Tono[] = [
  { id: 'verde', nombre: 'Verde', base: '#2e9c5a' },
  { id: 'frambuesa', nombre: 'Frambuesa', base: '#d2477f' },
  { id: 'azul', nombre: 'Azul', base: '#2f7fd8' },
  { id: 'naranja', nombre: 'Naranja', base: '#e07a1f' },
  { id: 'turquesa', nombre: 'Turquesa', base: '#159aa5' },
  { id: 'violeta', nombre: 'Violeta', base: '#8b5fd6' },
  { id: 'ocre', nombre: 'Ocre', base: '#b98d12' },
  { id: 'pizarra', nombre: 'Pizarra', base: '#5f7593' },
]

export interface ColorTema {
  indice: number
  tono: Tono
  // Para el atributo style: --tema-color (borde, franja, punto) y --tema-fondo (fondo suave).
  estilo: CSSProperties
}

type TemaRef = number | { tema_id: number } | { tema_id?: number | null }

const idDe = (t: TemaRef): number | null => (typeof t === 'number' ? t : (t.tema_id ?? null))

// La casilla que pide cada tema por su id.
const preferida = (id: number) => ((Math.trunc(id) % PALETA_TEMAS.length) + PALETA_TEMAS.length) % PALETA_TEMAS.length

// Reparte las casillas entre los temas que hay: por id, de menor a mayor, cada uno la suya o la siguiente libre.
// Con más temas que colores, los que sobran repiten su casilla preferida (el nombre escrito los distingue).
export function asignarColores(temas: readonly TemaRef[]): Map<number, number> {
  const ids = [...new Set(temas.map(idDe).filter((x): x is number => x != null && Number.isFinite(x)))].sort((a, b) => a - b)
  const ocupadas = new Set<number>()
  const salida = new Map<number, number>()
  for (const id of ids) {
    let i = preferida(id)
    if (ocupadas.size < PALETA_TEMAS.length) while (ocupadas.has(i)) i = (i + 1) % PALETA_TEMAS.length
    ocupadas.add(i)
    salida.set(id, i)
  }
  return salida
}

export const estiloDeTono = (t: Tono): CSSProperties =>
  ({
    '--tema-color': `color-mix(in srgb, ${t.base} 80%, var(--texto))`,
    '--tema-fondo': `color-mix(in srgb, ${t.base} 13%, var(--tarjeta, var(--fondo)))`,
  }) as CSSProperties

// El color de un tema entre los que hay (los temas de tus planes: pásale siempre la misma lista, la de /api/planes,
// para que salga igual en todas las pantallas). Sin tema, null: se pinta como siempre.
export function colorDeTema(temaId: number | null | undefined, temas: readonly TemaRef[]): ColorTema | null {
  if (temaId == null || !Number.isFinite(temaId)) return null
  const lista = temas.some((t) => idDe(t) === temaId) ? temas : [...temas, temaId]
  const indice = asignarColores(lista).get(temaId) ?? preferida(temaId)
  const tono = PALETA_TEMAS[indice]
  return { indice, tono, estilo: estiloDeTono(tono) }
}

// Las cosas de un día, juntas por tema y en el orden de la leyenda (sin tema, al final). Dentro de cada grupo, el orden
// en que venían (por hora).
export function agruparPorTema<T extends { tema_id?: number | null }>(cosas: readonly T[], orden: readonly number[]): { temaId: number | null; cosas: T[] }[] {
  const grupos = new Map<number | null, T[]>()
  for (const c of cosas) {
    const k = c.tema_id ?? null
    grupos.set(k, [...(grupos.get(k) ?? []), c])
  }
  const puesto = (k: number | null) => (k == null ? Infinity : orden.includes(k) ? orden.indexOf(k) : orden.length + k)
  return [...grupos.entries()].sort(([a], [b]) => puesto(a) - puesto(b)).map(([temaId, lista]) => ({ temaId, cosas: lista }))
}

// El filtro de la leyenda: pulsar un tema lo oculta o lo vuelve a enseñar, pero siempre queda al menos uno a la vista.
export function alternarTema(ocultos: ReadonlySet<number>, temaId: number, todos: readonly number[]): Set<number> {
  const salida = new Set(ocultos)
  if (salida.has(temaId)) salida.delete(temaId)
  else if (todos.some((t) => t !== temaId && !salida.has(t))) salida.add(temaId)
  return salida
}

const ENLACES = new Set(['y', 'e', 'o', 'u', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'para', 'con', 'a', 'al', 'por'])

// El nombre corto, para donde no cabe el largo (las celdas del calendario): palabras enteras hasta unos 14 caracteres,
// sin dejar un «y» o un «de» colgando. El nombre entero va en el title y en la leyenda.
export function nombreCorto(nombre: string, maximo = 14): string {
  const limpio = nombre.trim().replace(/\s+/g, ' ')
  if (limpio.length <= maximo) return limpio
  const palabras = limpio.split(' ')
  const elegidas: string[] = []
  for (const p of palabras) {
    if ([...elegidas, p].join(' ').length > maximo) break
    elegidas.push(p)
  }
  while (elegidas.length > 1 && ENLACES.has(elegidas[elegidas.length - 1].toLowerCase())) elegidas.pop()
  // Una sola palabra muy larga: se corta por letras.
  const corto = elegidas.length ? elegidas.join(' ') : limpio.slice(0, maximo)
  return `${corto}…`
}
