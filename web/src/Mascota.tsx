import { useEffect, useRef, useState } from 'react'
import { estaDormida, EVENTO_REACCION, EVENTO_SUENO, vigilarSueno, type Reaccion } from './componentes/animo.ts'

// La mascota de Magister, a elegir en «Afina a tu tutor»: el búho (por defecto) o la sencilla. Las dos en el estilo de
// la primera: silueta negra y plana con dos ojos blancos alargados, sin pupila, que miran hacia el cursor y parpadean.
// Es decorativa: no recibe foco ni la leen los lectores de pantalla.

export type FormaMascota = 'buho' | 'sencilla'
export const FORMAS: { id: FormaMascota; nombre: string }[] = [
  { id: 'buho', nombre: 'Búho' },
  { id: 'sencilla', nombre: 'Sencilla' },
]

const CLAVE = 'magister-mascota'
const EVENTO = 'magister-mascota'

export function formaGuardada(): FormaMascota {
  try {
    const f = localStorage.getItem(CLAVE)
    return FORMAS.some((x) => x.id === f) ? (f as FormaMascota) : 'buho'
  } catch {
    return 'buho'
  }
}

export function elegirForma(f: FormaMascota) {
  try {
    localStorage.setItem(CLAVE, f)
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: f }))
}

type Punto = { x: number; y: number }
const RECORRIDO = 4 // cuánto se mueven las pupilas como mucho, en unidades del dibujo (mide 120)

function usarMirada(svg: React.RefObject<SVGSVGElement | null>, activa = true): Punto {
  const [mirada, setMirada] = useState<Punto>({ x: 0, y: 0 })
  useEffect(() => {
    // Quieta no sigue el ratón: así no se repinta en cada movimiento.
    if (!activa) return
    let pendiente = 0
    let ultimo: Punto | null = null
    const mirar = () => {
      pendiente = 0
      const caja = svg.current?.getBoundingClientRect()
      if (!caja || !ultimo) return
      const dx = ultimo.x - (caja.left + caja.width / 2)
      const dy = ultimo.y - (caja.top + caja.height / 2)
      const d = Math.hypot(dx, dy)
      if (d === 0) return setMirada({ x: 0, y: 0 })
      const alcance = Math.min(1, d / 200) * RECORRIDO
      setMirada({ x: (dx / d) * alcance, y: (dy / d) * alcance })
    }
    const alMover = (e: PointerEvent) => {
      ultimo = { x: e.clientX, y: e.clientY }
      if (!pendiente) pendiente = requestAnimationFrame(mirar)
    }
    window.addEventListener('pointermove', alMover)
    return () => {
      window.removeEventListener('pointermove', alMover)
      cancelAnimationFrame(pendiente)
    }
  }, [svg, activa])
  return mirada
}

export function usarForma(): FormaMascota {
  const [forma, setForma] = useState<FormaMascota>(formaGuardada)
  useEffect(() => {
    const al = (e: Event) => setForma((e as CustomEvent<FormaMascota>).detail)
    window.addEventListener(EVENTO, al)
    return () => window.removeEventListener(EVENTO, al)
  }, [])
  return forma
}

// Cómo está: cambia la mirada y el gesto. «pensando» mira arriba; «escuchando» ladea la cabeza; «hablando» se mueve un poco.
export type GestoMascota = 'normal' | 'pensando' | 'escuchando' | 'hablando'

// Ojos de gato: almendra blanca con las esquinas externas algo levantadas, pupila vertical (se ensancha al escuchar o
// hablar) y un brillito. Se mueven enteros hacia donde miras y el párpado (el parpadeo) cierra la almendra.
function Ojos({ izq, der, ancho, alto, m }: { izq: Punto; der: Punto; ancho: number; alto: number; m: Punto }) {
  const w = ancho
  const h = alto
  const almendra = `M${-w} 0 C${-w * 0.45} ${-h * 1.3} ${w * 0.45} ${-h * 1.3} ${w} 0 C${w * 0.45} ${h * 1.3} ${-w * 0.45} ${h * 1.3} ${-w} 0 Z`
  return (
    <g className="mascota-ojos" style={{ transform: `translate(${m.x}px, ${m.y}px)` }}>
      {[izq, der].map((o, k) => (
        <g key={k} className="mascota-ojo" style={{ transformOrigin: `${o.x}px ${o.y}px` }}>
          <g transform={`translate(${o.x} ${o.y}) rotate(${k === 0 ? 8 : -8})`}>
            <path className="mascota-blanco" d={almendra} />
            <ellipse className="mascota-pupila mascota-rendija" cx={0} cy={0} rx={w * 0.2} ry={h * 0.92} />
            <circle className="mascota-brillo" cx={-w * 0.12} cy={-h * 0.3} r={Math.max(1.2, w * 0.1)} />
          </g>
        </g>
      ))}
    </g>
  )
}

