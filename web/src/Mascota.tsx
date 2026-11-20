import { useEffect, useRef, useState } from 'react'
import { estaDormida, EVENTO_REACCION, EVENTO_SUENO, vigilarSueno, type Reaccion } from './componentes/animo.ts'

// La mascota de Magister, a elegir en Ajustes: la sencilla (por defecto), el cerebro con gafas o el planeta. Estilo
// plano, con ojos que miran hacia el cursor y parpadean.
// Es decorativa: no recibe foco ni la leen los lectores de pantalla.

export type FormaMascota = 'sencilla' | 'cerebro' | 'planeta'
export const FORMAS: { id: FormaMascota; nombre: string }[] = [
  { id: 'sencilla', nombre: 'Sencilla' },
  { id: 'cerebro', nombre: 'Cerebro' },
  { id: 'planeta', nombre: 'Planeta' },
]
// Colores propios de las optativas (el cerebro es rosa y el anillo del planeta ámbar en los dos temas).
const ROSA = '#e8a6b0'
const ROSA_OSCURO = '#c97f8c'
const AMBAR = '#e8a33d'

const CLAVE = 'magister-mascota'
const EVENTO = 'magister-mascota'

export function formaGuardada(): FormaMascota {
  try {
    const f = localStorage.getItem(CLAVE)
    // Quien tenía el búho (ya no existe) pasa a la sencilla.
    return FORMAS.some((x) => x.id === f) ? (f as FormaMascota) : 'sencilla'
  } catch {
    return 'sencilla'
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

// Ojos como los de la primera mascota: blancos, alargados y sin pupila; se mueven enteros hacia donde miras.
// `giro` inclina los dos ojos hacia fuera (grados): el izquierdo hacia la izquierda y el derecho hacia la derecha. El
// giro va en un <g> aparte para que el parpadeo (un transform de CSS en el ojo) no lo pise.
// `clase` da el color: blancos sobre el cuerpo oscuro (por defecto) o pupilas oscuras tras las gafas del cerebro.
function Ojos({ izq, der, ancho, alto, m, giro = 0, clase = 'mascota-blanco' }: { izq: Punto; der: Punto; ancho: number; alto: number; m: Punto; giro?: number; clase?: string }) {
  return (
    <g className="mascota-ojos" style={{ transform: `translate(${m.x}px, ${m.y}px)` }}>
      {[izq, der].map((o, k) => (
        <g key={k} transform={`rotate(${k === 0 ? -giro : giro} ${o.x} ${o.y})`}>
          <ellipse className={`mascota-ojo ${clase}`} cx={o.x} cy={o.y} rx={ancho} ry={alto} style={{ transformOrigin: `${o.x}px ${o.y}px` }} />
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
        {forma === 'sencilla' && (
          <>
            <circle className="mascota-cuerpo" cx="60" cy="62" r="54" />
            <Ojos izq={{ x: 42, y: 58 }} der={{ x: 78, y: 58 }} ancho={7.5} alto={17.8} giro={28} m={m} />
          </>
        )}
        {forma === 'cerebro' && (
          <>
            {/* Cerebro flotante con gafas redondas de profesor y pajarita: las pupilas, tras los cristales. */}
            <path fill={ROSA} d="M30 70 C14 66 14 42 30 38 C30 22 50 16 60 26 C70 16 90 22 90 38 C106 42 106 66 90 70 C88 84 70 86 60 78 C50 86 32 84 30 70Z" />
            <path fill="none" stroke={ROSA_OSCURO} strokeWidth="2.4" strokeLinecap="round" d="M60 26 L60 78 M40 40 q8 6 2 14 M78 40 q-8 6 -2 14 M34 60 q10 -2 12 8 M86 60 q-10 -2 -12 8" />
            <circle className="mascota-blanco" cx="46" cy="52" r="11" style={{ stroke: 'var(--m-cuerpo)', strokeWidth: 3 }} />
            <circle className="mascota-blanco" cx="74" cy="52" r="11" style={{ stroke: 'var(--m-cuerpo)', strokeWidth: 3 }} />
            <line x1="57" y1="52" x2="63" y2="52" style={{ stroke: 'var(--m-cuerpo)', strokeWidth: 3 }} />
            <Ojos izq={{ x: 46, y: 52 }} der={{ x: 74, y: 52 }} ancho={3} alto={5} m={{ x: m.x * 0.5, y: m.y * 0.5 }} clase="mascota-pupila" />
            <path fill={AMBAR} d="M48 96 L60 90 L72 96 L72 104 L60 98 L48 104Z" />
            <circle cx="60" cy="97" r="3" fill="#c98622" />
          </>
        )}
        {forma === 'planeta' && (
          <>
            {/* Planeta con anillo y los ojos inclinados de la sencilla: el anillo pasa por detrás y por delante. */}
            <ellipse cx="60" cy="64" rx="56" ry="12" fill="none" stroke={AMBAR} strokeWidth="5" transform="rotate(-14 60 64)" />
            <circle className="mascota-cuerpo" cx="60" cy="60" r="38" />
            <path fill="none" strokeWidth="5" strokeLinecap="round" style={{ stroke: 'color-mix(in srgb, var(--m-claro) 12%, var(--m-cuerpo))' }} d="M26 46 q20 6 40 -2 q14 -6 28 4 M24 70 q22 8 46 0 q12 -4 24 4" />
            <Ojos izq={{ x: 48, y: 58 }} der={{ x: 72, y: 58 }} ancho={5.5} alto={12.5} giro={28} m={m} />
            <path fill="none" stroke={AMBAR} strokeWidth="5" d="M4 70 Q60 86 116 56" transform="rotate(-2 60 64)" />
            <circle cx="16" cy="20" r="2" fill={AMBAR} />
            <circle cx="104" cy="16" r="1.6" fill={AMBAR} />
            <circle cx="96" cy="104" r="2" fill={AMBAR} />
          </>
        )}
      </g>
    </svg>
  )
}
