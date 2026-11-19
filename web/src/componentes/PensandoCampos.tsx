import { Trazo, presencia, quieto, tramo, usarCiclo } from './PensandoDibujos.tsx'

// Animaciones de espera de otros campos: arte, geometría, arquitectura, astronomía, música y biología.
// Mismo trazo fino y gris; ciclos cortos que vuelven a empezar.

// ---------- El hombre de Vitruvio: el círculo y el cuadrado, y el cuerpo con sus dos posturas superpuestas ----------
// Las medidas son las del dibujo: la altura es el lado del cuadrado y la envergadura de los brazos en cruz; el
// ombligo es el centro del círculo, que toca al cuadrado por abajo; la cabeza es un octavo de la altura.

export function Vitruvio() {
  const f = usarCiclo(11)
  return (
    <svg className="anim-svg" viewBox="0 0 64 60" width={70} height={66} aria-hidden style={{ opacity: presencia(f) }}>
      <Trazo clase="guia" d="M59 30 A27 27 0 1 0 5 30 A27 27 0 1 0 59 30" f={f} desde={0} hasta={0.16} />
      <Trazo clase="guia" d="M9 11 H55 V57 H9 Z" f={f} desde={0.12} hasta={0.28} />
      {/* La cabeza con su melena, el cuello y el tronco, de hombros a cadera. */}
      <Trazo d="M34.7 14 A2.7 3 0 1 0 29.3 14 A2.7 3 0 1 0 34.7 14 M29.2 13 Q28 16.5 29.6 18.4 M34.8 13 Q36 16.5 34.4 18.4" f={f} desde={0.26} hasta={0.36} />
      <Trazo d="M30.8 17 V18.8 M33.2 17 V18.8 M26 20 Q32 18.2 38 20 L36 28.6 L36.9 33.6 L32 36.2 L27.1 33.6 L28 28.6 Z" f={f} desde={0.33} hasta={0.47} />
      {/* Postura del cuadrado: brazos en cruz hasta sus lados y pies juntos sobre su base. */}
      <Trazo d="M26 20 Q17 19.4 9.4 20.6 M38 20 Q47 19.4 54.6 20.6" f={f} desde={0.45} hasta={0.55} />
      <Trazo d="M28.4 34.4 Q29.6 46 30.2 56 L27.8 57 M35.6 34.4 Q34.4 46 33.8 56 L36.2 57" f={f} desde={0.52} hasta={0.63} />
      {/* Postura del círculo: brazos alzados a la altura de la coronilla y piernas abiertas, hasta tocarlo. */}
      <Trazo d="M26.4 19.8 Q19 15 12.8 11 M37.6 19.8 Q45 15 51.2 11" f={f} desde={0.64} hasta={0.75} />
      <Trazo d="M28 34.6 Q23.5 45 19.8 53.6 L17.6 53.4 M36 34.6 Q40.5 45 44.2 53.6 L46.4 53.4" f={f} desde={0.72} hasta={0.84} />
      {/* El ombligo: el centro de todo. */}
      {tramo(f, 0.83, 0.88) > 0 && <circle cx={32} cy={30} r={0.9} fill="currentColor" opacity={tramo(f, 0.83, 0.88)} />}
    </svg>
  )
}

// ---------- Pitágoras: cuatro triángulos iguales se recolocan y el cuadrado grande se vuelve dos ----------

const PA = 14
const PB = 24
const PS = PA + PB
// Cada triángulo en su sitio inicial (dejan en medio el cuadrado de la hipotenusa) y cuánto se desliza.
const TRIANGULOS: { p: [number, number][]; d: [number, number] }[] = [
  { p: [[0, 0], [PA, 0], [0, PB]], d: [0, PA] },
  { p: [[PS, 0], [PS, PA], [PA, 0]], d: [0, 0] },
  { p: [[PS, PS], [PB, PS], [PS, PA]], d: [-PB, 0] },
  { p: [[0, PS], [0, PB], [PB, PS]], d: [PA, -PB] },
]

