import { useEffect, useRef, useState } from 'react'

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

function usarMirada(svg: React.RefObject<SVGSVGElement | null>): Punto {
  const [mirada, setMirada] = useState<Punto>({ x: 0, y: 0 })
  useEffect(() => {
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
  }, [svg])
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
function Ojos({ izq, der, ancho, alto, m }: { izq: Punto; der: Punto; ancho: number; alto: number; m: Punto }) {
  return (
    <g className="mascota-ojos" style={{ transform: `translate(${m.x}px, ${m.y}px)` }}>
      {[izq, der].map((o, k) => (
        <ellipse key={k} className="mascota-ojo mascota-blanco" cx={o.x} cy={o.y} rx={ancho} ry={alto} style={{ transformOrigin: `${o.x}px ${o.y}px` }} />
      ))}
    </g>
  )
}

export default function Mascota({ mini = false, forma: fija, gesto = 'normal' }: { mini?: boolean; forma?: FormaMascota; gesto?: GestoMascota }) {
  const svg = useRef<SVGSVGElement>(null)
  const mirada = usarMirada(svg)
  const elegida = usarForma()
  const forma = fija ?? elegida
  // Pensando, la mirada se va arriba a un lado, como quien busca la respuesta.
  const m = gesto === 'pensando' ? { x: 3, y: -4 } : mirada

  return (
    <svg
      ref={svg}
      className={`mascota mascota-${forma} gesto-${gesto} ${mini ? 'mascota-mini' : ''}`}
      viewBox="0 0 120 124"
      aria-hidden="true"
      focusable="false"
    >
      {!mini && <ellipse className="mascota-sombra" cx="60" cy="118" rx="28" ry="3" />}
      <g className="mascota-figura">
        {forma === 'buho' && (
          <>
            {/* Silueta de búho: cuerpo redondeado con dos orejas en punta; nada más. */}
            <path className="mascota-cuerpo" d="M22 34 L30 8 L48 26 Q60 23 72 26 L90 8 L98 34 Q110 58 104 84 Q96 113 60 113 Q24 113 16 84 Q10 58 22 34 Z" />
            <Ojos izq={{ x: 44, y: 60 }} der={{ x: 76, y: 60 }} ancho={9} alto={16} m={m} />
          </>
        )}
        {forma === 'sencilla' && (
          <>
            <circle className="mascota-cuerpo" cx="60" cy="62" r="54" />
            <Ojos izq={{ x: 42, y: 58 }} der={{ x: 78, y: 58 }} ancho={9} alto={16} m={m} />
          </>
        )}
      </g>
    </svg>
  )
}
