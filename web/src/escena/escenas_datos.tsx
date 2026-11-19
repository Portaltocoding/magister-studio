// Escenas para enseñar cómo están y cómo se mueven los datos: una tabla que se recorre, un índice que apunta a sus
// filas, una búsqueda que parte la lista por la mitad, un árbol B, barras, una consulta con su plan y una lista
// que se enciende. Como las demás, todo sale del fotograma.
import type { ReactNode } from 'react'
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { ARRIBA, C, F, FIJO, aparecer, colorDe, muelle, rampa } from './estilo.ts'
import { Cable, Codigo } from './piezas.tsx'
import type { Arbol, Barras, Consulta, Indice, Mitades, Pasos, Tabla } from './tipos.ts'

const BARRA = 34
const FILA = 38
const num = (n: number) => Math.round(n).toLocaleString('es-ES')

// Un marco con geometría fija: barra de 34 px y el contenido colocado a mano debajo.
function Marco({ x, y, w, h, titulo, opacidad = 1, children }: { x: number; y: number; w: number; h: number; titulo: string; opacidad?: number; children?: ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, opacity: opacidad, background: C.panel, borderRadius: 10, border: `1.5px solid ${C.borde}`, overflow: 'hidden' }}>
      <div style={{ height: BARRA, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', background: C.panelAlto, borderBottom: `1px solid ${C.borde}` }}>
        <span style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 8, height: 8, borderRadius: 4, background: C.grisOscuro }} />
          ))}
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 14, color: C.texto, borderBottom: `2px solid ${C.foco}`, padding: '6px 4px' }}>{titulo}</span>
      </div>
      {children}
    </div>
  )
}

// Una fila de celdas con columnas: la primera (id) estrecha.
function Celdas({ celdas, plantilla, color = C.texto, tamano = 17 }: { celdas: ReactNode[]; plantilla: string; color?: string; tamano?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: plantilla, gap: 10, fontFamily: F.mono, fontSize: tamano, color, alignItems: 'center', height: '100%' }}>
      {celdas.map((c, i) => (
        <span key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {c}
        </span>
      ))}
    </div>
  )
}