export function Pitagoras() {
  const f = usarCiclo(9)
  const k = tramo(f, 0.3, 0.6)
  const antes = 1 - tramo(f, 0.26, 0.36)
  const despues = tramo(f, 0.58, 0.68)
  return (
    <svg className="anim-svg" viewBox="-2 -2 42 42" width={56} height={56} aria-hidden style={{ opacity: presencia(f) }}>
      <rect className="guia" x={0} y={0} width={PS} height={PS} />
      {TRIANGULOS.map((t, i) => (
        <polygon key={i} points={t.p.map(([x, y]) => `${x + t.d[0] * k},${y + t.d[1] * k}`).join(' ')} fill="currentColor" fillOpacity={0.22} stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />
      ))}
      <text x={PS / 2} y={PS / 2 + 2.4} textAnchor="middle" fontSize={6.5} fill="currentColor" opacity={antes}>c²</text>
      <text x={PA / 2} y={PA / 2 + 2.2} textAnchor="middle" fontSize={5.5} fill="currentColor" opacity={despues}>a²</text>
      <text x={PA + PB / 2} y={PA + PB / 2 + 2.4} textAnchor="middle" fontSize={6.5} fill="currentColor" opacity={despues}>b²</text>
    </svg>
  )
}

// ---------- El arco: las dovelas suben por los dos lados y la clave lo cierra ----------

const DOVELAS = 9
const dovela = (i: number): string => {
  const [cx, cy, r1, r2] = [32, 38, 13, 21]
  const a1 = Math.PI - (i * Math.PI) / DOVELAS
  const a2 = Math.PI - ((i + 1) * Math.PI) / DOVELAS
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy - r * Math.sin(a)).toFixed(2)}`
  return `M${p(r2, a1)} A${r2} ${r2} 0 0 1 ${p(r2, a2)} L${p(r1, a2)} A${r1} ${r1} 0 0 0 ${p(r1, a1)} Z`
}

export function Arco() {
  const f = usarCiclo(8)
  const centro = (DOVELAS - 1) / 2
  return (
    <svg className="anim-svg" viewBox="0 0 64 52" width={66} height={54} aria-hidden style={{ opacity: presencia(f) }}>
      <path className="guia" d="M4 50 H60" />
      <Trazo d="M11 50 V38 H19 V50 M45 50 V38 H53 V50" f={f} desde={0} hasta={0.16} />
      {Array.from({ length: DOVELAS }, (_, i) => {
        // De fuera hacia dentro: las de los arranques primero, la clave la última.
        const orden = centro - Math.abs(i - centro)
        const desde = 0.16 + orden * 0.13
        const o = tramo(f, desde, desde + 0.1)
        const clave = i === centro
        return o > 0 ? (
          <path key={i} d={dovela(i)} fill="currentColor" fillOpacity={(clave ? 0.5 : 0.16) * o} stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" opacity={o} transform={`translate(0 ${(1 - o) * -5})`} />
        ) : null
      })}
    </svg>
  )
}

// ---------- Kepler: el planeta va más rápido cerca del sol y barre áreas iguales en tiempos iguales ----------

const KA = 27
const KB = 20
const KC = Math.sqrt(KA * KA - KB * KB)
const KE = KC / KA
const enOrbita = (m: number): [number, number] => {
  // La ecuación de Kepler, M = E − e·sen E, resuelta por Newton.
  let e = m
  for (let k = 0; k < 6; k++) e -= (e - KE * Math.sin(e) - m) / (1 - KE * Math.cos(e))
  return [36 + KA * Math.cos(e), 27 - KB * Math.sin(e)]
}
const SOL: [number, number] = [36 + KC, 27]

export function Kepler() {
  const f = usarCiclo(9)
  const m = (quieto() ? 0.2 : f) * Math.PI * 2
  const [px, py] = enOrbita(m)
  // Tres sectores seguidos, cada uno del mismo tiempo: los tres tienen la misma área.
  const sector = (n: number) => {
    const puntos: string[] = []
    for (let k = 0; k <= 10; k++) puntos.push(enOrbita(m - (n + k / 10) * 0.42).map((v) => v.toFixed(2)).join(' '))
    return `M${SOL[0].toFixed(2)} ${SOL[1]} L${puntos.join(' L')} Z`
  }
  return (
    <svg className="anim-svg" viewBox="0 0 72 54" width={72} height={54} aria-hidden>
      <ellipse className="guia" cx={36} cy={27} rx={KA} ry={KB} />
      {[0, 1, 2].map((n) => (
        <path key={n} d={sector(n)} fill="currentColor" fillOpacity={0.3 - n * 0.09} />
      ))}
      <circle cx={SOL[0]} cy={SOL[1]} r={2.6} fill="currentColor" opacity={0.85} />
      <circle cx={px} cy={py} r={1.7} fill="currentColor" />
    </svg>
  )
}

// ---------- El copo de Koch: cada lado se parte en cuatro, una y otra vez ----------

const KOCH: string[] = (() => {
  let ps: [number, number][] = [[6, 44], [50, 44], [28, 5.9]]
  const niveles: string[] = []
  for (let n = 0; n < 5; n++) {
    niveles.push(`M${ps.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')} Z`)
    const sig: [number, number][] = []
    ps.forEach(([x1, y1], i) => {
      const [x2, y2] = ps[(i + 1) % ps.length]
      const [dx, dy] = [(x2 - x1) / 3, (y2 - y1) / 3]
      // El pico sale hacia fuera: el tercio central girado 60°.
      sig.push([x1, y1], [x1 + dx, y1 + dy], [x1 + dx + dx / 2 - (dy * Math.sqrt(3)) / 2, y1 + dy + dy / 2 + (dx * Math.sqrt(3)) / 2], [x1 + 2 * dx, y1 + 2 * dy])
    })
    ps = sig
  }
  return niveles
})()

