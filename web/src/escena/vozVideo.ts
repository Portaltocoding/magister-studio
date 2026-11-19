// La voz de Magister para un vídeo animado. Antes de reproducir, cada trozo de la narración (los mismos que decía el
// Locutor, con la misma petición a /api/voz) se sintetiza una vez y se mide. Con eso cada tramo dura lo que dura su
// voz y el audio va dentro de la línea de tiempo de Remotion. Si no se puede, se dice por qué y el vídeo sigue con
// la estimación y la voz del navegador, como antes.
import { pedirVozMagister, pronunciar, vocesMagister, vocesMagisterListas, vozMagister } from '../componentes/voz.ts'
import { duracionWav, enParalelo } from './medir.ts'
import { trozos, type GuionGrafico, type Medidas } from './tipos.ts'

export type MotivoSinMagister = 'elegida' | 'sin_piper' | 'fallo' | 'cancelado'
export type VozPreparada =
  | { modo: 'magister'; medidas: Medidas; audios: (string | null)[][]; liberar: () => void }
  | { modo: 'navegador'; motivo: MotivoSinMagister; liberar: () => void }

// Piper dice una frase cada vez (el servidor las pone en fila): con tres pedidas a la vez siempre tiene la siguiente.
const A_LA_VEZ = 3
// Lo más que se espera por un trozo (el servidor se rinde a los 30 s por intento).
const PLAZO_MS = 35_000
const nada = () => undefined

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Una petición con su plazo y que se corta también si se cancela todo.
async function conPlazo<T>(hacer: (s: AbortSignal) => Promise<T>, fuera: AbortSignal): Promise<T> {
  const ac = new AbortController()
  const corta = () => ac.abort()
  if (fuera.aborted) corta() // ya cancelado antes de pedir: una señal abortada no vuelve a lanzar «abort»
  fuera.addEventListener('abort', corta, { once: true })
  const t = setTimeout(corta, PLAZO_MS)
  try {
    return await hacer(ac.signal)
  } finally {
    clearTimeout(t)
    fuera.removeEventListener('abort', corta)
  }
}

// Si la cabecera no se entiende, la duración que da el propio navegador al cargar el audio.
function duracionDelNavegador(url: string): Promise<number | null> {
  return new Promise((r) => {
    const a = new Audio()
    a.preload = 'metadata'
    a.onloadedmetadata = () => r(Number.isFinite(a.duration) ? a.duration : null)
    a.onerror = () => r(null)
    setTimeout(() => r(null), 5000)
    a.src = url
  })
}

// Las fórmulas (KaTeX) solo se ven bien con sus fuentes: si el guion tiene alguna, se espera a que estén (3 s como mucho).
function esperarFuentes(g: GuionGrafico): Promise<unknown> {
  const conFormulas = g.tramos.some((t) => t.escena.tipo === 'formula' || t.escena.tipo === 'calculo')
  if (!conFormulas || typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  const fuentes = ['1em KaTeX_Main', 'italic 1em KaTeX_Main', 'italic 1em KaTeX_Math', '1em KaTeX_Size1', '1em KaTeX_Size2']
  return Promise.race([Promise.all(fuentes.map((f) => document.fonts.load(f))).catch(nada), espera(3000)])
}

export async function prepararVoz(
  g: GuionGrafico,
  { signal, alAvance }: { signal: AbortSignal; alAvance: (hechos: number, total: number) => void },
): Promise<VozPreparada> {
  const fuentes = esperarFuentes(g)
  await Promise.race([vocesMagisterListas, espera(5000)])
  const voz = vozMagister()
  if (!voz) {
    await fuentes
    return { modo: 'navegador', motivo: vocesMagister.length ? 'elegida' : 'sin_piper', liberar: nada }
  }
  // Cancelado mientras se esperaba a las voces (en desarrollo, React monta dos veces): no se sintetiza nada.
  if (signal.aborted) {
    await fuentes
    return { modo: 'navegador', motivo: 'cancelado', liberar: nada }
  }

  // Cada texto distinto se pide una sola vez; lo que no tiene nada que decir (un trozo que se queda vacío) no se pide.
  const textos = g.tramos.map((t) => trozos(t.narracion).map((z) => z.texto))
  const unicos = [...new Set(textos.flat().filter((t) => pronunciar(t)))]
  const urls: string[] = []
  let soltado = false
  const liberar = () => {
    soltado = true
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u))
  }
  // Corta también las peticiones en vuelo cuando un trozo falla del todo (no solo cuando cancelas tú).
  const interno = new AbortController()
  const cortarInterno = () => interno.abort()
  if (signal.aborted) cortarInterno()
  signal.addEventListener('abort', cortarInterno, { once: true })

  const medirUno = async (texto: string): Promise<{ url: string; segundos: number }> => {
    for (let intento = 0; ; intento++) {
      if (interno.signal.aborted) throw new Error('cancelado')
      try {
        const b = await conPlazo((s) => pedirVozMagister(texto, voz, s), interno.signal)
        if (!b) throw new Error('sin audio')
        if (soltado) throw new Error('cancelado') // ya se ha rendido: este audio no se guarda
        const url = URL.createObjectURL(b)
        urls.push(url)
        const segundos = duracionWav(await b.arrayBuffer()) ?? (await duracionDelNavegador(url))
        if (!segundos) throw new Error('audio sin duración')
        return { url, segundos }
      } catch (e) {
        // Un fallo suelto se reintenta una vez; si se ha cancelado, no.
        if (interno.signal.aborted || intento >= 1) throw e
      }
    }
  }

  alAvance(0, unicos.length)
  try {
    const medidos = await enParalelo(
      unicos.map((t) => () => medirUno(t)),
      A_LA_VEZ,
      (hechos) => alAvance(hechos, unicos.length),
    )
    await fuentes
    if (signal.aborted) throw new Error('cancelado')
    const porTexto = new Map(unicos.map((t, i) => [t, medidos[i]]))
    return {
      modo: 'magister',
      medidas: textos.map((lista) => lista.map((t) => porTexto.get(t)?.segundos ?? null)),
      audios: textos.map((lista) => lista.map((t) => porTexto.get(t)?.url ?? null)),
      liberar,
    }
  } catch {
    cortarInterno()
    liberar()
    await fuentes
    return { modo: 'navegador', motivo: signal.aborted ? 'cancelado' : 'fallo', liberar: nada }
  } finally {
    signal.removeEventListener('abort', cortarInterno)
  }
}

// Qué decir en pantalla cuando el vídeo va sin la voz de Magister.
export function avisoSinMagister(m: MotivoSinMagister): string {
  if (m === 'elegida') return 'Con la voz del navegador, los tiempos son aproximados.'
  if (m === 'sin_piper') return 'La voz de Magister no está instalada: suena la del navegador y los tiempos son aproximados.'
  if (m === 'cancelado') return 'Sin esperar a la voz: va aparte de la imagen y los tiempos son aproximados.'
  return 'No se ha podido preparar la voz de Magister: va aparte de la imagen y los tiempos son aproximados.'
}