// ===== Tabla: las filas, y si hay escaneo, un lector que las recorre todas mientras el contador sube =====
export function EscenaTabla({ e, dur }: { e: Tabla; dur: number }) {
  const frame = useCurrentFrame()
  const escaneo = e.escaneo
  const ancho = escaneo ? 740 : 980
  const x = escaneo ? 64 : 150
  const n = e.filas.length
  const alto = BARRA + 14 + 30 + n * FILA + (e.resto ? 44 : 10)
  // La primera columna (ids, nombres, URL) tan ancha como su texto más largo, entre 90 y 420 px.
  const larga = Math.max(...[e.columnas[0], ...e.filas.map((f) => f[0])].map((c) => (c ?? '').length))
  const plantilla = `${Math.min(420, Math.max(90, larga * 10 + 16))}px repeat(${e.columnas.length - 1}, 1fr)`
  const s0 = Math.round(dur * 0.24)
  const s1 = Math.round(dur * 0.78)
  // El lector baja una fila cada 3 fotogramas y vuelve arriba: sugiere el millón sin enseñarlo.
  const lector = escaneo && frame >= s0 && frame < s1 ? Math.floor((frame - s0) / 3) % n : -1
  const vistas = escaneo ? Math.floor(Math.max(0, frame - s0) / 3) : 0
  const leidas = escaneo
    ? interpolate(frame, [s0, s1], [0, escaneo.leidas], { ...FIJO, easing: Easing.in(Easing.quad) })
    : 0
  const fin = escaneo ? aparecer(frame, s1, 14) : 0
  return (
    <>
      <Marco x={x} y={ARRIBA + 6} w={ancho} h={alto} titulo={e.nombre} opacidad={aparecer(frame, 0)}>
        <div style={{ position: 'absolute', left: 16, right: 16, top: BARRA + 10, height: 30 }}>
          <Celdas celdas={e.columnas} plantilla={plantilla} color={C.gris} tamano={15} />
        </div>
        {e.filas.map((f, i) => {
          const encontrada = escaneo?.coincide.includes(i) && vistas > i
          const aqui = i === lector
          return (
            <div
              key={i}
              style={{
                position: 'absolute', left: 8, right: 8, top: BARRA + 44 + i * FILA, height: FILA - 4, padding: '0 8px', borderRadius: 6,
                opacity: escaneo ? 1 : aparecer(frame, 8 + i * 4, 10),
                background: encontrada ? 'rgba(98,196,124,0.12)' : aqui ? 'rgba(242,179,61,0.10)' : undefined,
                outline: encontrada ? `1.5px solid ${C.bien}` : aqui ? `1.5px solid ${C.foco}` : undefined,
              }}
            >
              <Celdas celdas={f} plantilla={plantilla} color={encontrada ? C.bien : C.texto} />
            </div>
          )
        })}
        {e.resto && (
          <div style={{ position: 'absolute', left: 24, top: BARRA + 50 + n * FILA, fontFamily: F.serif, fontSize: 19, color: C.foco, opacity: aparecer(frame, 12 + n * 4) }}>
            ⋮ {e.resto}
          </div>
        )}
      </Marco>
      {escaneo && (
        <div style={{ position: 'absolute', left: 860, top: ARRIBA + 30, width: 360, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: F.serif, fontSize: 22, color: C.gris }}>filas leídas</span>
          <span style={{ fontFamily: F.mono, fontSize: 58, color: C.foco, lineHeight: 1.1 }}>{num(leidas)}</span>
          <span style={{ fontFamily: F.serif, fontSize: 22, color: C.gris, marginTop: 26 }}>encontradas</span>
          <span style={{ fontFamily: F.mono, fontSize: 58, color: C.bien, lineHeight: 1.1 }}>
            {num(Math.min(escaneo.encontradas, Math.floor((leidas / escaneo.leidas) * escaneo.encontradas + 0.3)))}
          </span>
          <span style={{ fontFamily: F.serif, fontSize: 22, color: C.mal, marginTop: 26, opacity: fin }}>
            descartadas: {num(escaneo.leidas - escaneo.encontradas)}
          </span>
        </div>
      )}
    </>
  )
}

