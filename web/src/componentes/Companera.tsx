import { useEffect, useRef, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import { mensajeDe } from './Cargando.tsx'
import { errorLegible } from './errores.ts'

// El tope del servidor para la pregunta (rutas_estudio.Parrafo.pregunta): el campo no deja escribir más.
const MAX_PREGUNTA = 500
import Mascota, { type GestoMascota } from '../Mascota.tsx'

// La mascota como compañera de lectura en el modo foco. Se queda quieta en el margen, a media altura, junto al párrafo
// activo (el que eliges con el teclado o con un clic; el ratón por encima no la mueve). Solo habla si se lo pides:
// al pulsarla, te ayuda con ese párrafo (más fácil, un ejemplo, por qué, palabras clave, el código o tu pregunta).
// Lo único que ofrece sola: un punto si el párrafo tiene un término en negrita que aún no está en tu mapa, y como
// mucho un globito por idea si llevas rato delante de un bloque de código.

export type Accion = 'facil' | 'ejemplo' | 'porque' | 'clave' | 'codigo' | 'pregunta'

const ACCIONES: [Accion, string][] = [
  ['facil', 'Más fácil'],
  ['ejemplo', 'Un ejemplo'],
  ['porque', '¿Por qué?'],
  ['clave', 'Palabras clave'],
]

const CODIGO_TRAS_S = 45
const SIN_SCROLL_S = 1.5
const GLOBO_S = 8

interface Globo {
  texto: string
  boton?: string
  hacer?: () => void
}

interface Props {
  mid: number
  claveBloque: string
  // El párrafo activo de la idea.
  parrafo: HTMLElement | null
  // En pantallas estrechas va en el pie y el bocadillo sale como una hoja desde abajo.
  estrecho: boolean
  alPalabras?: (palabras: string[]) => void
  // Lo que ya tienes en tu mapa: para no proponerte lo mismo.
  enMapa?: string[]
  // Sube cada vez que pides abrirla con el teclado (tecla A).
  abrir?: number
  // Milisegundos desde el último desplazamiento de la página.
  desplazadoHace?: () => number
  // «No lo entiendo»: el párrafo activo es (o deja de ser) una duda. Marcar no llama al modelo.
  esDuda?: boolean
  alDuda?: () => void
  // Cada explicación que da, para guardarla debajo de su párrafo.
  alRespuesta?: (parrafo: HTMLElement, accion: Accion, texto: string) => void
}

export default function Companera({ mid, claveBloque, parrafo, estrecho, alPalabras, enMapa = [], abrir = 0, desplazadoHace, esDuda, alDuda, alRespuesta }: Props) {
  const [abierta, setAbierta] = useState(false)
  const [respuesta, setRespuesta] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pregunta, setPregunta] = useState('')
  const [globo, setGlobo] = useState<Globo | null>(null)
  // Se monta con cada idea: desde cuándo está abierta y si ya ha dicho algo en ella.
  const desde = useRef(Date.now())
  const yaDijo = useRef(false)
  const caja = useRef<HTMLDivElement | null>(null)
  const boton = useRef<HTMLButtonElement | null>(null)
  const bocadillo = useRef<HTMLDivElement | null>(null)

  // Cambia el párrafo activo: el bocadillo se cierra (salvo si está pensando) y el globo se va.
  useEffect(() => {
    setGlobo(null)
    if (abierta && !cargando) {
      setAbierta(false)
      setRespuesta(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parrafo])

  // Con la tecla A (solo cuando cambia: al montarse en otra idea no se abre sola).
  const abrirVisto = useRef(abrir)
  useEffect(() => {
    if (abrir === abrirVisto.current) return
    abrirVisto.current = abrir
    setGlobo(null)
    setAbierta(true)
  }, [abrir])

  // Al abrir, el foco va a la primera opción; un clic fuera la cierra.
  useEffect(() => {
    if (!abierta) return
    bocadillo.current?.querySelector<HTMLElement>('.companera-acciones button')?.focus({ preventScroll: true })
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierta(false)
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierta])

  // Se esconde sola a los 8 s.
  useEffect(() => {
    if (!globo) return
    const t = window.setTimeout(() => setGlobo(null), GLOBO_S * 1000)
    return () => window.clearTimeout(t)
  }, [globo])

  // El único globo: delante de un bloque de código, si llevas 45 s en la idea, sin desplazar en el último segundo y
  // medio y sin estar escribiendo. Uno por idea como mucho.
  useEffect(() => {
    if (yaDijo.current || abierta || parrafo?.tagName !== 'PRE') return
    const t = window.setInterval(() => {
      if (yaDijo.current || document.visibilityState !== 'visible') return
      if (Date.now() - desde.current < CODIGO_TRAS_S * 1000) return
      if (desplazadoHace && desplazadoHace() < SIN_SCROLL_S * 1000) return
      if ((document.activeElement as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
      yaDijo.current = true
      setGlobo({ texto: '¿Te explico este código línea a línea?', boton: 'Sí', hacer: () => pedirAyuda('codigo') })
    }, 1000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parrafo, abierta])

  const pedirAyuda = async (accion: Accion, texto?: string) => {
    if (!parrafo) return
    setGlobo(null)
    setAbierta(true)
    setCargando(true)
    setRespuesta(null)
    try {
      const r = await pedir<{ texto: string }>(
        `/api/estudio/${mid}/parrafo`,
        enviarJson({ clave: claveBloque, parrafo: parrafo.innerText.slice(0, 3900), accion, pregunta: texto ?? null }),
      )
      setRespuesta(r.texto)
      alRespuesta?.(parrafo, accion, r.texto)
      if (accion === 'clave' && alPalabras) {
        const palabras = (r.texto.match(/«([^»]{2,40})»|\*\*([^*]{2,40})\*\*/g) ?? []).map((x) => x.replace(/[«»*]/g, ''))
        if (palabras.length) alPalabras(palabras)
      }
      setPregunta('')
    } catch (e) {
      // Nunca el texto técnico en inglés («String should have at most 500 characters»).
      setRespuesta(`No he podido: ${errorLegible(mensajeDe(e)).mensaje}`)
    } finally {
      setCargando(false)
      // El botón pulsado se desactiva mientras piensa y el foco del teclado se cae al cuerpo: se devuelve al
      // bocadillo para que Esc lo cierre a él (y no saque del modo foco).
      window.requestAnimationFrame(() => {
        const a = document.activeElement
        if (!a || a === document.body) bocadillo.current?.focus({ preventScroll: true })
      })
    }
  }

  if (!parrafo) return null
  // Un término en negrita que aún no está en tu mapa: un punto, sin globo.
  const termino = alPalabras
    ? Array.from(parrafo.querySelectorAll('strong, b'))
        .map((x) => x.textContent?.trim() ?? '')
        .find((t) => t.length > 2 && t.length < 40 && !enMapa.some((m) => m.toLowerCase() === t.toLowerCase()))
    : undefined
  const gesto: GestoMascota = cargando ? 'pensando' : abierta ? 'escuchando' : 'normal'

  return (
    <div
      className={`companera ${estrecho ? 'estrecha' : ''}`}
      ref={caja}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && abierta) {
          e.preventDefault()
          setAbierta(false)
          boton.current?.focus()
        }
      }}
    >
      <div className="companera-fija">
        <button
          ref={boton}
          type="button"
          className="companera-boton"
          onClick={() => {
            setGlobo(null)
            setAbierta(!abierta)
          }}
          aria-expanded={abierta}
          aria-label="Pedir ayuda con este párrafo (A)"
          title="¿Te ayudo con este párrafo? (A)"
        >
          <Mascota gesto={gesto} lugar="companera" quieta={!abierta && !cargando} />
          {termino && !abierta && <span className="companera-punto" aria-hidden="true" />}
        </button>
        {globo && !abierta && (
          <div className="companera-globo">
            <span>{globo.texto}</span>
            {globo.boton && (
              <button
                type="button"
                className="boton-mini"
                onClick={() => {
                  const h = globo.hacer
                  setGlobo(null)
                  h?.()
                }}
              >
                {globo.boton}
              </button>
            )}
          </div>
        )}
        {abierta && (
          <div className="companera-bocadillo" role="dialog" aria-label="Ayuda con el párrafo" ref={bocadillo} tabIndex={-1}>
            {termino && alPalabras && !cargando && !respuesta && (
              <p className="companera-mapa">
                <span>¿Añado «{termino}» a tu mapa?</span>
                <button type="button" className="boton-mini" onClick={() => alPalabras([termino])}>
                  Añadir
                </button>
              </p>
            )}
            {cargando && <p className="companera-pensando">Déjame pensar…</p>}
            {respuesta && <p className="companera-respuesta">{respuesta.replace(/\*\*/g, '')}</p>}
            {respuesta && alRespuesta && <p className="companera-guardada">Te lo dejo guardado debajo del párrafo.</p>}
            {esDuda && !cargando && !respuesta && (
              <p className="companera-guardada">Marcado como duda: te lo recuerdo antes de la comprobación y al acabar. ¿Te lo explico más fácil?</p>
            )}
            <div className="companera-acciones">
              {alDuda && (
                <button type="button" className="opcion opcion-chip" aria-pressed={!!esDuda} disabled={cargando} onClick={alDuda} title="Marcar este párrafo como duda (N)">
                  {esDuda ? 'Ya lo entiendo' : 'No lo entiendo (N)'}
                </button>
              )}
              {ACCIONES.map(([a, t]) => (
                <button key={a} type="button" className="opcion opcion-chip" disabled={cargando} onClick={() => pedirAyuda(a)}>
                  {t}
                </button>
              ))}
              {parrafo.tagName === 'PRE' && (
                <button type="button" className="opcion opcion-chip" disabled={cargando} onClick={() => pedirAyuda('codigo')}>
                  El código, línea a línea
                </button>
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (cargando) return
                // Vacía, Intro no se queda mudo con el error de antes delante: lo quita y dice qué falta.
                if (!pregunta.trim()) return setRespuesta('Escribe tu pregunta y pulsa Intro, o elige una de las opciones de arriba.')
                pedirAyuda('pregunta', pregunta.slice(0, MAX_PREGUNTA))
              }}
            >
              <input
                value={pregunta}
                maxLength={MAX_PREGUNTA}
                onChange={(e) => setPregunta(e.target.value.slice(0, MAX_PREGUNTA))}
                placeholder="Pregúntame sobre este párrafo"
                aria-label="Tu pregunta sobre el párrafo"
                aria-describedby={pregunta.length > MAX_PREGUNTA - 80 ? 'companera-cuenta' : undefined}
              />
              {pregunta.length > MAX_PREGUNTA - 80 && (
                <small id="companera-cuenta" className="companera-cuenta" aria-live="polite">
                  {pregunta.length} de {MAX_PREGUNTA} caracteres
                </small>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
