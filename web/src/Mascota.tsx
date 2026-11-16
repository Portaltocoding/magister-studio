import { useEffect, useRef, useState } from 'react'

// La mascota de Magister. Tres formas propias para elegir en «Afina a tu tutor»: búho (por defecto), birrete y gota
// de tinta. Las pupilas siguen al cursor y de vez en cuando parpadea.
// Es decorativa: no recibe foco ni la leen los lectores de pantalla.

export type FormaMascota = 'buho' | 'birrete' | 'tinta'
export const FORMAS: { id: FormaMascota; nombre: string }[] = [
  { id: 'buho', nombre: 'Búho' },
  { id: 'birrete', nombre: 'Birrete' },
  { id: 'tinta', nombre: 'Gota de tinta' },
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

function Ojo({ cx, cy, r, p, m }: { cx: number; cy: number; r: number; p: number; m: Punto }) {
  return (
    <g className="mascota-ojo" style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <circle cx={cx} cy={cy} r={r} className="mascota-blanco" />
      <circle cx={cx + m.x} cy={cy + m.y} r={p} className="mascota-pupila" />
      <circle cx={cx + m.x + p * 0.35} cy={cy + m.y - p * 0.4} r={p * 0.28} className="mascota-brillo" />
    </g>
  )
}

export default function Mascota({ mini = false, forma: fija }: { mini?: boolean; forma?: FormaMascota }) {
  const svg = useRef<SVGSVGElement>(null)
  const m = usarMirada(svg)
  const elegida = usarForma()
  const forma = fija ?? elegida

  return (
    <svg ref={svg} className={`mascota mascota-${forma} ${mini ? 'mascota-mini' : ''}`} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      {forma === 'buho' && (
        <>
          <path className="mascota-cuerpo" d="M24 30 L34 12 L46 26 Q60 22 74 26 L86 12 L96 30 Q108 52 102 80 Q94 110 60 112 Q26 110 18 80 Q12 52 24 30 Z" />
          <path className="mascota-plumas" d="M46 90 L50 94 L54 90 M56 96 L60 100 L64 96 M66 90 L70 94 L74 90" />
          <Ojo cx={42} cy={56} r={15} p={6.5} m={m} />
          <Ojo cx={78} cy={56} r={15} p={6.5} m={m} />
          <path className="mascota-pico" d="M55 70 L65 70 L60 79 Z" />
        </>
      )}
      {forma === 'birrete' && (
        <>
          <rect className="mascota-cara" x="22" y="40" width="76" height="70" rx="26" />
          <path className="mascota-cuerpo" d="M60 14 L106 32 L60 50 L14 32 Z" />
          <path className="mascota-cuerpo" d="M36 38 L36 50 Q60 60 84 50 L84 38 L60 47 Z" />
          <path className="mascota-borla" d="M96 36 L96 58" />
          <circle className="mascota-borla-punta" cx="96" cy="61" r="3.5" />
          <Ojo cx={46} cy={76} r={9} p={4.5} m={m} />
          <Ojo cx={74} cy={76} r={9} p={4.5} m={m} />
          <path className="mascota-boca" d="M53 93 Q60 98 67 93" />
        </>
      )}
      {forma === 'tinta' && (
        <>
          <path className="mascota-cuerpo" d="M60 8 Q74 34 92 56 Q108 78 96 98 Q82 116 60 114 Q38 116 24 98 Q12 78 28 56 Q46 34 60 8 Z" />
          <path className="mascota-reflejo" d="M36 70 Q34 84 42 94" />
          <Ojo cx={47} cy={78} r={11} p={5} m={m} />
          <Ojo cx={73} cy={78} r={11} p={5} m={m} />
        </>
      )}
    </svg>
  )
}
