// Escenas para lo que no es código: una figura geométrica que se dibuja paso a paso (puntos, segmentos, ángulos, el
// norte, proyecciones), fórmulas de verdad con KaTeX y sus símbolos explicados, y una cuenta hecha a mano.
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { interpolate, useCurrentFrame } from 'remotion'
import { C, F, aparecer, colorDe } from './estilo.ts'
import type { Calculo, Figura, Formula } from './tipos.ts'

const ARRIBA = 118

// LaTeX a HTML; si está mal escrito se ve tal cual, en rojo, en vez de romper el vídeo.
function Tex({ tex, grande = false }: { tex: string; grande?: boolean }) {
  let html: string
  try {
    html = katex.renderToString(tex, { displayMode: grande, throwOnError: true, output: 'html' })
  } catch {
    return <span style={{ color: C.mal, fontFamily: F.mono }}>{tex}</span>
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

// Cuándo entra cada paso: repartidos a lo largo de la escena.
const momentos = (pasos: number, dur: number) => (k: number) => Math.round(10 + (k * dur * 0.78) / Math.max(1, pasos))

// ===== Figura: geometría en un plano, con el norte arriba =====
export function EscenaFigura({ e, dur }: { e: Figura; dur: number }) {
  const frame = useCurrentFrame()
  const puntos = Object.fromEntries(e.elementos.filter((x) => x.tipo === 'punto').map((p) => [p.id, p]))
  const xs = Object.values(puntos).map((p) => p.x)
  const ys = Object.values(puntos).map((p) => p.y)
  // Ajuste a la zona de dibujo, misma escala en los dos ejes y el norte hacia arriba.
  const zona = { x: 120, y: ARRIBA + 40, w: e.ancho ?? 1040, h: 370 }
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const escala = Math.min(zona.w / Math.max(1e-9, x1 - x0), zona.h / Math.max(1e-9, y1 - y0))
  const dx = zona.x + (zona.w - (x1 - x0) * escala) / 2
  const dy = zona.y + (zona.h - (y1 - y0) * escala) / 2
  const P = (x: number, y: number): [number, number] => [dx + (x - x0) * escala, dy + (y1 - y) * escala]
  const pasos = Math.max(0, ...e.elementos.map((x) => x.paso ?? 0)) + 1
  const cuando = momentos(pasos, dur)
  const t = (paso = 0, dura = 18) => interpolate(frame, [cuando(paso), cuando(paso) + dura], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  // Dirección en pantalla de un acimut en gon (0 = norte, sentido horario).
  const dir = (g: number): [number, number] => [Math.sin((g * Math.PI) / 200), -Math.cos((g * Math.PI) / 200)]

  return (
    <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="1280" height="720">
      <defs>
        {[C.texto, C.foco, C.bien, C.mal, C.estado, C.gris].map((c) => (
          <marker key={c} id={`flecha${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={c} />
          </marker>
        ))}
      </defs>
      {e.elementos.map((el, i) => {
        const a = t(el.paso)
        if (a <= 0) return null
        const color = el.estado ? colorDe(el.estado) : el.tipo === 'proyeccion' ? C.estado : C.texto
        if (el.tipo === 'segmento') {
          const [ax, ay] = P(puntos[el.de].x, puntos[el.de].y)
          const [bx, by] = P(puntos[el.a].x, puntos[el.a].y)
          const largo = Math.hypot(bx - ax, by - ay)
          const [mx, my] = [(ax + bx) / 2, (ay + by) / 2]
          const [nx, ny] = [-(by - ay) / largo, (bx - ax) / largo]
          const lado = el.etiqueta_lado === 'derecha' ? -1 : 1
          return (
            <g key={i}>
              <line
                x1={ax} y1={ay} x2={ax + (bx - ax) * a} y2={ay + (by - ay) * a} stroke={color} strokeWidth={2.2}
                strokeDasharray={el.discontinuo ? '7 6' : undefined} markerEnd={el.flecha && a > 0.95 ? `url(#flecha${color.slice(1)})` : undefined}
              />
              {el.etiqueta && (
                <text x={mx + nx * 22 * lado} y={my + ny * 22 * lado + 6} textAnchor="middle" fontFamily={F.mono} fontSize={18} fill={color} opacity={a}>
                  {el.etiqueta}
                </text>
              )}
            </g>
          )
        }
        if (el.tipo === 'proyeccion') {
          // Primero ΔY, por la vertical de A (pegada al acimut, que se mide desde el norte); luego ΔX, enfrente.
          const [ax, ay] = P(puntos[el.de].x, puntos[el.de].y)
          const [bx, by] = P(puntos[el.a].x, puntos[el.a].y)
          const v = Math.min(1, a * 2)
          const h = Math.max(0, a * 2 - 1)
          return (
            <g key={i}>
              <line x1={ax} y1={ay} x2={ax} y2={ay + (by - ay) * v} stroke={C.estado} strokeWidth={2} strokeDasharray="6 5" />
              {v >= 1 && <line x1={ax} y1={by} x2={ax + (bx - ax) * h} y2={by} stroke={C.estado} strokeWidth={2} strokeDasharray="6 5" />}
              <text x={ax + (bx > ax ? -14 : 14)} y={(ay + by) / 2 + 6} textAnchor={bx > ax ? 'end' : 'start'} fontFamily={F.mono} fontSize={18} fill={C.estado} opacity={v}>
                {el.etiqueta_y ?? 'ΔY'}
              </text>
              {h > 0 && (
                <text x={(ax + bx) / 2} y={by + (by < ay ? -14 : 28)} textAnchor="middle" fontFamily={F.mono} fontSize={18} fill={C.estado} opacity={h}>
                  {el.etiqueta_x ?? 'ΔX'}
                </text>
              )}
            </g>
          )
        }
        if (el.tipo === 'angulo') {
          const [vx, vy] = P(puntos[el.vertice].x, puntos[el.vertice].y)
          const r = el.radio ?? 70
          const fin = el.desde + (el.hasta - el.desde) * a
          const [sx, sy] = dir(el.desde)
          const [ex, ey] = dir(fin)
          const grande = Math.abs(fin - el.desde) > 200 ? 1 : 0
          const barrido = fin >= el.desde ? 1 : 0
          const [lx, ly] = dir((el.desde + el.hasta) / 2)
          return (
            <g key={i}>
              <path d={`M ${vx + sx * r} ${vy + sy * r} A ${r} ${r} 0 ${grande} ${barrido} ${vx + ex * r} ${vy + ey * r}`} fill="none" stroke={color} strokeWidth={2.2} />
              {el.etiqueta && (
                <text x={vx + lx * (r + 30)} y={vy + ly * (r + 30) + 6} textAnchor="middle" fontFamily={F.serif} fontSize={22} fill={color} opacity={aparecer(frame, cuando(el.paso ?? 0) + 12, 10)}>
                  {el.etiqueta}
                </text>
              )}
            </g>
          )
        }
        if (el.tipo === 'norte') {
          const [vx, vy] = P(puntos[el.en].x, puntos[el.en].y)
          const l = (el.largo ?? 110) * a
          return (
            <g key={i}>
              <line x1={vx} y1={vy} x2={vx} y2={vy - l} stroke={C.gris} strokeWidth={1.6} markerEnd={a > 0.95 ? `url(#flecha${C.gris.slice(1)})` : undefined} />
              <text x={vx} y={vy - l - 12} textAnchor="middle" fontFamily={F.serif} fontSize={20} fill={C.gris} opacity={a}>
                N
              </text>
            </g>
          )
        }
        if (el.tipo === 'texto') {
          const [x, y] = P(el.x, el.y)
          return (
            <text key={i} x={x} y={y} textAnchor="middle" fontFamily={F.serif} fontSize={el.tamano ?? 20} fill={el.estado ? colorDe(el.estado) : C.gris} opacity={a}>
              {el.texto}
            </text>
          )
        }
        // Punto, con su nombre y, si se pide, sus coordenadas.
        const [x, y] = P(el.x, el.y)
        const off = { n: [0, -18], s: [0, 30], e: [16, 6], o: [-16, 6] }[el.lado ?? 'n']
        const anclaje = el.lado === 'e' ? 'start' : el.lado === 'o' ? 'end' : 'middle'
        return (
          <g key={i} opacity={a}>
            <circle cx={x} cy={y} r={6 + 4 * (1 - a)} fill={el.estado ? colorDe(el.estado) : C.foco} />
            {el.etiqueta && (
              <text x={x + off[0]} y={y + off[1]} textAnchor={anclaje} fontFamily={F.serif} fontSize={22} fill={el.estado ? colorDe(el.estado) : C.texto}>
                {el.etiqueta}
              </text>
            )}
            {el.coords && (
              <text x={x + off[0]} y={y + off[1] + (el.lado === 's' ? 22 : -24)} textAnchor={anclaje} fontFamily={F.mono} fontSize={14} fill={C.gris}>
                {el.coords}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ===== Fórmula: las fórmulas de una en una y, debajo, qué es cada símbolo =====
export function EscenaFormula({ e, dur }: { e: Formula; dur: number }) {
  const frame = useCurrentFrame()
  const n = e.formulas.length
  const cuando = momentos(n + (e.simbolos?.length ? 1 : 0), dur)
  // Las fórmulas a la izquierda y, si hay, qué es cada símbolo en una columna a la derecha: así nada baja hasta el subtítulo.
  return (
    <div style={{ position: 'absolute', left: 76, right: 76, top: ARRIBA + 20, height: 420, display: 'flex', alignItems: 'center', gap: 40, color: C.texto }}>
      <style>{'.escena-formula .katex-display { margin: 0.15em 0 }'}</style>
      <div className="escena-formula" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        {e.formulas.map((f, i) => (
          <div key={i} style={{ opacity: aparecer(frame, cuando(i), 14), transform: `translateY(${(1 - aparecer(frame, cuando(i), 14)) * 10}px)`, textAlign: 'center' }}>
            <div style={{ fontSize: n > 2 ? 30 : 36, padding: '2px 22px', borderRadius: 10, border: `1.5px solid ${f.estado ? colorDe(f.estado) : 'transparent'}` }}>
              <Tex tex={f.tex} grande />
            </div>
            {f.nota && <div style={{ fontFamily: F.serif, fontSize: 19, color: C.gris, marginTop: 2 }}>{f.nota}</div>}
          </div>
        ))}
      </div>
      {e.simbolos && (
        <div
          style={{
            width: 400, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '14px 16px', alignItems: 'baseline', padding: '18px 22px',
            borderRadius: 12, background: C.panel, border: `1px solid ${C.borde}`, opacity: aparecer(frame, cuando(n), 14),
          }}
        >
          {e.simbolos.map((s, i) => [
            <span key={`s${i}`} style={{ fontSize: 24, color: C.foco, textAlign: 'right', whiteSpace: 'nowrap' }}>
              <Tex tex={s.simbolo} />
            </span>,
            <span key={`d${i}`} style={{ fontFamily: F.serif, fontSize: 19, color: C.texto, lineHeight: 1.3 }}>
              {s.significa}
            </span>,
          ])}
        </div>
      )}
    </div>
  )
}

// ===== Cálculo: fórmula, sustitución y resultado, línea a línea, como en la libreta =====
export function EscenaCalculo({ e, dur }: { e: Calculo; dur: number }) {
  const frame = useCurrentFrame()
  const n = e.filas.length
  const cuando = momentos(n, dur)
  const alto = Math.min(78, 400 / n)
  return (
    <>
      {e.datos && (
        <div style={{ position: 'absolute', left: 76, right: 76, top: ARRIBA + 6, fontFamily: F.serif, fontSize: 21, color: C.gris, opacity: aparecer(frame, 0) }}>
          {e.datos}
        </div>
      )}
      {e.filas.map((f, i) => {
        const t0 = cuando(i)
        const y = ARRIBA + (e.datos ? 56 : 20) + i * alto
        const color = f.estado ? colorDe(f.estado) : C.foco
        return (
          <div key={i} style={{ position: 'absolute', left: 76, right: 76, top: y, height: alto - 10, display: 'grid', gridTemplateColumns: '1.1fr 1.6fr 1fr', alignItems: 'center', gap: 18, color: C.texto, fontSize: 25 }}>
            <span style={{ opacity: aparecer(frame, t0, 10) }}>
              <Tex tex={f.que} />
            </span>
            <span style={{ opacity: aparecer(frame, t0 + 12, 10), color: C.gris }}>{f.sustitucion && <Tex tex={f.sustitucion} />}</span>
            <span
              style={{
                opacity: aparecer(frame, t0 + 24, 10), color, padding: '4px 12px', borderRadius: 8, justifySelf: 'start',
                border: `1.5px solid ${aparecer(frame, t0 + 24, 10) > 0 ? color : 'transparent'}`,
              }}
            >
              <Tex tex={f.resultado} />
            </span>
          </div>
        )
      })}
      {e.nota && (
        <div style={{ position: 'absolute', left: 76, right: 76, top: ARRIBA + 430, textAlign: 'center', fontFamily: F.serif, fontSize: 21, color: C.gris, opacity: aparecer(frame, cuando(n), 14) }}>
          {e.nota}
        </div>
      )}
    </>
  )
}