export function Koch() {
  const f = usarCiclo(9)
  const pos = Math.max(0, Math.min(4.999, (f / 0.92) * 5))
  const nivel = Math.min(4, Math.floor(pos))
  const entra = tramo(pos - nivel, 0, 0.35)
  return (
    <svg className="anim-svg" viewBox="0 0 56 62" width={52} height={58} aria-hidden style={{ opacity: presencia(f) }}>
      {nivel > 0 && <path className="trazo" d={KOCH[nivel - 1]} strokeLinejoin="round" strokeWidth={1.1} opacity={1 - entra} />}
      <path className="trazo" d={KOCH[nivel]} strokeLinejoin="round" strokeWidth={1.1} opacity={nivel === 0 ? 1 : entra} />
    </svg>
  )
}

// ---------- Música · El círculo de quintas: de do, siete semitonos cada vez, y a las doce notas se cierra la estrella ----------

const NOTAS = ['do', 'sol', 're', 'la', 'mi', 'si', 'fa♯', 'do♯', 'la♭', 'mi♭', 'si♭', 'fa']
const enCirculo = (semitono: number, r: number): [number, number] => {
  const a = (semitono / 12) * Math.PI * 2 - Math.PI / 2
  return [30 + r * Math.cos(a), 30 + r * Math.sin(a)]
}

export function Quintas() {
  const f = usarCiclo(10)
  return (
    <svg className="anim-svg" viewBox="0 0 60 60" width={60} height={60} aria-hidden style={{ opacity: presencia(f) }}>
      <circle className="guia" cx={30} cy={30} r={23} />
      {Array.from({ length: 12 }, (_, s) => {
        const [x, y] = enCirculo(s, 23)
        return <circle key={s} cx={x} cy={y} r={1} fill="currentColor" opacity={0.45} />
      })}
      {NOTAS.map((_, k) => {
        // El salto número k va de la nota k a la siguiente por quintas: 7 semitonos más allá en el círculo cromático.
        const [x1, y1] = enCirculo((k * 7) % 12, 23)
        const [x2, y2] = enCirculo(((k + 1) * 7) % 12, 23)
        return <Trazo key={k} d={`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`} f={f} desde={0.06 + k * 0.068} hasta={0.06 + (k + 1) * 0.068} />
      })}
      {NOTAS.map((_, k) => {
        const visto = tramo(f, 0.06 + k * 0.068 - 0.02, 0.06 + k * 0.068 + 0.02)
        const [x, y] = enCirculo((k * 7) % 12, 23)
        return visto > 0 ? <circle key={`n${k}`} cx={x} cy={y} r={1.9} fill="currentColor" opacity={visto} /> : null
      })}
    </svg>
  )
}