// ===== Índice: la copia ordenada a la izquierda, la tabla tal cual a la derecha, cables de una a otra =====
export function EscenaIndice({ e, dur }: { e: Indice; dur: number }) {
  const frame = useCurrentFrame()
  const IX = { x: 64, w: 440 }
  const TX = { x: 640, w: 576 }
  const top = ARRIBA + 6
  const filaY = (i: number) => top + BARRA + 44 + i * FILA + (FILA - 4) / 2
  const altoIndice = BARRA + 54 + e.entradas.length * FILA
  const altoTabla = BARRA + 54 + e.tabla.filas.length * FILA
  const plantillaI = `repeat(${e.columnas.length}, 1fr) 90px`
  const plantillaT = `90px repeat(${e.tabla.columnas.length - 1}, 1fr)`
  const busca = Math.round(dur * 0.3)
  const sale_ = (en: Indice['entradas'][number], i: number) =>
    en.fila !== null && (e.marcar ? e.marcar.includes(i) : !!e.buscar && en.clave[0] === e.buscar)
  const elegidas = e.entradas.map((en, i) => ({ en, i })).filter(({ en, i }) => sale_(en, i))
  const paso = Math.max(8, Math.round((dur * 0.4) / Math.max(1, elegidas.length)))
  const foco = e.buscar || e.marcar ? aparecer(frame, busca, 12) : 0
  return (
    <>
      <Marco x={IX.x} y={top} w={IX.w} h={altoIndice} titulo={e.nombre} opacidad={aparecer(frame, 0)}>
        <div style={{ position: 'absolute', left: 16, right: 16, top: BARRA + 10, height: 30 }}>
          <Celdas celdas={[...e.columnas, '→ fila']} plantilla={plantillaI} color={C.gris} tamano={15} />
        </div>
        {e.entradas.map((en, i) => {
          const sale = sale_(en, i)
          return (
            <div
              key={i}
              style={{
                position: 'absolute', left: 8, right: 8, top: BARRA + 44 + i * FILA, height: FILA - 4, padding: '0 8px', borderRadius: 6,
                opacity: aparecer(frame, 6 + i * 3, 10) * (sale ? 1 : interpolate(foco, [0, 1], [1, 0.35])),
                outline: sale ? `1.5px solid rgba(242,179,61,${foco})` : undefined,
              }}
            >
              {en.fila === null ? (
                <div style={{ fontFamily: F.mono, color: C.gris, textAlign: 'center', lineHeight: `${FILA - 4}px` }}>⋮</div>
              ) : (
                <Celdas celdas={[...en.clave, <span key="fila" style={{ color: C.numero }}>{en.fila}</span>]} plantilla={plantillaI} color={sale ? C.foco : C.texto} />
              )}
            </div>
          )
        })}
      </Marco>
      <Marco x={TX.x} y={top} w={TX.w} h={altoTabla} titulo={e.tabla.nombre} opacidad={aparecer(frame, 8)}>
        <div style={{ position: 'absolute', left: 16, right: 16, top: BARRA + 10, height: 30 }}>
          <Celdas celdas={e.tabla.columnas} plantilla={plantillaT} color={C.gris} tamano={15} />
        </div>
        {e.tabla.filas.map((f, i) => {
          const k = elegidas.findIndex(({ en }) => en.fila === f.id)
          const llega = k >= 0 ? aparecer(frame, busca + 10 + k * paso + 22, 8) : 0
          return (
            <div
              key={i}
              style={{
                position: 'absolute', left: 8, right: 8, top: BARRA + 44 + i * FILA, height: FILA - 4, padding: '0 8px', borderRadius: 6,
                opacity: aparecer(frame, 12 + i * 3, 10), background: llega ? `rgba(98,196,124,${0.12 * llega})` : undefined,
                outline: llega ? `1.5px solid rgba(98,196,124,${llega})` : undefined,
              }}
            >
              {f.id === null ? (
                <div style={{ fontFamily: F.mono, color: C.gris, textAlign: 'center', lineHeight: `${FILA - 4}px` }}>⋮</div>
              ) : (
                <Celdas celdas={[String(f.id), ...f.celdas]} plantilla={plantillaT} color={llega ? C.bien : C.texto} />
              )}
            </div>
          )
        })}
      </Marco>
      {elegidas.map(({ en, i }, k) => {
        const destino = e.tabla.filas.findIndex((f) => f.id === en.fila)
        if (destino < 0) return null
        return <Cable key={k} x1={IX.x + IX.w} y1={filaY(i)} x2={TX.x} y2={filaY(destino)} desde={busca + 10 + k * paso} dura={22} color={C.foco} />
      })}
    </>
  )
}

