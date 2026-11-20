// «No lo entiendo» en el modo foco: los párrafos marcados como duda (N, o la mascota) y lo que la mascota te explicó
// de cada párrafo, guardado debajo de él. Se guarda en el navegador, por lección (magister-dudas-<apuntes> y
// magister-notas-<apuntes>), aparte del avance: sobrevive al cierre de la sesión para el «Te quedaron estas dudas» de
// otro día. Marcar, guardar y enseñar no llama al modelo. Lo de arriba es puro (pruebas en web/pruebas/dudas.test.ts).
import { t } from '../i18n/i18n.ts'
import { cuando } from './aMedias.ts'

export interface Duda {
  clave: string // la idea
  u: number // el párrafo (unidad) dentro de la idea
  texto: string // sus primeras 40 letras: para reconocerlo si las unidades cambian
  parrafo: string // el texto entero (hasta 3900), para «Explícame» sin abrir la idea
  en: number // cuándo se marcó (ms)
}

export interface Nota {
  clave: string
  u: number
  texto: string
  respuesta: string // lo que dijo la mascota
  accion: string // facil, ejemplo, porque, clave, codigo, pregunta
  en: number
}

export interface Flojo {
  tipo: 'duda' | 'fallo' | 'parcial'
  clave: string
  idea: number // desde 0
  titulo: string
  u?: number
  texto?: string
}

export const MAX_PARRAFO = 3900

// Las primeras 40 letras, sin saltos ni espacios de más.
export const inicio40 = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 40)

const mismo = (a: { clave: string; u: number; texto: string }, b: { clave: string; u: number; texto: string }) =>
  a.clave === b.clave && (a.texto ? a.texto === b.texto : a.u === b.u)

// N otra vez sobre el mismo párrafo la quita.
export function alternarDuda(dudas: readonly Duda[], d: Duda): Duda[] {
  return dudas.some((x) => mismo(x, d)) ? dudas.filter((x) => !mismo(x, d)) : [...dudas, d]
}

export const quitarDuda = (dudas: readonly Duda[], d: { clave: string; u: number; texto: string }) => dudas.filter((x) => !mismo(x, d))

// Una nota por párrafo: la última explicación sustituye a la anterior.
export function ponerNota(notas: readonly Nota[], n: Nota): Nota[] {
  return [...notas.filter((x) => !mismo(x, n)), n]
}

// Dónde está ahora un párrafo guardado: en su sitio si empieza igual; si no, el primero que empiece igual; -1 si no está.
export function localizar(textos: readonly string[], u: number, texto: string): number {
  if (!texto) return u >= 0 && u < textos.length ? u : -1
  if (u >= 0 && u < textos.length && inicio40(textos[u]) === texto) return u
  return textos.findIndex((t) => inicio40(t) === texto)
}

// Para saber qué nota se acaba de explicar (se enseña abierta).
export const claveNota = (n: { clave: string; u: number; texto: string }) => `${n.clave}|${n.u}|${n.texto}`

export const sinExplicar =(dudas: readonly Duda[], notas: readonly Nota[]) => dudas.filter((d) => !notas.some((n) => mismo(n, d)))

// «Te quedaron 2 dudas aquí: ¿te las explico más fácil?»
export function textoAvisoDudas(n: number): string {
  return t(n === 1 ? 'foco.avisoDudas1' : 'foco.avisoDudasN', { n })
}

// Lo que flojeó en la sesión: las dudas (por párrafo), lo fallado y lo que salió a medias, en el orden de la lección.
export function loQueFlojeo(bloques: readonly { clave: string; titulo: string }[], comprobado: Record<string, string>, dudas: readonly Duda[]): Flojo[] {
  const salida: Flojo[] = []
  bloques.forEach((b, idea) => {
    for (const d of [...dudas].filter((x) => x.clave === b.clave).sort((a, c) => a.u - c.u))
      salida.push({ tipo: 'duda', clave: b.clave, idea, titulo: b.titulo, u: d.u, texto: d.texto })
    const n = comprobado[b.clave]
    if (n === 'fallo' || n === 'parcial') salida.push({ tipo: n, clave: b.clave, idea, titulo: b.titulo })
  })
  return salida
}

// Al abrir la lección otro día con dudas pendientes, lo primero es «Te quedaron estas dudas». `ahora` entra (ms).
export const dudasDeOtroDia = (dudas: readonly Duda[], ahora: number) => dudas.length > 0 && dudas.some((d) => cuando(d.en, ahora) !== 'hoy')

// ===== Lo guardado (con el almacenamiento del navegador; sin él, vale para esta sesión) =====

interface Almacen {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

const claveDudas = (mid: number) => `magister-dudas-${mid}`
const claveNotas = (mid: number) => `magister-notas-${mid}`

function leerLista<T>(almacen: Almacen | null | undefined, clave: string, valida: (x: unknown) => boolean): T[] {
  try {
    const v = JSON.parse(almacen?.getItem(clave) ?? '[]')
    return Array.isArray(v) ? (v.filter(valida) as T[]) : []
  } catch {
    return []
  }
}

function guardarLista(almacen: Almacen | null | undefined, clave: string, v: readonly unknown[]) {
  try {
    if (v.length) almacen?.setItem(clave, JSON.stringify(v))
    else almacen?.removeItem(clave)
  } catch {
    /* sin almacenamiento */
  }
}

const esFila = (x: unknown) => {
  const o = x as { clave?: unknown; u?: unknown } | null
  return !!o && typeof o.clave === 'string' && typeof o.u === 'number'
}

export const leerDudas = (almacen: Almacen | null | undefined, mid: number) => leerLista<Duda>(almacen, claveDudas(mid), esFila)
export const guardarDudas = (almacen: Almacen | null | undefined, mid: number, d: readonly Duda[]) => guardarLista(almacen, claveDudas(mid), d)
export const leerNotas = (almacen: Almacen | null | undefined, mid: number) =>
  leerLista<Nota>(almacen, claveNotas(mid), (x) => esFila(x) && typeof (x as { respuesta?: unknown }).respuesta === 'string')
export const guardarNotas = (almacen: Almacen | null | undefined, mid: number, n: readonly Nota[]) => guardarLista(almacen, claveNotas(mid), n)
