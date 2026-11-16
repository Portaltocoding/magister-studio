import { useEffect, useRef, useState } from 'react'

// La mascota: una bola negra con dos ojos blancos alargados, sencillos como los de Jiji,
// que se desplazan un poco hacia el cursor.
// Es decorativa: no recibe foco ni la leen los lectores de pantalla.

const OJOS = [
  { x: 42, y: 56 },
  { x: 78, y: 56 },
]
const ANCHO_OJO = 9
const ALTO_OJO = 16
const RECORRIDO = 4 // cuánto se mueven como mucho, en unidades del dibujo (la cara mide 120)

type Punto = { x: number; y: number }

export default function Mascota({ mini = false }: { mini?: boolean }) {
  const svg = useRef<SVGSVGElement>(null)
  const [mirada, setMirada] = useState<Punto>({ x: 0, y: 0 })

  useEffect(() => {
    let pendiente = 0
    let ultimo: Punto | null = null

    const mirar = () => {
      pendiente = 0
      const caja = svg.current?.getBoundingClientRect()
      if (!caja || !ultimo) return
      // Los dos ojos se mueven juntos, según dónde está el cursor respecto al centro de la cara.
      const dx = ultimo.x - (caja.left + caja.width / 2)
      const dy = ultimo.y - (caja.top + caja.height / 2)
      const distancia = Math.hypot(dx, dy)
      if (distancia === 0) return setMirada({ x: 0, y: 0 })
      const alcance = Math.min(1, distancia / 200) * RECORRIDO
      setMirada({ x: (dx / distancia) * alcance, y: (dy / distancia) * alcance })
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
  }, [])

  return (
    <svg ref={svg} className={mini ? 'mascota mascota-mini' : 'mascota'} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle className="mascota-cuerpo" cx="60" cy="60" r="56" />
      <g className="mascota-ojos" style={{ transform: `translate(${mirada.x}px, ${mirada.y}px)` }}>
        {OJOS.map((ojo, i) => (
          <ellipse key={i} cx={ojo.x} cy={ojo.y} rx={ANCHO_OJO} ry={ALTO_OJO} fill="#fff" />
        ))}
      </g>
    </svg>
  )
}
