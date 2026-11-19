// La voz de un vídeo mientras se prepara, tramo a tramo: cuál ya tiene su voz medida (y se puede ver), cuál la espera
// y cuál va con la voz del navegador. El vídeo empieza en cuanto el primer tramo está listo; lo demás se prepara
// mientras suena. Código puro, sin navegador: lo prueban los tests de web/pruebas.
//
// Reglas:
// - Un tramo pasa a «magister» solo si están medidos todos sus trozos y todos los tramos de antes: las medidas llegan
//   en el orden del vídeo, y lo que cambia al medir siempre queda por delante de lo que ya se ha visto.
// - Hasta entonces el tramo dura la estimación por su texto (la de siempre, a velocidad 1).
// - Si la voz falla (o la cortas) a mitad: los tramos con toda su voz medida siguen con la de Magister y el resto pasa
//   a la del navegador, con su aviso. Nunca se mezclan dos voces dentro de un tramo. Si no llegó ningún audio, todo
//   el vídeo va con la del navegador, como antes.
// - Lo que llegue después de cerrar (una petición que ya iba en vuelo) no cambia nada.
import { tramoEn, type Linea, type Medidas } from './tipos.ts'

export type MotivoSinMagister = 'elegida' | 'sin_piper' | 'fallo' | 'cancelado'
export type VozTramo = 'pendiente' | 'magister' | 'navegador'
export interface AudioMedido {
  url: string
  segundos: number
}

export interface EstadoVoz {
  // Los textos de los trozos de cada tramo, y los que hay que pedir (sin repetir, en el orden del vídeo).
  textos: string[][]
  unicos: string[]
  porTexto: ReadonlyMap<string, AudioMedido>
  // Cerrado: ya no se espera nada más (falló, se cortó o no hay voz de Magister). `motivo` dice por qué.
  cerrado: boolean
  motivo: MotivoSinMagister | null
  // Las fuentes de las fórmulas ya están (o se dejó de esperarlas).
  fuentes: boolean
  tramos: VozTramo[]
  // Para la composición: solo de los tramos «magister» (los demás, null: la estimación y sin audio). null si el
  // vídeo entero va con la voz del navegador.
  medidas: Medidas | null
  audios: Audios | null
}
export type Audios = ((string | null)[] | null)[]

const iguales = (a: VozTramo[], b: VozTramo[]) => a.length === b.length && a.every((x, i) => x === b[i])

function recalcular(e: EstadoVoz, antes?: EstadoVoz): EstadoVoz {
  const pedibles = new Set(e.unicos)
  const completo = (lista: string[]) => lista.every((t) => !pedibles.has(t) || e.porTexto.has(t))
  const todoNavegador = e.cerrado && e.porTexto.size === 0
  let enFila = true
  const tramos: VozTramo[] = e.textos.map((lista) => {
    if (todoNavegador) return 'navegador'
    const listo = completo(lista)
    if (e.cerrado) return listo ? 'magister' : 'navegador'
    enFila = enFila && listo
    return enFila ? 'magister' : 'pendiente'
  })
  // Mientras no cambie ningún tramo, las mismas medidas: la línea de tiempo no se recalcula por un trozo suelto.
  if (antes && iguales(antes.tramos, tramos) && (antes.medidas === null) === todoNavegador)
    return { ...e, tramos: antes.tramos, medidas: antes.medidas, audios: antes.audios }
  const fila = <T,>(i: number, f: (a: AudioMedido | undefined) => T) => (tramos[i] === 'magister' ? e.textos[i].map((t) => f(e.porTexto.get(t))) : null)
  return {
    ...e,
    tramos,
    medidas: todoNavegador ? null : e.textos.map((_, i) => fila(i, (a) => a?.segundos ?? null)),
    audios: todoNavegador ? null : e.textos.map((_, i) => fila(i, (a) => a?.url ?? null)),
  }
}

// `pedir(texto)`: si ese texto tiene algo que decir (lo que se queda vacío no se pide).
export function estadoInicial(textos: string[][], pedir: (t: string) => boolean): EstadoVoz {
  return recalcular({
    textos,
    unicos: [...new Set(textos.flat().filter(pedir))],
    porTexto: new Map(),
    cerrado: false,
    motivo: null,
    fuentes: false,
    tramos: [],
    medidas: null,
    audios: null,
  })
}

export function conAudio(e: EstadoVoz, texto: string, audio: AudioMedido): EstadoVoz {
  if (e.cerrado || !e.unicos.includes(texto)) return e
  const porTexto = new Map(e.porTexto)
  porTexto.set(texto, audio)
  return recalcular({ ...e, porTexto }, e)
}

export function sinMagister(e: EstadoVoz, motivo: MotivoSinMagister): EstadoVoz {
  if (e.cerrado) return e
  return recalcular({ ...e, cerrado: true, motivo }, e)
}

export const conFuentes = (e: EstadoVoz): EstadoVoz => (e.fuentes ? e : { ...e, fuentes: true })

// El reproductor sale en cuanto el primer tramo sabe con qué voz va (y están las fuentes).
export const puedeEmpezar = (e: EstadoVoz) => e.fuentes && (e.tramos.length === 0 || e.tramos[0] !== 'pendiente')
// Con la voz de Magister en la línea de tiempo (aunque sea en parte): velocidad 1 y el Player acelera.
export const conMagister = (e: EstadoVoz) => e.medidas !== null
export const avance = (e: EstadoVoz) => ({ hechos: e.porTexto.size, total: e.unicos.length })

// Si en el fotograma `frame` toca un tramo que aún espera su voz, cuál (para pausar ahí); si no, null.
export function esperaEn(e: EstadoVoz, desde: number[], frame: number): number | null {
  const i = tramoEn(desde, frame)
  return e.tramos[i] === 'pendiente' ? i : null
}

// Al cambiar la línea de tiempo, dónde queda el cabezal: en el mismo tramo y a la misma distancia de su inicio (sin
// salirse de él). Si nada cambia hasta ese tramo, es el mismo fotograma: el cabezal nunca salta hacia atrás.
export function reubicar(antes: Linea, ahora: Linea, frame: number): number {
  if (!antes.tramos.length || !ahora.tramos.length) return frame
  const i = Math.min(tramoEn(antes.tramos.map((t) => t.desde), frame), ahora.tramos.length - 1)
  const n = ahora.tramos[i]
  const dentro = Math.max(0, frame - antes.tramos[i].desde)
  return Math.max(0, Math.min(n.desde + Math.min(dentro, n.dur - 1), ahora.total - 1))
}

// Qué decir en pantalla cuando el vídeo va, entero o en parte, sin la voz de Magister (null: va toda con ella).
export function avisoVoz(e: EstadoVoz): string | null {
  const m = e.motivo
  if (!e.cerrado || !m || !e.tramos.includes('navegador')) return null
  if (conMagister(e)) {
    const desde = e.tramos.indexOf('navegador') + 1
    if (m === 'cancelado') return `Sin esperar al resto de la voz: desde el tramo ${desde}, la del navegador y los tiempos son aproximados.`
    return `La voz de Magister ha fallado a mitad: desde el tramo ${desde}, la del navegador y los tiempos son aproximados.`
  }
  if (m === 'elegida') return 'Con la voz del navegador, los tiempos son aproximados.'
  if (m === 'sin_piper') return 'La voz de Magister no está instalada: suena la del navegador y los tiempos son aproximados.'
  if (m === 'cancelado') return 'Sin esperar a la voz: va aparte de la imagen y los tiempos son aproximados.'
  return 'No se ha podido preparar la voz de Magister: va aparte de la imagen y los tiempos son aproximados.'
}