// ===== Mitades: una lista ordenada de un millón, partida por la mitad hasta quedarse en una entrada =====
export function EscenaMitades({ e, dur }: { e: Mitades; dur: number }) {
  const frame = useCurrentFrame()
  const pasos = Math.ceil(Math.log2(e.total))
  const objetivo = 0.035
  // Los intervalos de cada paso: [lo, hi] en fracción de la lista.
  const intervalos: [number, number][] = [[0, 1]]
  for (let k = 0; k < pasos; k++) {
    const [lo, hi] = intervalos[k]
    const m = (lo + hi) / 2
    intervalos.push(objetivo < m ? [lo, m] : [m, hi])
  }
  // Los seis primeros pasos despacio, el resto de corrido.
  // Con una lista corta (seis pasos o menos) todos van despacio y no hay pasos rápidos que repartir.
  const lentos = Math.max(1, Math.min(6, pasos))
  const lento = Math.round(Math.min(26, (dur * 0.4) / lentos))
  const rapido = pasos > lentos ? Math.max(3, Math.round((dur * 0.2) / (pasos - lentos))) : lento
  const inicio = Math.round(dur * 0.22)
  const comienzo = (k: number) => inicio + Math.min(k, lentos) * lento + Math.max(0, k - lentos) * rapido
  let k = 0
  while (k < pasos && frame >= comienzo(k + 1)) k++
  const largo = k < lentos ? lento : rapido
  const t = interpolate(frame, [comienzo(k), comienzo(k) + largo * 0.8], [0, 1], { ...FIJO, easing: Easing.inOut(Easing.cubic) })
  const [a0, b0] = intervalos[k]
  const [a1, b1] = intervalos[Math.min(pasos, k + (frame >= inicio ? 1 : 0))]
  const lo = a0 + (a1 - a0) * t
  const hi = b0 + (b1 - b0) * t
  const hecho = frame >= comienzo(pasos)
  const dado = hecho ? pasos : frame >= inicio ? k + (t > 0.5 ? 1 : 0) : 0
  const quedan = Math.max(1, Math.ceil(e.total / 2 ** dado))
  const X0 = 96
  const W = 1088
  const Y = ARRIBA + 150
  const mitad = (a0 + b0) / 2
  return (
    <>
      <div style={{ position: 'absolute', left: X0, top: Y - 60, fontFamily: F.serif, fontSize: 22, color: C.gris, opacity: aparecer(frame, 0) }}>
        {num(e.total)} entradas, ordenadas · buscas «<span style={{ color: C.foco }}>{e.objetivo}</span>»
      </div>
      <div style={{ position: 'absolute', left: X0, top: Y, width: W, height: 54, borderRadius: 8, background: C.panel, border: `1.5px solid ${C.borde}`, opacity: aparecer(frame, 0) }} />
      <div
        style={{
          position: 'absolute', left: X0 + lo * W, top: Y, width: Math.max(3, (hi - lo) * W), height: 54, borderRadius: 6,
          background: 'rgba(242,179,61,0.22)', border: `1.5px solid ${C.foco}`, boxSizing: 'border-box', opacity: aparecer(frame, 10),
        }}
      />
      {!hecho && frame >= inicio && (
        <div style={{ position: 'absolute', left: X0 + mitad * W - 1, top: Y - 12, width: 2, height: 78, background: C.estado, opacity: 1 - t * 0.6 }} />
      )}
      <div style={{ position: 'absolute', left: X0, top: Y + 66, fontFamily: F.mono, fontSize: 17, color: C.gris }}>{e.desde}</div>
      <div style={{ position: 'absolute', left: X0 + W - 60, top: Y + 66, width: 60, textAlign: 'right', fontFamily: F.mono, fontSize: 17, color: C.gris }}>{e.hasta}</div>
      <div style={{ position: 'absolute', left: X0, top: Y + 130, display: 'flex', gap: 60, alignItems: 'baseline', opacity: aparecer(frame, inicio) }}>
        <span style={{ fontFamily: F.serif, fontSize: 24, color: C.gris }}>
          paso <span style={{ fontFamily: F.mono, fontSize: 54, color: C.foco }}>{dado}</span>
        </span>
        <span style={{ fontFamily: F.serif, fontSize: 24, color: C.gris }}>
          quedan <span style={{ fontFamily: F.mono, fontSize: 54, color: quedan === 1 ? C.bien : C.texto }}>{num(quedan)}</span>
        </span>
      </div>
      <div
        style={{
          position: 'absolute', left: X0, top: Y + 240, fontFamily: F.serif, fontSize: 24, color: C.texto, opacity: aparecer(frame, comienzo(pasos) + 6, 14),
        }}
      >
        Leyendo en orden: hasta <span style={{ color: C.mal }}>{num(e.total)}</span> pasos. Partiendo por la mitad: <span style={{ color: C.bien }}>{pasos}</span>.
      </div>
    </>
  )
}

