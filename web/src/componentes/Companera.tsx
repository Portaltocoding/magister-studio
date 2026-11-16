import { useCallback, useEffect, useRef, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import Mascota, { type GestoMascota } from '../Mascota.tsx'

// La mascota como compañera de lectura en el modo foco: baja junto al párrafo que lees y te ayuda con él
// (más fácil, un ejemplo, por qué, palabras clave o tu pregunta). Si llevas un rato atascado en un párrafo,
// se ofrece ella. La respuesta sale en un bocadillo, corto.

type Accion = 'facil' | 'ejemplo' | 'porque' | 'clave' | 'pregunta'

const ACCIONES: [Accion, string][] = [
  ['facil', 'Más fácil'],
  ['ejemplo', 'Un ejemplo'],
  ['porque', '¿Por qué?'],
  ['clave', 'Palabras clave'],
]

const ATASCO_S = 75

interface Props {
  mid: number
  claveBloque: string
  // El papel donde están los párrafos (se observa para seguir la lectura).
  papel: HTMLElement | null
  alPalabras?: (palabras: string[]) => void
}

export default function Companera({ mid, claveBloque, papel, alPalabras }: Props) {
  const [y, setY] = useState(0)
  const [actual, setActual] = useState<HTMLElement | null>(null)
  const [abierta, setAbierta] = useState(false)
  const [atasco, setAtasco] = useState(false)
  const [respuesta, setRespuesta] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pregunta, setPregunta] = useState('')
  const desde = useRef(Date.now())
  const ofrecidos = useRef(new Set<HTMLElement>())

  // El párrafo que lees: el que pasa por la franja de lectura (algo por encima del centro), o el que señalas.
  // Mientras hablas con ella, se queda quieta en su párrafo.
  const quieta = useRef(false)
  quieta.current = abierta || cargando
  const colocar = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !papel || el === actual || quieta.current) return
      setActual(el)
      setY(el.offsetTop)
      setRespuesta(null)
      setAbierta(false)
      setAtasco(false)
      desde.current = Date.now()
    },
    [papel, actual],
  )

  useEffect(() => {
    if (!papel) return
    // Sus propios bocadillos no son párrafos de los apuntes.
    const parrafos = () =>
      Array.from(papel.querySelectorAll<HTMLElement>('p, li, pre, blockquote, table')).filter((x) => !x.closest('.companera, .al-mapa') && x.innerText.trim().length > 20)
    const zona = papel.closest('.foco-cuerpo')
    const alDesplazar = () => {
      const centro = window.innerHeight * 0.42
      let mejor: HTMLElement | null = null
      let dist = Infinity
      for (const p of parrafos()) {
        const r = p.getBoundingClientRect()
        const d = Math.abs(r.top + Math.min(r.height, 80) / 2 - centro)
        if (d < dist) {
          dist = d
          mejor = p
        }
      }
      colocar(mejor)
    }
    const alSenalar = (e: MouseEvent) => {
      const p = (e.target as HTMLElement).closest<HTMLElement>('p, li, pre, blockquote, table')
      if (p && papel.contains(p) && !p.closest('.companera') && p.innerText.trim().length > 20) colocar(p)
    }
    alDesplazar()
    zona?.addEventListener('scroll', alDesplazar, { passive: true })
    papel.addEventListener('mouseover', alSenalar)
    return () => {
      zona?.removeEventListener('scroll', alDesplazar)
      papel.removeEventListener('mouseover', alSenalar)
    }
  }, [papel, colocar])

  // ¿Atascado? Si sigues en el mismo párrafo un buen rato, se ofrece (una vez por párrafo).
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!actual || abierta || ofrecidos.current.has(actual)) return
      if (document.visibilityState === 'visible' && Date.now() - desde.current > ATASCO_S * 1000) {
        ofrecidos.current.add(actual)
        setAtasco(true)
        setAbierta(true)
      }
    }, 5000)
    return () => window.clearInterval(t)
  }, [actual, abierta])

  const pedirAyuda = async (accion: Accion) => {
    if (!actual) return
    setCargando(true)
    setRespuesta(null)
    setAtasco(false)
    try {
      const r = await pedir<{ texto: string }>(
        `/api/estudio/${mid}/parrafo`,
        enviarJson({ clave: claveBloque, parrafo: actual.innerText.slice(0, 3900), accion, pregunta: accion === 'pregunta' ? pregunta : null }),
      )
      setRespuesta(r.texto)
      if (accion === 'clave' && alPalabras) {
        const palabras = (r.texto.match(/«([^»]{2,40})»|\*\*([^*]{2,40})\*\*/g) ?? []).map((x) => x.replace(/[«»*]/g, ''))
        if (palabras.length) alPalabras(palabras)
      }
      setPregunta('')
    } catch (e) {
      setRespuesta(`No he podido: ${(e as Error).message}`)
    } finally {
      setCargando(false)
    }
  }

  if (!papel || !actual) return null
  const gesto: GestoMascota = cargando ? 'pensando' : respuesta ? 'hablando' : abierta ? 'escuchando' : 'normal'

  return (
    <div className="companera" style={{ transform: `translateY(${y}px)` }}>
      <button
        type="button"
        className={`companera-boton ${atasco ? 'atasco' : ''}`}
        onClick={() => setAbierta(!abierta)}
        aria-expanded={abierta}
        aria-label="Pedir ayuda con este párrafo"
        title="¿Te ayudo con este párrafo?"
      >
        <Mascota mini gesto={gesto} />
      </button>
      {abierta && (
        <div className="companera-bocadillo" role="dialog" aria-label="Ayuda con el párrafo">
          {atasco && !respuesta && !cargando && <p className="companera-atasco">¿Te atascas aquí? Te lo cuento de otra forma.</p>}
          {cargando && <p className="companera-pensando">Déjame pensar…</p>}
          {respuesta && <p className="companera-respuesta">{respuesta.replace(/\*\*/g, '')}</p>}
          <div className="companera-acciones">
            {ACCIONES.map(([a, t]) => (
              <button key={a} type="button" className="opcion opcion-chip" disabled={cargando} onClick={() => pedirAyuda(a)}>
                {t}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (pregunta.trim()) pedirAyuda('pregunta')
            }}
          >
            <input value={pregunta} onChange={(e) => setPregunta(e.target.value)} placeholder="Pregúntame sobre este párrafo" aria-label="Tu pregunta sobre el párrafo" />
          </form>
        </div>
      )}
    </div>
  )
}
