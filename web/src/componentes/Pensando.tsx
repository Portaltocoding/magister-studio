import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

// Animaciones de espera mientras el tutor piensa o genera. Todas en línea, sin relleno,
// pequeñas, y una al azar cada vez para que no aburran.

export type Variante = 'rubik' | 'hanoi' | 'ordenar' | 'fourier' | 'lissajous'
const VARIANTES: Variante[] = ['rubik', 'hanoi', 'ordenar', 'fourier', 'lissajous']

const quieto = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ---------- Rubik: 26 cubitos iguales dibujados en SVG, con caras ocultas y giros por los tres ejes ----------

type V3 = [number, number, number]
const EJE = { x: 0, y: 1, z: 2 } as const
type Eje = keyof typeof EJE
const SEPARACION = 1.07 // cubito de lado 1, con una rendija entre ellos
const ESCALA = 8.6
const CUBITOS: V3[] = []
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) CUBITOS.push([x, y, z])

// Las seis caras de un cubito: normal y cuatro esquinas, en coordenadas del cubo.
function carasDe(p: V3): { n: V3; esquinas: V3[] }[] {
  const c = p.map((v) => v * SEPARACION) as V3
  const salida: { n: V3; esquinas: V3[] }[] = []
  for (let a = 0; a < 3; a++)
    for (const s of [-1, 1]) {
      const u = (a + 1) % 3
      const w = (a + 2) % 3
      const esquinas: V3[] = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([du, dw]) => {
        const q = [...c] as V3
        q[a] += s * 0.5
        q[u] += du * 0.5
        q[w] += dw * 0.5
        return q
      })
      const n: V3 = [0, 0, 0]
      n[a] = s
      salida.push({ n, esquinas })
    }
  return salida
}
const CARAS = CUBITOS.map((p) => ({ p, caras: carasDe(p) }))

function girar(v: V3, eje: number, ang: number): V3 {
  const [c, s] = [Math.cos(ang), Math.sin(ang)]
  const [x, y, z] = v
  if (eje === 0) return [x, y * c - z * s, y * s + z * c]
  if (eje === 1) return [x * c + z * s, y, -x * s + z * c]
  return [x * c - y * s, x * s + y * c, z]
}

const suave = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

function Rubik() {
  const [t, setT] = useState(0)
  const mov = useRef<{ eje: Eje; capa: number; signo: number; desde: number }>({ eje: 'y', capa: 1, signo: 1, desde: 0 })
  useEffect(() => {
    if (quieto()) return
    let marco = 0
    const ejes: Eje[] = ['x', 'y', 'z']
    const paso = (ahora: number) => {
      // Cada giro dura 520 ms y luego descansa 180; al acabar, el cubo queda igual y se elige otro.
      if (ahora - mov.current.desde > 700)
        mov.current = { eje: ejes[Math.floor(Math.random() * 3)], capa: Math.floor(Math.random() * 3) - 1, signo: Math.random() < 0.5 ? 1 : -1, desde: ahora }
      setT(ahora)
      marco = requestAnimationFrame(paso)
    }
    marco = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(marco)
  }, [])

  const m = mov.current
  const avance = suave(Math.min(1, Math.max(0, (t - m.desde) / 520)))
  const anguloCapa = m.signo * avance * (Math.PI / 2)
  const guinada = t / 5200
  const cabeceo = -0.46
  const ver = (v: V3) => girar(girar(v, 1, guinada), 0, cabeceo)

  const poligonos: { z: number; puntos: string }[] = []
  for (const { p, caras } of CARAS) {
    const enCapa = p[EJE[m.eje]] === m.capa
    for (const { n, esquinas } of caras) {
      const mover = (v: V3) => ver(enCapa ? girar(v, EJE[m.eje], anguloCapa) : v)
      if (mover(n)[2] - mover([0, 0, 0])[2] <= 0.01) continue // de espaldas: no se ve
      const vs = esquinas.map(mover)
      poligonos.push({
        z: vs.reduce((a, v) => a + v[2], 0) / 4,
        puntos: vs.map(([x, y]) => `${(32 + x * ESCALA).toFixed(2)},${(32 - y * ESCALA).toFixed(2)}`).join(' '),
      })
    }
  }
  poligonos.sort((a, b) => a.z - b.z)
  return (
    <svg className="anim-svg rubik" viewBox="0 0 64 64" width={64} height={64} aria-hidden>
      {poligonos.map((q, i) => (
        <polygon key={i} className="cara" points={q.puntos} />
      ))}
    </svg>
  )
}

