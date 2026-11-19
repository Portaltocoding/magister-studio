// Las piezas del vídeo, siempre las mismas: así una hora de explicación se ve como una sola cosa.
import type { CSSProperties, ReactNode } from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import { C, F, aparecer, rampa } from './estilo.ts'

// «Concepto · tesis», arriba a la izquierda. El concepto en blanco, la tesis en gris. Si es muy largo, se corta con «…»
// antes del borde. `entraConcepto` = el concepto aparece (no si sigue el del tramo anterior); las opacidades, las del
// fundido cruzado entre tramos.
export function Titulo({
  concepto, tesis, entraConcepto = true, opacidad = 1, opacidadConcepto = opacidad,
}: { concepto: string; tesis: string; entraConcepto?: boolean; opacidad?: number; opacidadConcepto?: number }) {
  const frame = useCurrentFrame()
  const a = entraConcepto ? aparecer(frame, 0, 10) : 1
  const b = aparecer(frame, 6, 12)
  return (
    <div
      style={{
        position: 'absolute', left: 76, top: 38, maxWidth: 1128, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: F.serif, fontSize: 36,
        letterSpacing: -0.3, whiteSpace: 'nowrap', color: `color-mix(in srgb, ${C.gris} ${Math.round(b * opacidad * 100)}%, transparent)`,
      }}
    >
      <span style={{ color: C.texto, opacity: a * opacidadConcepto }}>{concepto}</span>
      <span style={{ color: C.gris, opacity: b * opacidad }}> · {tesis}</span>
    </div>
  )
}

// Una ventana con forma de herramienta real: tres puntos y una pestaña con su nombre.
export function Ventana({
  titulo,
  x,
  y,
  w,
  h,
  opacidad = 1,
  borde,
  children,
  barra = 'pestana',
}: {
  titulo: string
  x: number
  y: number
  w: number
  h: number
  opacidad?: number
  borde?: string
  children: ReactNode
  barra?: 'pestana' | 'direccion' | 'etiqueta'
}) {
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h, opacity: opacidad, background: C.panel, borderRadius: 10,
        border: `1.5px solid ${borde ?? C.borde}`, overflow: 'hidden', boxShadow: borde ? `0 0 0 1px ${borde}33` : undefined,
      }}
    >
      <div style={{ height: 34, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', background: C.panelAlto, borderBottom: `1px solid ${C.borde}` }}>
        {barra !== 'etiqueta' && (
          <span style={{ display: 'flex', gap: 5 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 8, height: 8, borderRadius: 4, background: C.grisOscuro }} />
            ))}
          </span>
        )}
        <span
          style={{
            fontFamily: barra === 'etiqueta' ? F.serif : F.mono, fontSize: barra === 'etiqueta' ? 17 : 14, color: barra === 'etiqueta' ? C.gris : C.texto,
            padding: barra === 'direccion' ? '3px 12px' : '6px 4px', borderRadius: 6,
            background: barra === 'direccion' ? C.panel : undefined, flex: barra === 'direccion' ? 1 : undefined,
            borderBottom: barra === 'pestana' ? `2px solid ${C.foco}` : undefined,
          }}
        >
          {titulo}
        </span>
      </div>
      <div style={{ position: 'relative', padding: '12px 16px' }}>{children}</div>
    </div>
  )
}

// Resaltado sobrio: palabras clave en morado, funciones y cabeceras en amarillo, números en azul, cadenas en verde.
const CLAVES =
  'POST|GET|PUT|PATCH|DELETE|const|let|function|return|if|else|await|async|import|from|export|SELECT|FROM|WHERE|AND|OR|NOT|CREATE|INDEX|ON|INSERT|INTO|VALUES|EXPLAIN|ANALYZE|LIKE|ORDER|BY|LIMIT|UPDATE|SET|JOIN|GROUP'
const TOKENS = new RegExp(String.raw`("[^"]*"|'[^']*'|\b(?:${CLAVES})\b|\b\d+(?:[.,]\d+)?\b|[A-Za-z_][\w-]*(?=\s*[(:]))`, 'g')
const ES_CLAVE = new RegExp(`^(?:${CLAVES})$`)

function pintar(linea: string): ReactNode[] {
  const trozos: ReactNode[] = []
  let ultimo = 0
  for (const m of linea.matchAll(TOKENS)) {
    const t = m[0]
    if (m.index! > ultimo) trozos.push(linea.slice(ultimo, m.index))
    const color = t.startsWith('"') || t.startsWith("'") ? C.cadena : /^\d/.test(t) ? C.numero : ES_CLAVE.test(t) ? C.palabraClave : C.funcion
    trozos.push(
      <span key={m.index} style={{ color }}>
        {t}
      </span>,
    )
    ultimo = m.index! + t.length
  }
  if (ultimo < linea.length) trozos.push(linea.slice(ultimo))
  return trozos
}