// ===== Árbol B: de la raíz a la hoja, un salto por nivel =====
export function EscenaArbol({ e, dur }: { e: Arbol; dur: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const niveles = e.niveles.length
  const Y = (i: number) => ARRIBA + 24 + i * Math.min(130, 290 / Math.max(1, niveles - 1))
  const ALTO_NODO = 44
  const anchoNodo = (claves: string[]) => claves.reduce((n, c) => n + Math.max(44, c.length * 11 + 18), 0) + 8
  // Los nodos de cada nivel, repartidos a lo ancho.
  const cajas = e.niveles.map((nodos, i) => {
    const anchos = nodos.map(anchoNodo)
    const hueco = 26
    const total = anchos.reduce((a, b) => a + b, 0) + hueco * (nodos.length - 1)
    let x = 76 + 120 + (1008 - total) / 2
    return anchos.map((w) => {
      const caja = { x, y: Y(i), w }
      x += w + hueco
      return caja
    })
  })
  // Al menos 12 fotogramas por salto: cada rama se dibuja en [llegaA(i) + 8, llegaA(i + 1)], que tiene que crecer.
  const salto = Math.max(12, Math.round(Math.min(60, (dur * 0.3) / niveles)))
  const empieza = Math.round(dur * 0.5)
  const llegaA = (i: number) => empieza + i * salto
  const nombres = (i: number) => (i === 0 ? 'raíz' : i === niveles - 1 ? 'hojas' : 'intermedio')
  const final = aparecer(frame, llegaA(niveles - 1) + 16, 14)
  return (
    <>
      {e.niveles.map((_, i) => (
        <div key={`n${i}`} style={{ position: 'absolute', left: 76, top: Y(i) + 10, fontFamily: F.serif, fontSize: 19, color: C.gris, opacity: aparecer(frame, i * 6) }}>
          {nombres(i)}
        </div>
      ))}
      <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="1280" height="720">
        {e.niveles.slice(0, -1).map((_, i) => {
          const padre = cajas[i][i === 0 ? 0 : e.camino[i]]
          return cajas[i + 1].map((hijo, j) => {
            const enCamino = j === e.camino[i + 1]
            const t = enCamino ? rampa(frame, [llegaA(i) + 8, llegaA(i + 1)], [0, 1]) : 0
            const x1 = padre.x + padre.w / 2
            const y1 = padre.y + ALTO_NODO
            const x2 = hijo.x + hijo.w / 2
            const y2 = hijo.y
            return (
              <g key={`${i}-${j}`} opacity={aparecer(frame, 4 + (i + 1) * 6)}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.borde} strokeWidth={1.5} />
                {t > 0 && <line x1={x1} y1={y1} x2={x1 + (x2 - x1) * t} y2={y1 + (y2 - y1) * t} stroke={C.foco} strokeWidth={2.5} />}
                {t > 0 && t < 1 && <circle cx={x1 + (x2 - x1) * t} cy={y1 + (y2 - y1) * t} r={5} fill={C.foco} />}
              </g>
            )
          })
        })}
      </svg>
      {e.niveles.map((nodos, i) =>
        nodos.map((claves, j) => {
          const caja = cajas[i][j]
          const enCamino = j === (i === 0 ? 0 : e.camino[i])
          const encendido = enCamino && frame >= llegaA(i)
          const atenua = frame >= llegaA(i) && !enCamino
          const s = encendido ? muelle(frame, llegaA(i), fps) : 0
          const hoja = i === niveles - 1 && encendido
          return (
            <div
              key={`${i}-${j}`}
              style={{
                position: 'absolute', left: caja.x, top: caja.y, width: caja.w, height: ALTO_NODO, display: 'flex', borderRadius: 8, overflow: 'hidden',
                background: C.panel, border: `1.5px solid ${encendido ? C.foco : C.borde}`, transform: `scale(${1 + 0.04 * s})`,
                opacity: aparecer(frame, 4 + i * 6) * (atenua ? 0.4 : 1),
              }}
            >
              {claves.map((c, k) => (
                <span
                  key={k}
                  style={{
                    flex: 1, display: 'grid', placeItems: 'center', fontFamily: F.mono, fontSize: 16, padding: '0 8px',
                    color: hoja ? C.bien : encendido ? C.foco : C.texto, borderLeft: k ? `1px solid ${C.borde}` : undefined,
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          )
        }),
      )}
      {(() => {
        const ultima = cajas[niveles - 1][e.camino[niveles - 1]]
        return (
          <div style={{ position: 'absolute', left: ultima.x + ultima.w / 2 - 260, top: ultima.y + ALTO_NODO + 14, width: 520, textAlign: 'center', whiteSpace: 'nowrap', fontFamily: F.mono, fontSize: 18, color: C.bien, opacity: final }}>
            {e.hoja}
          </div>
        )
      })()}
      <div style={{ position: 'absolute', right: 70, top: ARRIBA + 30, textAlign: 'right', fontFamily: F.serif, fontSize: 22, color: C.gris, opacity: aparecer(frame, empieza - 6) }}>
        salto <span style={{ fontFamily: F.mono, fontSize: 48, color: C.foco }}>{Math.min(niveles, Math.max(0, Math.floor((frame - empieza) / salto) + 1))}</span> de {niveles}
      </div>
      {e.nota && (
        <div style={{ position: 'absolute', left: 76, right: 76, top: ARRIBA + 400, textAlign: 'center', fontFamily: F.serif, fontSize: 21, color: C.gris, opacity: final }}>
          {e.nota}
        </div>
      )}
    </>
  )
}

// ===== Barras: cuánto, comparado; en escala logarítmica cuando las cifras saltan de mil en mil =====
export function EscenaBarras({ e }: { e: Barras }) {
  const frame = useCurrentFrame()
  const max = Math.max(...e.barras.map((b) => b.valor))
  const medida = (v: number) => (e.escala === 'log' ? Math.log10(Math.max(1, v)) / Math.log10(Math.max(10, max)) : v / max)
  const X = 380
  const W = 700
  return (
    <>
      {e.titulo && (
        <div style={{ position: 'absolute', left: 76, top: ARRIBA + 20, fontFamily: F.serif, fontSize: 23, color: C.gris, opacity: aparecer(frame, 0) }}>
          {e.titulo}
          {e.escala === 'log' && <span style={{ fontSize: 17 }}> · escala logarítmica: cada marca, diez veces más</span>}
        </div>
      )}
      {e.barras.map((b, i) => {
        const crece = interpolate(frame, [14 + i * 26, 44 + i * 26], [0, 1], { ...FIJO, easing: Easing.out(Easing.cubic) })
        const w = Math.max(4, medida(b.valor) * W * crece)
        const color = b.estado ? colorDe(b.estado) : C.estado
        const y = ARRIBA + 90 + i * 92
        return (
          <div key={i} style={{ opacity: aparecer(frame, 6 + i * 26) }}>
            <div style={{ position: 'absolute', left: 76, top: y + 8, width: X - 96, fontFamily: F.serif, fontSize: 25, color: C.texto }}>{b.etiqueta}</div>
            <div style={{ position: 'absolute', left: X, top: y, width: w, height: 46, borderRadius: 6, background: `${color}33`, border: `1.5px solid ${color}`, boxSizing: 'border-box' }} />
            <div style={{ position: 'absolute', left: X + w + 14, top: y + 9, fontFamily: F.mono, fontSize: 22, color, opacity: crece, whiteSpace: 'nowrap' }}>{b.texto}</div>
          </div>
        )
      })}
    </>
  )
}

// ===== Consulta: el SQL se escribe, sale lo que devuelve y la cifra que importa, en grande =====
export function EscenaConsulta({ e, dur }: { e: Consulta; dur: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const altoSql = BARRA + 24 + e.sql.length * 28
  const altoSalida = BARRA + 24 + Math.max(2, e.salida.length) * 30
  const escribe = { desde: 8, hasta: 8 + Math.min(50, Math.round(dur * 0.22)) }
  const sale = escribe.hasta + 12
  const paso = Math.max(8, Math.round((dur * 0.3) / Math.max(1, e.salida.length)))
  const cifra = sale + e.salida.length * paso + 8
  const s = muelle(frame, cifra, fps)
  return (
    <>
      <Marco x={64} y={ARRIBA + 6} w={720} h={altoSql} titulo="consulta.sql" opacidad={aparecer(frame, 0)}>
        <div style={{ position: 'absolute', left: 16, top: BARRA + 10 }}>
          <Codigo lineas={e.sql} desde={escribe.desde} hasta={escribe.hasta} tamano={18} />
        </div>
      </Marco>
      <Marco x={64} y={ARRIBA + 26 + altoSql} w={720} h={altoSalida} titulo={e.salida_titulo ?? 'resultado'} opacidad={aparecer(frame, sale - 6)}>
        <div style={{ position: 'absolute', left: 18, right: 18, top: BARRA + 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {e.salida.map((l, i) => (
            <div
              key={i}
              style={{
                fontFamily: F.mono, fontSize: 17, lineHeight: '26px', whiteSpace: 'pre', color: l.estado ? colorDe(l.estado) : C.texto,
                opacity: aparecer(frame, sale + i * paso, 8),
              }}
            >
              {l.texto}
            </div>
          ))}
        </div>
      </Marco>
      {e.metrica && (
        <div style={{ position: 'absolute', left: 830, top: ARRIBA + 40, width: 390, display: 'flex', flexDirection: 'column', gap: 8, opacity: s }}>
          <span style={{ fontFamily: F.serif, fontSize: 23, color: C.gris }}>{e.metrica.etiqueta}</span>
          {e.metrica.antes && (
            <span style={{ fontFamily: F.serif, fontSize: 38, color: C.mal, textDecoration: 'line-through', textDecorationThickness: 2 }}>{e.metrica.antes}</span>
          )}
          <span style={{ fontFamily: F.serif, fontSize: 76, lineHeight: 1, color: e.metrica.estado ? colorDe(e.metrica.estado) : C.texto, transform: `scale(${0.85 + 0.15 * s})`, transformOrigin: 'left center' }}>
            {e.metrica.valor}
          </span>
        </div>
      )}
    </>
  )
}

// ===== Pasos: una lista numerada que se enciende de uno en uno =====
export function EscenaPasos({ e, dur }: { e: Pasos; dur: number }) {
  const frame = useCurrentFrame()
  const n = e.pasos.length
  const paso = Math.round((dur * 0.82) / n)
  const alto = Math.min(104, 430 / n)
  return (
    <>
      {e.pasos.map((p, i) => {
        const entra = 10 + i * paso
        const actual = frame >= entra && frame < entra + paso && i < n - 1
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: 120, right: 120, top: ARRIBA + 24 + i * alto, height: alto - 14, boxSizing: 'border-box', display: 'flex', gap: 20,
              alignItems: 'center', padding: '0 22px', borderRadius: 12, background: C.panel, border: `1.5px solid ${actual ? C.foco : C.borde}`,
              opacity: aparecer(frame, entra, 12),
            }}
          >
            <span
              style={{
                width: 36, height: 36, borderRadius: 18, flexShrink: 0, display: 'grid', placeItems: 'center', fontFamily: F.serif, fontSize: 19,
                border: `1.5px solid ${actual ? C.foco : C.gris}`, color: actual ? C.foco : C.gris,
              }}
            >
              {i + 1}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: F.serif, fontSize: 26, color: actual ? C.foco : C.texto }}>{p.texto}</span>
              {p.detalle && <span style={{ fontFamily: F.serif, fontSize: 19, color: C.gris }}>{p.detalle}</span>}
            </span>
          </div>
        )
      })}
    </>
  )
}
