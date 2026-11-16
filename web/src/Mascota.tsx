import { useEffect, useId, useRef, useState } from 'react'

// La mascota de Magister, a elegir en «Afina a tu tutor»: el búho (por defecto) o la sencilla, una piedra redondeada
// con dos ojos. Las pupilas siguen al cursor y de vez en cuando parpadea.
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

function Ojo({ cx, cy, r, p, m }: { cx: number; cy: number; r: number; p: number; m: Punto }) {
  return (
    <g className="mascota-ojo" style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <circle cx={cx} cy={cy} r={r} className="mascota-blanco" />
      <circle cx={cx + m.x} cy={cy + m.y} r={p} className="mascota-pupila" />
      <circle cx={cx + m.x + p * 0.35} cy={cy + m.y - p * 0.4} r={p * 0.3} className="mascota-brillo" />
    </g>
  )
}

export default function Mascota({ mini = false, forma: fija, gesto = 'normal' }: { mini?: boolean; forma?: FormaMascota; gesto?: GestoMascota }) {
  const svg = useRef<SVGSVGElement>(null)
  const mirada = usarMirada(svg)
  const elegida = usarForma()
  const forma = fija ?? elegida
  const id = useId().replace(/:/g, '')
  // Pensando, la mirada se va arriba a un lado, como quien busca la respuesta.
  const m = gesto === 'pensando' ? { x: 2.5, y: -3.5 } : mirada
  const luz = `url(#luz-${id})`

  return (
    <svg
      ref={svg}
      className={`mascota mascota-${forma} gesto-${gesto} ${mini ? 'mascota-mini' : ''}`}
      viewBox="0 0 120 124"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`luz-${id}`} cx="35%" cy="28%" r="75%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.12" />
        </radialGradient>
      </defs>
      {!mini && <ellipse className="mascota-sombra" cx="60" cy="118" rx="30" ry="3.5" />}
      <g className="mascota-figura">
        {forma === 'buho' && (
          <>
            <path className="mascota-cuerpo" d="M24 31 L33 11 L47 26 Q60 22 73 26 L87 11 L96 31 Q108 53 102 81 Q94 111 60 113 Q26 111 18 81 Q12 53 24 31 Z" />
            <path fill={luz} d="M24 31 L33 11 L47 26 Q60 22 73 26 L87 11 L96 31 Q108 53 102 81 Q94 111 60 113 Q26 111 18 81 Q12 53 24 31 Z" />
            <path className="mascota-oreja" d="M30 25 L33.5 16 L40 24 Z M90 25 L86.5 16 L80 24 Z" />
            <path className="mascota-ala" d="M20 66 Q14 84 26 100 Q24 82 30 68 Z M100 66 Q106 84 94 100 Q96 82 90 68 Z" />
            <circle className="mascota-disco" cx="42" cy="56" r="19.5" />
            <circle className="mascota-disco" cx="78" cy="56" r="19.5" />
            <path className="mascota-plumas" d="M47 91 L51 95 L55 91 M56 98 L60 102 L64 98 M65 91 L69 95 L73 91" />
            <Ojo cx={42} cy={56} r={14} p={6.5} m={m} />
            <Ojo cx={78} cy={56} r={14} p={6.5} m={m} />
            <path className="mascota-pico" d="M55.5 70 Q60 68.5 64.5 70 L60 80 Z" />
            <path className="mascota-patas" d="M49 112 L49 116 M53 112 L53 116 M67 112 L67 116 M71 112 L71 116" />
          </>
        )}
        {forma === 'sencilla' && (
          <>
            <path className="mascota-cuerpo" d="M60 12 C92 12 108 30 108 62 C108 94 90 110 60 110 C30 110 12 94 12 62 C12 30 28 12 60 12 Z" />
            <path fill={luz} d="M60 12 C92 12 108 30 108 62 C108 94 90 110 60 110 C30 110 12 94 12 62 C12 30 28 12 60 12 Z" />
            <Ojo cx={44} cy={58} r={11} p={5.5} m={m} />
            <Ojo cx={76} cy={58} r={11} p={5.5} m={m} />
            <ellipse className="mascota-mejilla" cx="33" cy="75" rx="6" ry="3" />
            <ellipse className="mascota-mejilla" cx="87" cy="75" rx="6" ry="3" />
          </>
        )}
      </g>
    </svg>
  )
}
