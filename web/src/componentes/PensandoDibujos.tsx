import { useEffect, useRef, useState } from 'react'

// Más animaciones de espera, en el mismo trazo fino y gris que las otras: dibujos que se construyen solos.
// Cada una es un ciclo corto que vuelve a empezar; con «reducir movimiento» se queda el dibujo terminado.

export const quieto = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// De 0 a 1 en `segundos`, y vuelta a empezar.
export function usarCiclo(segundos: number): number {
  const [f, setF] = useState(() => (quieto() ? 0.9 : 0))
  const marco = useRef(0)
  useEffect(() => {
    if (quieto()) return
    const inicio = performance.now()
    const paso = (ahora: number) => {
      // El primer fotograma puede traer una marca anterior a `inicio`: nunca por debajo de cero.
      setF(((Math.max(0, ahora - inicio) / 1000) % segundos) / segundos)
      marco.current = requestAnimationFrame(paso)
    }
    marco.current = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(marco.current)
  }, [segundos])
  return f
}

// Cuánto de un trazo va dibujado si empieza en `a` y acaba en `b` del ciclo (con arranque y frenada suaves).
export const tramo = (f: number, a: number, b: number) => {
  const t = Math.max(0, Math.min(1, (f - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
// Al final del ciclo el dibujo se desvanece para volver a empezar sin corte.
export const presencia = (f: number) => 1 - tramo(f, 0.93, 1)

export function Trazo({ d, f, desde, hasta, clase = 'trazo' }: { d: string; f: number; desde: number; hasta: number; clase?: string }) {
  const hecho = tramo(f, desde, hasta)
  if (hecho <= 0) return null
  return <path className={clase} d={d} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - hecho} strokeLinecap="round" strokeLinejoin="round" />
}

// ---------- David: una cabeza clásica de perfil, primero el encaje (círculo, ejes, tercios) y luego el contorno ----------

export function David() {
  const f = usarCiclo(9)
  return (
    <svg className="anim-svg" viewBox="0 0 60 64" width={56} height={60} aria-hidden style={{ opacity: presencia(f) }}>
      {/* El encaje, como en un cuaderno de dibujo: el cráneo, la línea de las cejas, la nariz y el mentón. */}
      <Trazo clase="guia" d="M44 24 A17 17 0 1 0 10 24 A17 17 0 1 0 44 24" f={f} desde={0} hasta={0.14} />
      <Trazo clase="guia" d="M5 24 H52" f={f} desde={0.12} hasta={0.19} />
      <Trazo clase="guia" d="M22 35.5 H52" f={f} desde={0.17} hasta={0.23} />
      <Trazo clase="guia" d="M22 48 H52" f={f} desde={0.21} hasta={0.27} />
      <Trazo clase="guia" d="M44 4 V54" f={f} desde={0.25} hasta={0.32} />
      <Trazo clase="guia" d="M27 41 L45 48" f={f} desde={0.3} hasta={0.35} />
      {/* El perfil: frente, nariz, labios, mentón, mandíbula y cuello. */}
      <Trazo d="M31 7.5 C39 7.5 44.5 13 44.5 20.5 L43.6 24.2 L49 33.6 L45.2 35.4 L46.6 38.6 L45 40.2 L46.4 42.4 L44.6 44.4 L45.6 48.2 C43.5 52 38.5 53.2 34.2 51.4 L33.4 61" f={f} desde={0.34} hasta={0.62} />
      {/* El pelo en rizos y la nuca. */}
      <Trazo d="M31 7.5 C19 4.5 8.5 13 10 25 C7.5 30.5 12 37.5 19.5 38.5 C18.6 46 20 54 18 61" f={f} desde={0.58} hasta={0.78} />
      <Trazo d="M17 12 q4 -1 4 4 q-5 1 -4 -4 M11 20 q4 -2 5 3 q-5 2 -5 -3 M14 29 q4 -2 5 3 q-5 2 -5 -3 M24 9 q4 0 3 4.5 q-4.5 0 -3 -4.5" f={f} desde={0.72} hasta={0.86} />
      {/* El ojo, la ceja y la oreja. */}
      <Trazo d="M37.5 22.2 L43 21.4 M38.4 26 q2.6 -1.6 4.6 0.2 M26.5 27 c-3.4 -1.2 -4.6 5.4 0 7.4" f={f} desde={0.8} hasta={0.9} />
    </svg>
  )
}

// ---------- Proporción áurea: los cuadrados de Fibonacci y la espiral que los recorre ----------

// Cuadrados de lado 8, 5, 3, 2, 1, 1 (a 4 px la unidad), colocados en espiral, y el cuarto de círculo de cada uno.
const AUREA: { x: number; y: number; l: number; arco: string }[] = [
  { x: 2, y: 2, l: 32, arco: 'M2 34 A32 32 0 0 1 34 2' },
  { x: 34, y: 2, l: 20, arco: 'M34 2 A20 20 0 0 1 54 22' },
  { x: 42, y: 22, l: 12, arco: 'M54 22 A12 12 0 0 1 42 34' },
  { x: 34, y: 26, l: 8, arco: 'M42 34 A8 8 0 0 1 34 26' },
  { x: 34, y: 22, l: 4, arco: 'M34 26 A4 4 0 0 1 38 22' },
  { x: 38, y: 22, l: 4, arco: 'M38 22 A4 4 0 0 1 42 26' },
]

export function Aurea() {
  const f = usarCiclo(8)
  return (
    <svg className="anim-svg" viewBox="0 0 56 36" width={78} height={50} aria-hidden style={{ opacity: presencia(f) }}>
      {AUREA.map((c, i) => (
        <Trazo key={`c${i}`} clase="guia" d={`M${c.x} ${c.y} h${c.l} v${c.l} h${-c.l} Z`} f={f} desde={i * 0.07} hasta={i * 0.07 + 0.1} />
      ))}
      {AUREA.map((c, i) => (
        <Trazo key={`a${i}`} d={c.arco} f={f} desde={0.5 + i * 0.065} hasta={0.5 + (i + 1) * 0.065} />
      ))}
    </svg>
  )
}

// ---------- Euclides, I.1: con regla y compás, un triángulo equilátero sobre un segmento ----------

export function Euclides() {
  const f = usarCiclo(8)
  const punto = (x: number, y: number, desde: number) => (tramo(f, desde, desde + 0.03) > 0 ? <circle cx={x} cy={y} r={1.3} fill="currentColor" opacity={tramo(f, desde, desde + 0.05)} /> : null)
  return (
    <svg className="anim-svg" viewBox="0 0 72 54" width={76} height={57} aria-hidden style={{ opacity: presencia(f) }}>
      <Trazo d="M26 36 H46" f={f} desde={0} hasta={0.12} />
      {punto(26, 36, 0.02)}
      {punto(46, 36, 0.1)}
      {/* El compás en A con abertura AB, y luego en B. */}
      <Trazo clase="guia" d="M46 36 A20 20 0 1 0 6 36 A20 20 0 1 0 46 36" f={f} desde={0.14} hasta={0.4} />
      <Trazo clase="guia" d="M26 36 A20 20 0 1 1 66 36 A20 20 0 1 1 26 36" f={f} desde={0.38} hasta={0.64} />
      {punto(36, 18.68, 0.64)}
      <Trazo d="M26 36 L36 18.68" f={f} desde={0.68} hasta={0.78} />
      <Trazo d="M46 36 L36 18.68" f={f} desde={0.76} hasta={0.86} />
    </svg>
  )
}

// ---------- Péndulos: nueve péndulos de largos distintos que se desacompasan y vuelven a ir juntos ----------

const PENDULOS = Array.from({ length: 9 }, (_, i) => i)

export function Pendulos() {
  const f = usarCiclo(20)
  const t = quieto() ? 0.07 : f
  return (
    <svg className="anim-svg" viewBox="0 0 74 50" width={74} height={50} aria-hidden>
      <path className="guia" d="M4 4 H70" />
      {PENDULOS.map((i) => {
        // En un ciclo, el primero da 12 vaivenes y cada uno, uno más: por eso se reencuentran al final.
        const ang = 0.5 * Math.cos(2 * Math.PI * (12 + i) * t)
        const largo = 40 - i * 2.4
        const x0 = 9 + i * 7
        const x = x0 + largo * Math.sin(ang)
        const y = 4 + largo * Math.cos(ang)
        return (
          <g key={i}>
            <line className="guia" x1={x0} y1={4} x2={x} y2={y} strokeWidth={0.6} />
            <circle cx={x} cy={y} r={2.1} fill="currentColor" />
          </g>
        )
      })}
    </svg>
  )
}