// El código se escribe letra a letra entre `desde` y `hasta` (en fotogramas); las líneas resaltadas llevan marco ámbar
// y el resto se atenúa cuando hay resaltado. `resaltar` cuenta desde 1, como los números que se ven (y como el servidor).
export function Codigo({ lineas, resaltar = [], desde = 0, hasta = 0, tamano = 16 }: { lineas: string[]; resaltar?: number[]; desde?: number; hasta?: number; tamano?: number }) {
  const frame = useCurrentFrame()
  const total = lineas.reduce((n, l) => n + l.length + 1, 0)
  const visibles = hasta > desde ? Math.floor(rampa(frame, [desde, hasta], [0, total])) : total
  const foco = aparecer(frame, hasta + 6, 10)
  // Dónde empieza cada línea dentro del texto entero (para saber cuánto se ha escrito de ella).
  const empieza = lineas.map((_, i) => lineas.slice(0, i).reduce((n, l) => n + l.length + 1, 0))
  return (
    <div style={{ fontFamily: F.mono, fontSize: tamano, lineHeight: 1.65, color: C.texto }}>
      {lineas.map((l, i) => {
        const quedan = Math.max(0, Math.min(l.length, visibles - empieza[i]))
        const marcada = resaltar.includes(i + 1)
        const op = resaltar.length ? interpolate(foco, [0, 1], [1, marcada ? 1 : 0.32]) : 1
        return (
          <div key={i} style={{ display: 'flex', gap: 14, opacity: op, position: 'relative' }}>
            <span style={{ color: C.grisOscuro, width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
            <span
              style={{
                whiteSpace: 'pre', padding: '0 6px', margin: '0 -6px', borderRadius: 5,
                outline: marcada ? `1.5px solid rgba(242, 179, 61, ${foco})` : undefined, background: marcada ? `rgba(242, 179, 61, ${0.1 * foco})` : undefined,
              }}
            >
              {pintar(l.slice(0, quedan))}
              {quedan < l.length && quedan > 0 ? <span style={{ background: C.texto, width: 2, display: 'inline-block', height: '1em', verticalAlign: 'middle' }} /> : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ✓ verde o ✗ rojo en un círculo; «depende», una tilde ámbar.
export function Marca({ bien, depende = false, tamano = 22, estilo }: { bien: boolean; depende?: boolean; tamano?: number; estilo?: CSSProperties }) {
  const color = depende ? C.foco : bien ? C.bien : C.mal
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 24 24" style={estilo} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="1.6" />
      {depende ? (
        <path d="M7 13c1.5-2.5 3-2.5 5 0s3.5 2.5 5 0" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      ) : bien ? (
        <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  )
}

// Un cable curvo de (x1, y1) a (x2, y2) que se dibuja y por el que viaja un punto con el dato.
// Si va mal, se corta a mitad de camino con un ✗.
export function Cable({
  x1, y1, x2, y2, desde, dura = 24, color = C.estado, etiqueta, roto = false,
}: { x1: number; y1: number; x2: number; y2: number; desde: number; dura?: number; color?: string; etiqueta?: string; roto?: boolean }) {
  const frame = useCurrentFrame()
  const t = rampa(frame, [desde, desde + dura], [0, 1])
  if (t <= 0) return null
  // Con signo: el cable sale hacia donde va (también de derecha a izquierda).
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.45) * (x2 >= x1 ? 1 : -1)
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
  const largo = Math.hypot(x2 - x1, y2 - y1) * 1.25
  const limite = roto ? 0.5 : 1
  const avance = Math.min(t, limite)
  // Punto sobre la curva de Bézier.
  const p = (u: number) => {
    const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u ** 2, e = u ** 3
    return [a * x1 + b * (x1 + dx) + c * (x2 - dx) + e * x2, a * y1 + b * y1 + c * y2 + e * y2]
  }
  const [px, py] = p(avance)
  const [mx, my] = p(0.5)
  const trazo = (
    <svg style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }} width="1280" height="720">
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray={`${largo * avance} ${largo}`} strokeLinecap="round" opacity={0.9} />
      {t < limite + 0.001 && <circle cx={px} cy={py} r={5} fill={color} />}
      {roto && t >= limite && (
        <g transform={`translate(${mx - 13}, ${my - 13})`}>
          <circle cx="13" cy="13" r="12" fill={C.fondo} stroke={C.mal} strokeWidth="1.8" />
          <path d="M8.5 8.5l9 9M17.5 8.5l-9 9" stroke={C.mal} strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
    </svg>
  )
  const ancho = Math.max(90, Math.min(170, Math.abs(x2 - x1) - 8))
  return (
    <>
      {trazo}
      {etiqueta && (
        <div
          style={{
            position: 'absolute', left: mx - ancho / 2, top: my - 52, width: ancho, textAlign: 'center', fontFamily: F.mono, fontSize: 14,
            lineHeight: 1.3, color, opacity: Math.min(1, t * 3), pointerEvents: 'none',
          }}
        >
          {etiqueta}
        </div>
      )}
    </>
  )
}

// La frase que se está diciendo, abajo.
export function Subtitulo({ texto }: { texto: string }) {
  if (!texto) return null
  return (
    <div
      style={{
        position: 'absolute', left: '50%', bottom: 64, transform: 'translateX(-50%)', maxWidth: 1000, textAlign: 'center',
        fontFamily: F.sans, fontSize: 21, lineHeight: 1.4, color: C.texto, background: 'rgba(10,10,10,0.82)', padding: '8px 16px', borderRadius: 8,
      }}
    >
      {texto}
    </div>
  )
}
