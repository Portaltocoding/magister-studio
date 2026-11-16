import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

// Animaciones de espera mientras el tutor piensa o genera. Todas en línea, sin relleno,
// pequeñas, y una al azar cada vez para que no aburran.

export type Variante = 'rubik' | 'hanoi' | 'ordenar' | 'vida' | 'lissajous'
const VARIANTES: Variante[] = ['rubik', 'hanoi', 'ordenar', 'vida', 'lissajous']

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

// ---------- Juego de la vida: un planeador que cruza un tablero que se repite ----------

const N = 10
function vida(vivas: Set<string>): Set<string> {
  const cuenta = new Map<string, number>()
  for (const c of vivas) {
    const [x, y] = c.split(',').map(Number)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        if (dx || dy) {
          const k = `${(x + dx + N) % N},${(y + dy + N) % N}`
          cuenta.set(k, (cuenta.get(k) ?? 0) + 1)
        }
  }
  return new Set([...cuenta].filter(([k, n]) => n === 3 || (n === 2 && vivas.has(k))).map(([k]) => k))
}

function Vida() {
  const [vivas, setVivas] = useState(() => new Set(['1,0', '2,1', '0,2', '1,2', '2,2']))
  useEffect(() => {
    if (quieto()) return
    const t = setInterval(() => setVivas((v) => vida(v)), 320)
    return () => clearInterval(t)
  }, [])
  const c = 5.2
  return (
    <svg className="anim-svg" viewBox={`0 0 ${N * c} ${N * c}`} width={54} height={54} aria-hidden>
      <rect className="guia" x={0.5} y={0.5} width={N * c - 1} height={N * c - 1} rx={3} fill="none" />
      {[...vivas].map((k) => {
        const [x, y] = k.split(',').map(Number)
        return <rect key={k} className="trazo" x={x * c + 0.9} y={y * c + 0.9} width={c - 1.8} height={c - 1.8} rx={1} />
      })}
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

const ANIMACIONES: Record<Variante, () => React.JSX.Element> = { rubik: Rubik, hanoi: Hanoi, ordenar: Ordenar, vida: Vida, lissajous: Lissajous }

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
