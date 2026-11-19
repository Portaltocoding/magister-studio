// La voz de Magister para un vídeo animado. Cada trozo de la narración (los mismos que decía el Locutor, con la misma
// petición a /api/voz) se sintetiza una vez y se mide, en el orden del vídeo. Con eso cada tramo dura lo que dura su
// voz y el audio va dentro de la línea de tiempo de Remotion. El vídeo empieza en cuanto el primer tramo tiene su voz;
// el resto se prepara mientras suena (el estado y sus reglas, en vozPorTramos.ts). Si no se puede, se dice por qué y
// lo que falte va con la estimación y la voz del navegador, como antes.
import { pedirVozMagister, pronunciar, vocesMagister, vocesMagisterListas, vozMagister } from '../componentes/voz.ts'
import { duracionWav, enParalelo } from './medir.ts'
import { trozos, type GuionGrafico } from './tipos.ts'
import { conAudio, conFuentes, estadoInicial, sinMagister, type AudioMedido, type EstadoVoz } from './vozPorTramos.ts'

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

// Prepara la voz tramo a tramo y va contando cómo va con `alCambio` (estado nuevo cada vez, ver vozPorTramos.ts): el
// vídeo puede empezar en cuanto el primer tramo tiene su voz. Cancelar (`signal`) deja con la de Magister los tramos
// ya listos y el resto con la del navegador. `liberar` suelta los audios (al salir o con otro guion).
export function prepararVoz(
  g: GuionGrafico,
  { signal, alCambio }: { signal: AbortSignal; alCambio: (e: EstadoVoz) => void },
): { liberar: () => void } {
  // Cada texto distinto se pide una sola vez; lo que no tiene nada que decir (un trozo que se queda vacío) no se pide.
  const textos = g.tramos.map((t) => trozos(t.narracion).map((z) => z.texto))
  let estado = estadoInicial(textos, (t) => !!pronunciar(t))
  const urls: string[] = []
  let soltado = false
  const liberar = () => {
    soltado = true
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u))
  }
  const cambiar = (f: (e: EstadoVoz) => EstadoVoz) => {
    const nuevo = f(estado)
    if (nuevo === estado || soltado) return
    estado = nuevo
    alCambio(estado)
  }
  void esperarFuentes(g).then(() => cambiar(conFuentes))
  void preparar(estado.unicos, signal, cambiar, urls, () => soltado)
  return { liberar }
}

async function preparar(
  unicos: string[],
  signal: AbortSignal,
  cambiar: (f: (e: EstadoVoz) => EstadoVoz) => void,
  urls: string[],
  soltado: () => boolean,
): Promise<void> {
  await Promise.race([vocesMagisterListas, espera(5000)])
  const voz = vozMagister()
  if (!voz) return cambiar((e) => sinMagister(e, vocesMagister.length ? 'elegida' : 'sin_piper'))
  // Cancelado mientras se esperaba a las voces (en desarrollo, React monta dos veces): no se sintetiza nada.
  if (signal.aborted) return cambiar((e) => sinMagister(e, 'cancelado'))

  // Corta también las peticiones en vuelo cuando un trozo falla del todo (no solo cuando cancelas tú).
  const interno = new AbortController()
  const cortarInterno = () => interno.abort()
  signal.addEventListener('abort', cortarInterno, { once: true })

  const medirUno = async (texto: string): Promise<AudioMedido> => {
    for (let intento = 0; ; intento++) {
      if (interno.signal.aborted) throw new Error('cancelado')
      try {
        const b = await conPlazo((s) => pedirVozMagister(texto, voz, s), interno.signal)
        if (!b) throw new Error('sin audio')
        if (soltado()) throw new Error('cancelado') // ya se ha soltado todo: este audio no se guarda
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

  // En el orden del vídeo y de tres en tres: cada trozo medido se anota en cuanto llega.
  try {
    await enParalelo(
      unicos.map((t) => async () => {
        const a = await medirUno(t)
        cambiar((e) => conAudio(e, t, a))
      }),
      A_LA_VEZ,
    )
  } catch {
    // Falla un trozo (tras su reintento) o lo cortas: los tramos ya listos siguen con la voz de Magister y el resto
    // pasa a la del navegador. Los audios ya pedidos se quedan hasta `liberar`.
    cortarInterno()
    cambiar((e) => sinMagister(e, signal.aborted ? 'cancelado' : 'fallo'))
  } finally {
    signal.removeEventListener('abort', cortarInterno)
  }
}