// ---------- Música · Los armónicos de una cuerda: el fundamental y sus tres primeros parciales ----------

export function Cuerda() {
  const f = usarCiclo(8)
  const t = (quieto() ? 0.06 : f) * Math.PI * 2
  const onda = (n: number, y0: number, amp: number) => {
    const ps: string[] = []
    // Onda estacionaria: los nodos no se mueven; el resto sube y baja a la vez. Cada armónico vibra n veces más rápido.
    for (let k = 0; k <= 48; k++) ps.push(`${(6 + k).toFixed(1)} ${(y0 + amp * Math.sin((n * Math.PI * k) / 48) * Math.cos(n * 3 * t)).toFixed(2)}`)
    return `M${ps.join(' L')}`
  }
  return (
    <svg className="anim-svg" viewBox="0 0 60 58" width={62} height={60} aria-hidden>
      {[1, 2, 3, 4].map((n) => {
        const y0 = 8 + (n - 1) * 14
        return (
          <g key={n}>
            <path className="guia" d={`M6 ${y0} H54`} strokeWidth={0.5} />
            <path className="trazo" d={onda(n, y0, 5.2 - n * 0.5)} strokeLinecap="round" strokeWidth={1.3} />
            <circle cx={6} cy={y0} r={1.1} fill="currentColor" />
            <circle cx={54} cy={y0} r={1.1} fill="currentColor" />
          </g>
        )
      })}
    </svg>
  )
}

// ---------- Biología · La doble hélice: dos hebras que giran y los pares de bases que las unen ----------

export function Adn() {
  const f = usarCiclo(7)
  const fase = (quieto() ? 0.1 : f) * Math.PI * 2
  const N = 13
  const pares = Array.from({ length: N }, (_, i) => {
    const y = 4 + (i * 52) / (N - 1)
    const a = fase + i * 0.62
    // Proyección de una hélice vista de lado: el seno da la posición y el coseno, qué hebra queda delante.
    return { y, x1: 30 + 15 * Math.sin(a), x2: 30 - 15 * Math.sin(a), delante: Math.cos(a) }
  })
  const hebra = (cual: 'x1' | 'x2') => `M${pares.map((p) => `${p[cual].toFixed(2)} ${p.y.toFixed(2)}`).join(' L')}`
  return (
    <svg className="anim-svg" viewBox="0 0 60 60" width={46} height={60} aria-hidden>
      {pares.map((p, i) => (
        <line key={i} x1={p.x1} y1={p.y} x2={p.x2} y2={p.y} stroke="currentColor" strokeWidth={0.8} opacity={0.2 + 0.25 * Math.abs(p.delante)} />
      ))}
      <path className="trazo" d={hebra('x1')} strokeLinejoin="round" strokeLinecap="round" strokeWidth={1.5} />
      <path className="trazo" d={hebra('x2')} strokeLinejoin="round" strokeLinecap="round" strokeWidth={1.5} opacity={0.6} />
      {pares.map((p, i) => (
        <g key={`p${i}`}>
          <circle cx={p.x1} cy={p.y} r={p.delante > 0 ? 1.6 : 1} fill="currentColor" opacity={p.delante > 0 ? 1 : 0.5} />
          <circle cx={p.x2} cy={p.y} r={p.delante < 0 ? 1.6 : 1} fill="currentColor" opacity={p.delante < 0 ? 0.9 : 0.4} />
        </g>
      ))}
    </svg>
  )
}

// ---------- Biología · Mitosis: una célula se parte en dos, las dos en cuatro y las cuatro en ocho ----------