// ---------- Hanói ----------

function movimientos(n: number, desde = 0, hacia = 2, via = 1): [number, number][] {
  if (n === 0) return []
  return [...movimientos(n - 1, desde, via, hacia), [desde, hacia], ...movimientos(n - 1, via, hacia, desde)]
}

const DISCOS = 4

function Hanoi() {
  const pasos = useMemo(() => movimientos(DISCOS), [])
  const paso = usarReloj(380, pasos.length + 4)
  const varillas: number[][] = [[...Array(DISCOS).keys()].reverse(), [], []]
  for (const [a, b] of pasos.slice(0, Math.min(paso, pasos.length))) varillas[b].push(varillas[a].pop()!)
  const xs = [20, 60, 100]
  return (
    <svg className="anim-svg" viewBox="0 0 120 54" width={120} height={54} aria-hidden>
      <line className="guia" x1="4" y1="51" x2="116" y2="51" />
      {xs.map((x) => (
        <line key={x} className="guia" x1={x} y1={12} x2={x} y2={51} />
      ))}
      {varillas.flatMap((pila, v) =>
        pila.map((d, alto) => {
          const w = 12 + d * 7
          return <rect key={d} className="trazo movil" width={w} height={7} rx={2} style={{ transform: `translate(${xs[v] - w / 2}px, ${51 - (alto + 1) * 8}px)` }} />
        }),
      )}
    </svg>
  )
}

// ---------- Ordenación por inserción ----------

const ALTURAS = [5, 2, 7, 1, 6, 3, 8, 4]

function pasosOrdenar(): { v: number[]; i: number; j: number }[] {
  const v = [...ALTURAS]
  const salida = [{ v: [...v], i: -1, j: -1 }]
  for (let i = 1; i < v.length; i++)
    for (let j = i; j > 0 && v[j - 1] > v[j]; j--) {
      ;[v[j - 1], v[j]] = [v[j], v[j - 1]]
      salida.push({ v: [...v], i, j: j - 1 })
    }
  return salida
}

function Ordenar() {
  const pasos = useMemo(pasosOrdenar, [])
  const k = usarReloj(260, pasos.length + 6)
  const { v, j } = pasos[Math.min(k, pasos.length - 1)]
  return (
    <svg className="anim-svg" viewBox="0 0 120 54" width={120} height={54} aria-hidden>
      <line className="guia" x1="4" y1="51" x2="116" y2="51" />
      {ALTURAS.map((alto) => {
        const pos = v.indexOf(alto)
        return (
          <rect
            key={alto}
            className={`trazo movil ${pos === j || pos === j + 1 ? 'activa' : ''}`}
            width={9}
            height={alto * 5}
            rx={1.5}
            style={{ transform: `translate(${10 + pos * 13}px, ${51 - alto * 5}px)` }}
          />
        )
      })}
    </svg>
  )
}

// ---------- Fourier: unos círculos que giran, uno sobre otro, y la punta del último dibuja un corazón ----------

// La serie de Fourier del corazón, calculada una vez: los términos más grandes, de mayor a menor.
const SERIE = (() => {
  const M = 96
  const puntos: [number, number][] = []
  for (let k = 0; k < M; k++) {
    const t = (2 * Math.PI * k) / M
    const x = 16 * Math.sin(t) ** 3
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
    puntos.push([x * 1.15, y * 1.15 - 3])
  }
  const terminos: { f: number; r: number; fase: number }[] = []
  let centro: [number, number] = [0, 0]
  for (let f = -12; f <= 12; f++) {
    let re = 0
    let im = 0
    for (let k = 0; k < M; k++) {
      const a = (-2 * Math.PI * f * k) / M
      re += (puntos[k][0] * Math.cos(a) - puntos[k][1] * Math.sin(a)) / M
      im += (puntos[k][0] * Math.sin(a) + puntos[k][1] * Math.cos(a)) / M
    }
    if (f === 0) centro = [re, im]
    else terminos.push({ f, r: Math.hypot(re, im), fase: Math.atan2(im, re) })
  }
  terminos.sort((x, y) => y.r - x.r)
  return { centro, terminos: terminos.slice(0, 10) }
})()

