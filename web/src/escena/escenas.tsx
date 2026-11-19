// Las escenas: cada una toma sus datos del guion gráfico y reparte sus entradas a lo largo de su duración.
// Todo depende del fotograma (se puede pausar, saltar y volver), salvo lo que tú tocas con el vídeo parado.
import { useState } from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { ARRIBA, C, F, aparecer, atenuado, colorDe, muelle, rampa, tinta } from './estilo.ts'
import { Cable, Codigo, Marca, Ventana } from './piezas.tsx'
import type { Contraste, Opciones, PorDentro, Pregunta, Tablero } from './tipos.ts'


// ===== Tablero: el mapa de la lección, con lo hecho, lo de ahora y lo que falta =====
export function EscenaTablero({ e }: { e: Tablero }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const total = e.partes.reduce((n, p) => n + p.ideas.length, 0)
  const ancho = 1128
  const hueco = 14
  // Cada parte, tan ancha como ideas tiene; las ideas en fila dentro de su parte.
  const anchoIdea = (ancho - hueco * (total - 1)) / total
  // Dónde empieza cada parte (en ideas y en píxeles).
  const ancho_ = (p: Tablero['partes'][number]) => anchoIdea * p.ideas.length + hueco * (p.ideas.length - 1)
  const primeras = e.partes.map((_, i) => e.partes.slice(0, i).reduce((s, p) => s + p.ideas.length, 0))
  const izquierdas = e.partes.map((_, i) => 76 + e.partes.slice(0, i).reduce((s, p) => s + ancho_(p) + hueco, 0))
  return (
    <>
      {e.partes.map((p, ip) => {
        const w = ancho_(p)
        const izq = izquierdas[ip]
        const empieza = primeras[ip]
        const n = empieza + p.ideas.length
        // Hecha si su última idea está hecha; «dentro» si la idea actual es suya y aún no está hecha.
        const hecha = n - 1 < e.actual || (!!e.hechas_tambien && n - 1 <= e.actual)
        const dentro = e.actual >= empieza && e.actual < n && !hecha
        const a = aparecer(frame, ip * 4, 12)
        return (
          <div key={ip} style={{ position: 'absolute', left: izq, top: ARRIBA + 30, width: w, opacity: a }}>
            <div
              style={{
                fontFamily: F.serif, fontSize: 19, color: dentro ? C.texto : C.gris, padding: '6px 10px', borderRadius: 8,
                border: `1.5px solid ${dentro ? C.foco : C.borde}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                opacity: atenuado(dentro || hecha),
              }}
            >
              <span>{p.nombre}</span>
              {hecha && !dentro && <Marca bien />}
            </div>
            <div style={{ display: 'flex', gap: hueco, marginTop: 12 }}>
              {p.ideas.map((idea, ii) => {
                const k = empieza + ii
                const actual = k === e.actual
                const hecho = k < e.actual || (!!e.hechas_tambien && k <= e.actual)
                const b = aparecer(frame, 8 + k * 4, 12)
                const s = actual ? muelle(frame, 26, fps) : 1
                return (
                  <div
                    key={ii}
                    style={{
                      width: anchoIdea, minHeight: anchoIdea > 190 ? 250 : 190, padding: '16px 16px', borderRadius: 10, background: C.panel, boxSizing: 'border-box',
                      border: `1.5px solid ${actual ? `rgba(242,179,61,${s})` : C.borde}`, opacity: b * atenuado(actual || hecho),
                      transform: `scale(${actual ? 1 + 0.03 * s : 1})`, position: 'relative',
                    }}
                  >
                    {hecho && <Marca bien estilo={{ position: 'absolute', top: 10, right: 10 }} />}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 24, height: 24, borderRadius: 12, border: `1.5px solid ${actual ? C.foco : C.gris}`, color: actual ? C.foco : C.gris,
                          fontFamily: F.serif, fontSize: 14, display: 'grid', placeItems: 'center', flexShrink: 0,
                        }}
                      >
                        {k + 1}
                      </span>
                    </div>
                    {/* Con muchas ideas la tarjeta es estrecha: una palabra larga se parte en vez de montarse en la de al lado. */}
                    <div style={{ fontFamily: F.serif, fontSize: anchoIdea > 190 ? 25 : 21, color: actual ? C.foco : C.texto, marginTop: 12, lineHeight: 1.15, overflowWrap: 'anywhere', hyphens: 'auto' }}>
                      {idea.nombre}
                    </div>
                    <div style={{ fontFamily: F.serif, fontSize: anchoIdea > 190 ? 19 : 17, color: C.gris, marginTop: 10, lineHeight: 1.3, overflowWrap: 'anywhere', hyphens: 'auto' }}>
                      {idea.que}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

// ===== Por dentro: código, lo que hay en memoria y lo que ve el usuario, unidos por cables =====
// El hueco ancho va entre la memoria y la pantalla, que es por donde suelen viajar los datos.
const ZONAS = {
  codigo: { x: 64, w: 380 },
  memoria: { x: 520, w: 300 },
  pantalla: { x: 980, w: 236 },
} as const
const ALTO_ZONA = 350
// Filas de memoria que caben en ALTO_ZONA (cada una mide unos 41 px con su hueco).
const FILAS_MEMORIA = 6

const ANIMACIONES = `
@keyframes escena-entra { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes escena-pulso { 0% { box-shadow: 0 0 0 0 rgba(98,196,124,.7) } 100% { box-shadow: 0 0 0 12px rgba(98,196,124,0) } }
`

export function EscenaPorDentro({ e, dur }: { e: PorDentro; dur: number }) {
  const frame = useCurrentFrame()
  // Lo que tocas tú con el vídeo parado: cuántas veces has repetido la acción.
  const [repetidas, setRepetidas] = useState(0)
  const escribe = { desde: 8, hasta: 8 + Math.min(54, Math.round(dur * 0.22)) }
  const paso = Math.max(30, Math.round((dur * 0.55) / Math.max(1, e.flujo.length)))
  const empiezaFlujo = escribe.hasta + 12
  const llega = (i: number) => empiezaFlujo + i * paso + 26
  const primeraMemoria = e.flujo.findIndex((f) => f.a === 'memoria')
  const ultimaPantalla = e.flujo.map((f) => f.a).lastIndexOf('pantalla')
  const memoriaDesde = primeraMemoria >= 0 ? llega(primeraMemoria) : 20
  const pantallaDesde = ultimaPantalla >= 0 ? llega(ultimaPantalla) : llega(e.flujo.length - 1)
  const yCable = (i: number) => ARRIBA + 190 + i * 92
  const borde = (z: keyof typeof ZONAS) => ({ izq: ZONAS[z].x, der: ZONAS[z].x + ZONAS[z].w })
  const ultima = e.memoria.filas[e.memoria.filas.length - 1]
  // En la ventana de memoria caben unas seis filas: las repetidas que no caben se cuentan en «+N más».
  const caben = Math.max(1, FILAS_MEMORIA - e.memoria.filas.length)
  const repetidasVistas = repetidas > caben ? caben - 1 : repetidas

  return (
    <>
      <style>{ANIMACIONES}</style>
      <Ventana titulo={e.codigo.fichero} x={ZONAS.codigo.x} y={ARRIBA} w={ZONAS.codigo.w} h={ALTO_ZONA} opacidad={aparecer(frame, 0)}>
        <Codigo lineas={e.codigo.lineas} resaltar={e.codigo.resaltar} desde={escribe.desde} hasta={escribe.hasta} tamano={17} />
      </Ventana>

      <Ventana titulo={e.memoria.titulo} barra="etiqueta" x={ZONAS.memoria.x} y={ARRIBA} w={ZONAS.memoria.w} h={ALTO_ZONA} opacidad={aparecer(frame, 6)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {e.memoria.filas.map((f, i) => {
            const a = aparecer(frame, memoriaDesde + i * 10, 10)
            return <Fila key={i} clave={f.clave} valor={f.valor} color={colorDe(f.estado ?? 'nuevo')} opacidad={a} />
          })}
          {Array.from({ length: repetidasVistas }, (_, i) =>
            e.repetir === 'acumula' && ultima ? (
              <div key={`r${i}`} style={{ animation: 'escena-entra .35s ease-out both' }}>
                <Fila clave={ultima.clave} valor={ultima.valor} color={C.mal} opacidad={1} />
              </div>
            ) : null,
          )}
          {e.repetir === 'acumula' && ultima && repetidas > repetidasVistas && (
            <div key={`mas${repetidas}`} style={{ fontFamily: F.mono, fontSize: 17, color: C.mal, padding: '2px 10px', animation: 'escena-entra .35s ease-out both' }}>
              +{repetidas - repetidasVistas} más
            </div>
          )}
        </div>
        {e.repetir === 'igual' && repetidas > 0 && (
          <div key={repetidas} style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', color: C.bien, fontFamily: F.serif, fontSize: 17, animation: 'escena-entra .35s ease-out both' }}>
            <Marca bien /> repetida {repetidas} {repetidas === 1 ? 'vez' : 'veces'}, nada cambia
          </div>
        )}
      </Ventana>

      <Ventana titulo={e.pantalla.titulo} barra="direccion" x={ZONAS.pantalla.x} y={ARRIBA} w={ZONAS.pantalla.w} h={ALTO_ZONA} opacidad={aparecer(frame, 12)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {e.pantalla.lineas.map((l, i) => (
            <div
              key={i}
              style={{
                fontFamily: F.serif, fontSize: 22, color: tinta(l.estado, C.texto),
                padding: '8px 10px', borderRadius: 8, border: `1px solid ${l.estado ? colorDe(l.estado) : C.borde}`,
                opacity: aparecer(frame, pantallaDesde + i * 8, 10),
              }}
            >
              {l.texto}
            </div>
          ))}
          {e.pantalla.boton && (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation()
                if (e.repetir) setRepetidas((n) => n + 1)
              }}
              title={e.repetir ? 'Púlsalo con el vídeo parado: repite la acción' : undefined}
              style={{
                alignSelf: 'flex-start', marginTop: 4, fontFamily: F.serif, fontSize: 19, color: C.app, background: 'transparent',
                border: `1.5px solid ${C.app}`, borderRadius: 8, padding: '6px 18px', cursor: e.repetir ? 'pointer' : 'default',
                opacity: aparecer(frame, 14), animation: repetidas ? 'escena-pulso .5s ease-out' : undefined,
              }}
              key={repetidas}
            >
              {e.pantalla.boton}
            </button>
          )}
        </div>
      </Ventana>

      {e.flujo.map((f, i) => {
        const de = borde(f.de)
        const a = borde(f.a)
        const haciaDerecha = ZONAS[f.a].x > ZONAS[f.de].x
        return (
          <Cable
            key={i}
            x1={haciaDerecha ? de.der : de.izq}
            y1={yCable(i)}
            x2={haciaDerecha ? a.izq : a.der}
            y2={yCable(i) + 8}
            desde={empiezaFlujo + i * paso}
            dura={26}
            color={tinta(f.estado, C.estado)}
            etiqueta={f.etiqueta}
            roto={f.estado === 'mal'}
          />
        )
      })}

      {e.repetir && (
        <div
          style={{
            position: 'absolute', left: ZONAS.pantalla.x, top: ARRIBA + ALTO_ZONA + 14, width: ZONAS.pantalla.w, fontFamily: F.serif, fontSize: 15,
            color: C.gris, opacity: rampa(frame, [dur - 60, dur - 30], [0, 1]),
          }}
        >
          Para el vídeo y pulsa «{e.pantalla.boton}» para repetirlo tú.
        </div>
      )}
    </>
  )
}

function Fila({ clave, valor, color, opacidad }: { clave: string; valor: string; color: string; opacidad: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: opacidad, fontFamily: F.mono, fontSize: 18 }}>
      <span style={{ border: `1.5px solid ${color}`, color, borderRadius: 7, padding: '4px 10px', flex: 1, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ color: C.texto }}>{clave}</span>
        <span>{valor}</span>
      </span>
    </div>
  )
}

// ===== Pregunta: la que el alumno debería hacerse, grande, antes de la respuesta =====
export function EscenaPregunta({ e }: { e: Pregunta }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const palabras = e.pregunta.split(' ')
  const s = muelle(frame, 4, fps)
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
      <div style={{ fontFamily: F.serif, fontSize: 150, lineHeight: 1, color: C.foco, transform: `scale(${0.6 + 0.4 * s})`, opacity: s }}>?</div>
      <div style={{ fontFamily: F.serif, fontSize: 40, color: C.texto, maxWidth: 980, textAlign: 'center', lineHeight: 1.25 }}>
        {palabras.map((p, i) => (
          <span key={i} style={{ opacity: aparecer(frame, 14 + i * 3, 8) }}>
            {p}{' '}
          </span>
        ))}
      </div>
      {e.pista && <div style={{ fontFamily: F.serif, fontSize: 21, color: C.gris, opacity: aparecer(frame, 30 + palabras.length * 3) }}>{e.pista}</div>}
    </div>
  )
}

// ===== Contraste: las versiones lado a lado y lo que cambia =====
export function EscenaContraste({ e, dur }: { e: Contraste; dur: number }) {
  const frame = useCurrentFrame()
  const n = e.lados.length
  const w = (1128 - 24 * (n - 1)) / n
  const lineas = Math.max(...e.lados.map((l) => l.lineas.length))
  const paso = Math.max(10, Math.round((dur * 0.6) / Math.max(1, lineas)))
  return (
    <>
      {e.lados.map((l, i) => {
        const color = l.estado ? colorDe(l.estado) : C.borde
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: 76 + i * (w + 24), top: ARRIBA + 30, width: w, minHeight: 330, boxSizing: 'border-box', padding: '18px 22px',
              background: C.panel, borderRadius: 12, border: `1.5px solid ${color}`, opacity: aparecer(frame, i * 6),
            }}
          >
            <div style={{ fontFamily: F.serif, fontSize: 26, color: tinta(l.estado, C.texto) }}>{l.etiqueta}</div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {l.lineas.map((t, j) => (
                <div key={j} style={{ fontFamily: F.mono, fontSize: 19, color: C.texto, opacity: aparecer(frame, 14 + j * paso, 10) }}>
                  {t}
                </div>
              ))}
            </div>
            {l.nota && (
              <div style={{ marginTop: 18, fontFamily: F.serif, fontSize: 17, color: C.gris, opacity: aparecer(frame, 14 + lineas * paso, 12) }}>{l.nota}</div>
            )}
          </div>
        )
      })}
      {e.veredicto && (
        <div
          style={{
            position: 'absolute', left: 0, right: 0, top: ARRIBA + 400, textAlign: 'center', fontFamily: F.serif, fontSize: 30, color: C.texto,
            opacity: aparecer(frame, Math.round(dur * 0.72), 14),
          }}
        >
          <span style={{ borderBottom: `2px solid ${C.foco}`, paddingBottom: 4 }}>{e.veredicto}</span>
        </div>
      )}
    </>
  )
}

// ===== Opciones con veredicto: huecos vacíos que se llenan uno a uno =====
export function EscenaOpciones({ e, dur }: { e: Opciones; dur: number }) {
  const frame = useCurrentFrame()
  const n = e.opciones.length
  const w = (1128 - 20 * (n - 1)) / n
  const paso = Math.round((dur * 0.8) / n)
  return (
    <>
      {e.opciones.map((o, i) => {
        const llena = aparecer(frame, 10 + i * paso, 14)
        const actual = frame >= 10 + i * paso && frame < 10 + (i + 1) * paso
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: 76 + i * (w + 20), top: ARRIBA + 24, width: w, height: 360, boxSizing: 'border-box', padding: '20px 20px',
              borderRadius: 12, background: C.panel, border: `1.5px ${llena > 0 ? 'solid' : 'dashed'} ${actual ? C.foco : C.borde}`,
              opacity: aparecer(frame, i * 4),
            }}
          >
            <div style={{ opacity: llena, display: 'flex', flexDirection: 'column', height: '100%' }}>
              <Marca bien={o.veredicto === 'bien'} depende={o.veredicto === 'depende'} tamano={26} estilo={{ position: 'absolute', top: 14, right: 14 }} />
              <div style={{ fontFamily: F.serif, fontSize: 27, color: actual ? C.foco : C.texto, lineHeight: 1.15, paddingRight: 30 }}>{o.nombre}</div>
              <div style={{ fontFamily: F.mono, fontSize: 17, color: C.numero, marginTop: 12 }}>{o.como}</div>
              <div style={{ fontFamily: F.serif, fontSize: 21, color: C.gris, marginTop: 16, lineHeight: 1.35 }}>{o.explica}</div>
              <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${C.borde}`, fontFamily: F.serif, fontSize: 17, color: C.gris }}>
                {e.etiqueta_uso ?? 'úsala para:'} <span style={{ color: o.veredicto === 'mal' ? C.mal : C.texto }}>{o.usar_para}</span>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