// En cada división las hijas se separan por un eje distinto (horizontal, vertical, horizontal) y son más pequeñas.
const DIVISIONES: { eje: [number, number]; d: number }[] = [
  { eje: [1, 0], d: 14 },
  { eje: [0, 1], d: 10.5 },
  { eje: [1, 0], d: 6.4 },
]
const RADIOS = [15, 11, 8, 5.4]

export function Mitosis() {
  const f = usarCiclo(12)
  const pos = Math.max(0, Math.min(2.999, (f / 0.9) * 3))
  const ronda = Math.floor(pos) // qué división está en marcha
  const t = pos - ronda
  const separa = tramo(t, 0.15, 0.75) // las hijas se alejan
  const cierra = tramo(t, 0.55, 0.9) // la membrana se cierra entre las dos
  // Los centros de las células al empezar esta división.
  let centros: [number, number][] = [[42, 32]]
  for (let n = 0; n < ronda; n++) {
    const { eje, d } = DIVISIONES[n]
    centros = centros.flatMap(([x, y]) => [[x - eje[0] * d, y - eje[1] * d], [x + eje[0] * d, y + eje[1] * d]] as [number, number][])
  }
  const { eje, d } = DIVISIONES[ronda]
  const r = RADIOS[ronda] + (RADIOS[ronda + 1] - RADIOS[ronda]) * separa
  return (
    <svg className="anim-svg" viewBox="0 0 84 64" width={84} height={64} aria-hidden style={{ opacity: presencia(f) }}>
      {centros.map(([x, y], i) => {
        const [ax, ay] = [x - eje[0] * d * separa, y - eje[1] * d * separa]
        const [bx, by] = [x + eje[0] * d * separa, y + eje[1] * d * separa]
        return (
          <g key={i}>
            {/* Antes de cerrarse, las dos hijas comparten membrana: se ve como una célula que se estrecha. */}
            <circle className="trazo" cx={ax} cy={ay} r={r} strokeWidth={1.1} />
            <circle className="trazo" cx={bx} cy={by} r={r} strokeWidth={1.1} />
            {cierra < 1 && separa > 0 && (
              <line x1={x - eje[1] * r * 0.9} y1={y - eje[0] * r * 0.9} x2={x + eje[1] * r * 0.9} y2={y + eje[0] * r * 0.9} stroke="var(--fondo, #fff)" strokeWidth={Math.max(0, 2 * (r - d * separa)) * (1 - cierra)} strokeLinecap="round" />
            )}
            <circle cx={ax} cy={ay} r={r * 0.27} fill="currentColor" opacity={0.75} />
            <circle cx={bx} cy={by} r={r * 0.27} fill="currentColor" opacity={0.75} />
          </g>
        )
      })}
    </svg>
  )
}

// ---------- Biología · Un árbol que crece: cada rama se parte en dos más cortas, cinco veces ----------

interface Rama { x1: number; y1: number; x2: number; y2: number; nivel: number }
const RAMAS: Rama[] = (() => {
  const salida: Rama[] = []
  const crecer = (x: number, y: number, ang: number, largo: number, nivel: number) => {
    const [x2, y2] = [x + largo * Math.sin(ang), y - largo * Math.cos(ang)]
    salida.push({ x1: x, y1: y, x2, y2, nivel })
    if (nivel >= 5) return
    crecer(x2, y2, ang - 0.42, largo * 0.72, nivel + 1)
    crecer(x2, y2, ang + 0.36, largo * 0.68, nivel + 1)
  }
  crecer(30, 58, 0.04, 17, 0)
  return salida
})()

export function Arbol() {
  const f = usarCiclo(9)
  return (
    <svg className="anim-svg" viewBox="0 0 60 60" width={58} height={58} aria-hidden style={{ opacity: presencia(f) }}>
      <path className="guia" d="M12 58 H48" />
      {RAMAS.map((r, i) => (
        <Trazo key={i} d={`M${r.x1.toFixed(2)} ${r.y1.toFixed(2)} L${r.x2.toFixed(2)} ${r.y2.toFixed(2)}`} f={f} desde={r.nivel * 0.14} hasta={r.nivel * 0.14 + 0.16} />
      ))}
    </svg>
  )
}