// Mantener pulsada la mascota la coge: cierra los ojos, te sigue y se queda donde la sueltes (cada pantalla, en su
// sitio: `lugar`). Un doble clic la devuelve a su sitio. Un clic normal sigue siendo un clic.
const ESPERA_COGER = 350 // ms pulsando para cogerla
const HOLGURA = 8 // px que se puede mover el dedo antes de cogerla sin que cuente como arrastrar la página
const claveSitio = (lugar: string) => `magister-mascota-sitio-${lugar}`

function leerSitio(lugar?: string): Punto {
  if (!lugar) return { x: 0, y: 0 }
  try {
    const p = JSON.parse(localStorage.getItem(claveSitio(lugar)) ?? 'null')
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : { x: 0, y: 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

function guardarSitio(lugar: string | undefined, p: Punto) {
  if (!lugar) return
  try {
    if (p.x === 0 && p.y === 0) localStorage.removeItem(claveSitio(lugar))
    else localStorage.setItem(claveSitio(lugar), JSON.stringify(p))
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}

function usarArrastre(svg: React.RefObject<SVGSVGElement | null>, lugar: string | undefined, activo: boolean) {
  const [sitio, setSitio] = useState<Punto>(() => leerSitio(lugar))
  const [cogida, setCogida] = useState(false)
  const sitioRef = useRef(sitio)
  sitioRef.current = sitio

  useEffect(() => {
    const el = svg.current
    if (!el || !activo) return
    let temporizador = 0
    let inicio: { x: number; y: number; sitio: Punto; caja: DOMRect; id: number } | null = null
    let arrastrando = false
    // Que no se salga de la pantalla: su centro siempre dentro de la ventana.
    const limitar = (p: Punto, caja: DOMRect, base: Punto): Punto => {
      const cx = caja.left - base.x + caja.width / 2
      const cy = caja.top - base.y + caja.height / 2
      return {
        x: Math.round(Math.max(-cx + 16, Math.min(window.innerWidth - cx - 16, p.x))),
        y: Math.round(Math.max(-cy + 16, Math.min(window.innerHeight - cy - 16, p.y))),
      }
    }
    const tragarClic = (e: Event) => {
      e.stopPropagation()
      e.preventDefault()
    }
    const soltar = () => {
      window.clearTimeout(temporizador)
      if (arrastrando) {
        guardarSitio(lugar, sitioRef.current)
        // El clic que llega al soltar no es un clic: no abre nada.
        window.addEventListener('click', tragarClic, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', tragarClic, { capture: true }), 0)
      }
      arrastrando = false
      inicio = null
      setCogida(false)
    }
    const alBajar = (e: PointerEvent) => {
      if (e.button !== 0) return
      inicio = { x: e.clientX, y: e.clientY, sitio: sitioRef.current, caja: el.getBoundingClientRect(), id: e.pointerId }
      temporizador = window.setTimeout(() => {
        if (!inicio) return
        arrastrando = true
        setCogida(true)
        try {
          el.setPointerCapture(inicio.id)
        } catch {
          /* el puntero ya se fue */
        }
      }, ESPERA_COGER)
    }
    const alMover = (e: PointerEvent) => {
      if (!inicio) return
      const dx = e.clientX - inicio.x
      const dy = e.clientY - inicio.y
      if (!arrastrando) {
        if (Math.hypot(dx, dy) > HOLGURA) {
          window.clearTimeout(temporizador)
          inicio = null
        }
        return
      }
      e.preventDefault()
      setSitio(limitar({ x: inicio.sitio.x + dx, y: inicio.sitio.y + dy }, inicio.caja, inicio.sitio))
    }
    const volver = () => {
      setSitio({ x: 0, y: 0 })
      guardarSitio(lugar, { x: 0, y: 0 })
    }
    const sinMenu = (e: Event) => arrastrando && e.preventDefault()
    el.addEventListener('pointerdown', alBajar)
    el.addEventListener('pointermove', alMover)
    el.addEventListener('pointerup', soltar)
    el.addEventListener('pointercancel', soltar)
    el.addEventListener('dblclick', volver)
    el.addEventListener('contextmenu', sinMenu)
    return () => {
      window.clearTimeout(temporizador)
      el.removeEventListener('pointerdown', alBajar)
      el.removeEventListener('pointermove', alMover)
      el.removeEventListener('pointerup', soltar)
      el.removeEventListener('pointercancel', soltar)
      el.removeEventListener('dblclick', volver)
      el.removeEventListener('contextmenu', sinMenu)
    }
  }, [svg, lugar, activo])

  return { sitio, cogida }
}

// Lo que le pasa a la mascota además de su gesto: una reacción breve (asentir, ladearse, saltar) y el sueño.
function usarAnimo(): { reaccion: Reaccion | null; dormida: boolean } {
  const [reaccion, setReaccion] = useState<Reaccion | null>(null)
  const [dormida, setDormida] = useState(estaDormida)
  useEffect(() => {
    vigilarSueno()
    let t = 0
    const alReaccion = (e: Event) => {
      window.clearTimeout(t)
      setReaccion(null)
      // Un fotograma sin clase: así la misma reacción dos veces seguidas vuelve a animarse.
      requestAnimationFrame(() => setReaccion((e as CustomEvent<Reaccion>).detail))
      t = window.setTimeout(() => setReaccion(null), 1100)
    }
    const alSueno = (e: Event) => setDormida((e as CustomEvent<boolean>).detail)
    window.addEventListener(EVENTO_REACCION, alReaccion)
    window.addEventListener(EVENTO_SUENO, alSueno)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener(EVENTO_REACCION, alReaccion)
      window.removeEventListener(EVENTO_SUENO, alSueno)
    }
  }, [])
  return { reaccion, dormida }
}

export default function Mascota({
  mini = false,
  forma: fija,
  gesto = 'normal',
  lugar,
  quieta = false,
}: {
  mini?: boolean
  forma?: FormaMascota
  gesto?: GestoMascota
  // Dónde está (tutor, llamada…): si se da, se puede coger y mover, y se recuerda dónde la dejaste.
  lugar?: string
  // Quieta del todo: ni mira, ni parpadea, ni reacciona, ni se duerme (la de la barra, hasta que la sacas).
  quieta?: boolean
}) {
  const svg = useRef<SVGSVGElement>(null)
  const mirada = usarMirada(svg, !quieta)
  const elegida = usarForma()
  const forma = fija ?? elegida
  const { sitio, cogida } = usarArrastre(svg, lugar, !!lugar && !mini)
  const movida = sitio.x !== 0 || sitio.y !== 0
  const animo = usarAnimo()
  const reaccion = quieta ? null : animo.reaccion
  const dormida = quieta ? false : animo.dormida
  // Pensando, la mirada se va arriba a un lado, como quien busca la respuesta. Quieta, mira al frente.
  const m = quieta ? { x: 0, y: 0 } : gesto === 'pensando' ? { x: 3, y: -4 } : mirada

  return (
    <svg
      ref={svg}
      className={`mascota mascota-${forma} gesto-${gesto} ${mini ? 'mascota-mini' : ''} ${lugar && !mini ? 'mascota-movible' : ''} ${cogida ? 'cogida' : ''} ${movida ? 'movida' : ''} ${reaccion ? `reacciona-${reaccion}` : ''} ${dormida && !cogida ? 'dormida' : ''} ${quieta ? 'quieta' : ''}`}
      style={movida || cogida ? { translate: `${sitio.x}px ${sitio.y}px` } : undefined}
      viewBox="0 0 120 124"
      aria-hidden="true"
      focusable="false"
    >
      <g className="mascota-figura">
        {forma === 'buho' && (
          <>
            {/* Búho plano: cuerpo de huevo, penachos cortos que se abren hacia fuera (no cuernos), disco facial más
                claro con ojos redondos, pico ámbar, alas, plumas en el pecho y patitas. */}
            {/* Una sola silueta (cuerpo y penachos), para que el contorno del modo oscuro no deje costuras. */}
            <path
              className="mascota-cuerpo"
              d="M16 68 C16 50 21 40 30 34 C22 28 16 21 15 13 C25 16 34 21 42 27 C47 24 53 22 60 22 C67 22 73 24 78 27 C86 21 95 16 105 13 C104 21 98 28 90 34 C99 40 104 50 104 68 C104 98 86 112 60 112 C34 112 16 98 16 68 Z"
            />
            <path className="mascota-ala" d="M22 62 C16 80 22 96 38 104" />
            <path className="mascota-ala" d="M98 62 C104 80 98 96 82 104" />
            <circle className="mascota-disco" cx="43" cy="58" r="19" />
            <circle className="mascota-disco" cx="77" cy="58" r="19" />
            <path className="mascota-pluma" d="M50 90 l5 4 l5 -4 M60 90 l5 4 l5 -4 M55 98 l5 4 l5 -4" />
            <Ojos izq={{ x: 43, y: 58 }} der={{ x: 77, y: 58 }} ancho={13} alto={8.5} m={m} />
            <path className="mascota-pico" d="M54.5 69 Q60 66 65.5 69 L60 79 Z" />
            <path className="mascota-pata" d="M44 111 q2 4 4 0 q2 4 4 0 M68 111 q2 4 4 0 q2 4 4 0" />
          </>
        )}
        {forma === 'sencilla' && (
          <>
            <circle className="mascota-cuerpo" cx="60" cy="62" r="54" />
            <Ojos izq={{ x: 42, y: 58 }} der={{ x: 78, y: 58 }} ancho={14} alto={10} m={m} />
          </>
        )}
      </g>
    </svg>
  )
}