function cadena(t: number): [number, number][] {
  let x = 27 + SERIE.centro[0]
  let y = 27 + SERIE.centro[1]
  const puntos: [number, number][] = [[x, y]]
  for (const c of SERIE.terminos) {
    x += c.r * Math.cos(c.f * t + c.fase)
    y += c.r * Math.sin(c.f * t + c.fase)
    puntos.push([x, y])
  }
  return puntos
}

function Fourier() {
  const fase = usarFase()
  const t = fase * 0.8
  const brazos = cadena(t)
  const punta = brazos[brazos.length - 1]
  // La estela: lo que ha dibujado la punta en el último 85 % de la vuelta.
  const estela = useMemo(() => {
    const ps: string[] = []
    for (let k = 0; k <= 80; k++) {
      const [x, y] = cadena(t - (k / 80) * Math.PI * 2 * 0.85).at(-1)!
      ps.push(`${x.toFixed(2)},${y.toFixed(2)}`)
    }
    return `M${ps.join('L')}`
  }, [t])
  return (
    <svg className="anim-svg" viewBox="0 0 54 54" width={54} height={54} aria-hidden>
      {brazos.slice(0, -1).map(([x, y], i) => (
        <circle key={i} className="fourier-circulo" cx={x} cy={y} r={SERIE.terminos[i].r} />
      ))}
      <polyline className="fourier-radio" points={brazos.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')} fill="none" />
      <path className="fourier-trazo" d={estela} />
      <circle className="fourier-punta" cx={punta[0]} cy={punta[1]} r={1.3} />
    </svg>
  )
}

// ---------- Lissajous: la curva se dibuja y la fase va girando ----------

function Lissajous() {
  const fase = usarFase()
  const d = useMemo(() => {
    const puntos: string[] = []
    for (let k = 0; k <= 240; k++) {
      const t = (k / 240) * Math.PI * 2
      puntos.push(`${(27 + 22 * Math.sin(3 * t + fase)).toFixed(2)},${(27 + 22 * Math.sin(2 * t)).toFixed(2)}`)
    }
    return `M${puntos.join('L')}`
  }, [fase])
  return (
    <svg className="anim-svg" viewBox="0 0 54 54" width={54} height={54} aria-hidden>
      <path className="lissajous-guia" d={d} />
      <path className="trazo lissajous" d={d} pathLength={1} />
    </svg>
  )
}

// ---------- utilidades ----------

function usarReloj(ms: number, ciclo: number) {
  const [k, setK] = useState(0)
  useEffect(() => {
    if (quieto()) return
    const t = setInterval(() => setK((x) => (x + 1) % ciclo), ms)
    return () => clearInterval(t)
  }, [ms, ciclo])
  return k
}

function usarFase() {
  const [fase, setFase] = useState(0)
  const marco = useRef(0)
  useEffect(() => {
    if (quieto()) return
    let antes = performance.now()
    const paso = (ahora: number) => {
      setFase((f) => f + ((ahora - antes) / 1000) * 0.9)
      antes = ahora
      marco.current = requestAnimationFrame(paso)
    }
    marco.current = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(marco.current)
  }, [])
  return fase
}

const ANIMACIONES: Record<Variante, () => React.JSX.Element> = { rubik: Rubik, hanoi: Hanoi, ordenar: Ordenar, fourier: Fourier, lissajous: Lissajous }

export default function Pensando({ texto, variante, estilo }: { texto?: string; variante?: Variante; estilo?: CSSProperties }) {
  const [elegida] = useState<Variante>(() => variante ?? VARIANTES[Math.floor(Math.random() * VARIANTES.length)])
  const Animacion = ANIMACIONES[elegida]
  return (
    <span className="pensando" role="status" style={estilo}>
      <span className="pensando-anim">
        <Animacion />
      </span>
      {texto && <span className="pensando-texto">{texto}</span>}
    </span>
  )
}
