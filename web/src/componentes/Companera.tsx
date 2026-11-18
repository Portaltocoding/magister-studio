import { useCallback, useEffect, useRef, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import Mascota, { type GestoMascota } from '../Mascota.tsx'

// La mascota como compañera de lectura en el modo foco. Baja junto al párrafo que lees (con un saltito) y no se queda
// callada: con globitos cortos que no gastan nada se ofrece cuando hay algo que hacer —un término en negrita para tu
// mapa, un bloque de código, un párrafo en el que llevas rato o el final de la idea, para que se lo digas con tus
// palabras—. Al pulsarla, te ayuda con ese párrafo: más fácil, un ejemplo, por qué, palabras clave, el código o tu
// pregunta. Las respuestas, en un bocadillo corto.

type Accion = 'facil' | 'ejemplo' | 'porque' | 'clave' | 'codigo' | 'pregunta' | 'comprobar'

const ACCIONES: [Accion, string][] = [
  ['facil', 'Más fácil'],
  ['ejemplo', 'Un ejemplo'],
  ['porque', '¿Por qué?'],
  ['clave', 'Palabras clave'],
]

const ATASCO_S = 30
const ENTRE_GLOBOS_S = 20

interface Globo {
  texto: string
  boton?: string
  hacer?: () => void
}

interface Props {
  mid: number
  claveBloque: string
  // El papel donde están los párrafos (se observa para seguir la lectura).
  papel: HTMLElement | null
  alPalabras?: (palabras: string[]) => void
  // Lo que ya tienes en tu mapa: para no proponerte lo mismo.
  enMapa?: string[]
}

export default function Companera({ mid, claveBloque, papel, alPalabras, enMapa = [] }: Props) {
  const [y, setY] = useState(0)
  const [actual, setActual] = useState<HTMLElement | null>(null)
  const [salto, setSalto] = useState(0)
  const [abierta, setAbierta] = useState(false)
  const [modo, setModo] = useState<'ayuda' | 'comprobar'>('ayuda')
  const [respuesta, setRespuesta] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pregunta, setPregunta] = useState('')
  const [globo, setGlobo] = useState<Globo | null>(null)
  const desde = useRef(Date.now())
  const ultimoGlobo = useRef(0)
  const vistos = useRef(new Set<string>())
  const finOfrecido = useRef(false)

  const quieta = useRef(false)
  quieta.current = abierta || cargando

  const decir = useCallback((g: Globo, clave: string) => {
    if (vistos.current.has(clave) || Date.now() - ultimoGlobo.current < ENTRE_GLOBOS_S * 1000) return
    vistos.current.add(clave)
    ultimoGlobo.current = Date.now()
    setGlobo(g)
  }, [])

  // Se esconde solo al rato.
  useEffect(() => {
    if (!globo) return
    const t = window.setTimeout(() => setGlobo(null), 9000)
    return () => window.clearTimeout(t)
  }, [globo])

  const colocar = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !papel || el === actual || quieta.current) return
      setActual(el)
      setY(el.offsetTop)
      setSalto((s) => s + 1)
      setRespuesta(null)
      setAbierta(false)
      desde.current = Date.now()
    },
    [papel, actual],
  )

  // Seguir la lectura: el párrafo que cruza la franja de lectura, o el que señalas.
  useEffect(() => {
    if (!papel) return
    const parrafos = () =>
      Array.from(papel.querySelectorAll<HTMLElement>('p, li, pre, blockquote, table')).filter((x) => !x.closest('.companera, .al-mapa') && x.innerText.trim().length > 20)
    const zona = papel.closest('.foco-cuerpo')
    const alDesplazar = () => {
      const lista = parrafos()
      const centro = window.innerHeight * 0.42
      let mejor: HTMLElement | null = null
      let dist = Infinity
      for (const p of lista) {
        const r = p.getBoundingClientRect()
        const d = Math.abs(r.top + Math.min(r.height, 80) / 2 - centro)
        if (d < dist) {
          dist = d
          mejor = p
        }
      }
      colocar(mejor)
      // Al final de la idea: que se lo cuentes con tus palabras.
      const ultimo = lista[lista.length - 1]
      if (ultimo && !finOfrecido.current && ultimo.getBoundingClientRect().bottom < window.innerHeight * 0.9) {
        finOfrecido.current = true
        ultimoGlobo.current = 0
        decir(
          {
            texto: 'Antes de seguir: dímelo con tus palabras, en una frase.',
            boton: 'Vale',
            hacer: () => {
              setModo('comprobar')
              setAbierta(true)
            },
          },
          'fin',
        )
      }
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
  }, [papel, colocar, decir])

  // Al llegar a un párrafo: si es código, o si tiene un término en negrita que aún no está en tu mapa.
  useEffect(() => {
    if (!actual || abierta) return
    const id = actual.innerText.slice(0, 40)
    if (actual.tagName === 'PRE') {
      decir({ texto: '¿Te explico este código línea a línea?', boton: 'Sí', hacer: () => pedirAyuda('codigo') }, `codigo:${id}`)
      return
    }
    const termino = Array.from(actual.querySelectorAll('strong, b'))
      .map((x) => x.textContent?.trim() ?? '')
      .find((t) => t.length > 2 && t.length < 40 && !enMapa.some((m) => m.toLowerCase() === t.toLowerCase()))
    if (termino && alPalabras)
      decir({ texto: `¿Añado «${termino}» a tu mapa?`, boton: 'Añadir', hacer: () => alPalabras([termino]) }, `mapa:${termino}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actual])

  // ¿Llevas rato en el mismo párrafo? Se ofrece (una vez por párrafo).
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!actual || abierta || document.visibilityState !== 'visible') return
      if (Date.now() - desde.current > ATASCO_S * 1000)
        decir({ texto: '¿Te atascas aquí? Te lo cuento más fácil.', boton: 'Sí, porfa', hacer: () => pedirAyuda('facil') }, `atasco:${actual.innerText.slice(0, 40)}`)
    }, 4000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actual, abierta])

  const pedirAyuda = async (accion: Accion, texto?: string) => {
    if (!actual) return
    setGlobo(null)
    setAbierta(true)
    setCargando(true)
    setRespuesta(null)
    try {
      const r = await pedir<{ texto: string }>(
        `/api/estudio/${mid}/parrafo`,
        enviarJson({ clave: claveBloque, parrafo: actual.innerText.slice(0, 3900), accion, pregunta: texto ?? null }),
      )
      setRespuesta(r.texto)
      if (accion === 'clave' && alPalabras) {
        const palabras = (r.texto.match(/«([^»]{2,40})»|\*\*([^*]{2,40})\*\*/g) ?? []).map((x) => x.replace(/[«»*]/g, ''))
        if (palabras.length) alPalabras(palabras)
      }
      setPregunta('')
      setModo('ayuda')
    } catch (e) {
      setRespuesta(`No he podido: ${(e as Error).message}`)
    } finally {
      setCargando(false)
    }
  }

  if (!papel || !actual) return null
  const gesto: GestoMascota = cargando ? 'pensando' : respuesta || globo ? 'hablando' : abierta ? 'escuchando' : 'normal'

  return (
    <div className="companera" style={{ transform: `translateY(${y}px)` }}>
      <button
        key={salto}
        type="button"
        className="companera-boton salta"
        onClick={() => {
          setGlobo(null)
          setAbierta(!abierta)
        }}
        aria-expanded={abierta}
        aria-label="Pedir ayuda con este párrafo"
        title="¿Te ayudo con este párrafo?"
      >
        <Mascota gesto={gesto} lugar="companera" />
      </button>
      {globo && !abierta && (
        <div className="companera-globo" role="status">
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
        <div className="companera-bocadillo" role="dialog" aria-label="Ayuda con el párrafo">
          {modo === 'comprobar' && !cargando && !respuesta && <p className="companera-atasco">Cuéntame en una frase lo que te llevas de esta idea:</p>}
          {cargando && <p className="companera-pensando">Déjame pensar…</p>}
          {respuesta && <p className="companera-respuesta">{respuesta.replace(/\*\*/g, '')}</p>}
          {modo === 'ayuda' && (
            <div className="companera-acciones">
              {ACCIONES.map(([a, t]) => (
                <button key={a} type="button" className="opcion opcion-chip" disabled={cargando} onClick={() => pedirAyuda(a)}>
                  {t}
                </button>
              ))}
              {actual.tagName === 'PRE' && (
                <button type="button" className="opcion opcion-chip" disabled={cargando} onClick={() => pedirAyuda('codigo')}>
                  El código, línea a línea
                </button>
              )}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (pregunta.trim()) pedirAyuda(modo === 'comprobar' ? 'comprobar' : 'pregunta', pregunta)
            }}
          >
            <input
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              placeholder={modo === 'comprobar' ? 'Con tus palabras…' : 'Pregúntame sobre este párrafo'}
              aria-label={modo === 'comprobar' ? 'Lo que te llevas, con tus palabras' : 'Tu pregunta sobre el párrafo'}
              autoFocus={modo === 'comprobar'}
            />
          </form>
        </div>
      )}
    </div>
  )
}
