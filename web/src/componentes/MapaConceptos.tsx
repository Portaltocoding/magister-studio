import { useEffect, useRef, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'

// Tu mapa de palabras clave: lo construyes tú mientras estudias. Pocas palabras, y una flecha solo si entiendes la
// relación (la flecha es una explicación que has hecho tuya). No es un resumen: es lo justo para obligarte a recordar.
// Doble clic en el lienzo añade una palabra; arrastrar la mueve; «Unir» y dos clics hacen una flecha; un clic en una
// flecha la quita.

export interface Nodo {
  id: string
  texto: string
  x: number
  y: number
}
export interface Flecha {
  de: string
  a: string
}
export interface Mapa {
  nodos: Nodo[]
  flechas: Flecha[]
}

const nuevoId = () => Math.random().toString(36).slice(2, 9)
const ANCHO = 560
const ALTO = 420

export function usarMapa(mid: number) {
  const [mapa, setMapa] = useState<Mapa | null>(null)
  const espera = useRef(0)
  useEffect(() => {
    pedir<Mapa>(`/api/estudio/${mid}/mapa`).then(setMapa).catch(() => setMapa({ nodos: [], flechas: [] }))
  }, [mid])
  const cambiar = (m: Mapa) => {
    setMapa(m)
    window.clearTimeout(espera.current)
    espera.current = window.setTimeout(() => pedir(`/api/estudio/${mid}/mapa`, enviarJson(m, 'PUT')).catch(() => undefined), 500)
  }
  // Añade palabras (desde el texto o la mascota) en un hueco libre.
  const anadir = (textos: string[]) => {
    setMapa((m) => {
      if (!m) return m
      const nuevos = textos
        .map((t) => t.trim().slice(0, 60))
        .filter((t) => t && !m.nodos.some((n) => n.texto.toLowerCase() === t.toLowerCase()))
        .map((t, k) => ({ id: nuevoId(), texto: t, x: 30 + ((m.nodos.length + k) % 4) * 130, y: 30 + Math.floor((m.nodos.length + k) / 4) * 70 }))
      const r = { ...m, nodos: [...m.nodos, ...nuevos] }
      window.clearTimeout(espera.current)
      espera.current = window.setTimeout(() => pedir(`/api/estudio/${mid}/mapa`, enviarJson(r, 'PUT')).catch(() => undefined), 500)
      return r
    })
  }
  return { mapa, cambiar, anadir }
}

export default function MapaConceptos({ mapa, alCambiar, soloVer = false }: { mapa: Mapa; alCambiar?: (m: Mapa) => void; soloVer?: boolean }) {
  const [uniendo, setUniendo] = useState<string | null | false>(false)
  const [editando, setEditando] = useState<string | null>(null)
  const arrastre = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)

  const punto = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * ANCHO, y: ((e.clientY - r.top) / r.height) * ALTO }
  }
  const cambiar = (m: Mapa) => alCambiar?.(m)

  const centro = (n: Nodo) => ({ x: n.x + Math.max(60, n.texto.length * 7.2 + 20) / 2, y: n.y + 16 })

  return (
    <div className="mapa-conceptos">
      {!soloVer && (
        <div className="mapa-barra">
          <button
            className={`boton-mini ${uniendo !== false ? 'activo' : ''}`}
            onClick={() => setUniendo(uniendo === false ? null : false)}
            title="Pulsa una palabra y luego otra para unirlas con una flecha"
          >
            {uniendo === false ? 'Unir con flecha' : uniendo ? 'Ahora la segunda…' : 'Elige la primera…'}
          </button>
          <span className="nota">Doble clic: palabra nueva · arrastra para mover · clic en una flecha: quitarla</span>
        </div>
      )}
      <svg
        ref={svg}
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="mapa-lienzo"
        onDoubleClick={(e) => {
          if (soloVer || (e.target as Element).closest('.mapa-nodo')) return
          const p = punto(e)
          const id = nuevoId()
          cambiar({ ...mapa, nodos: [...mapa.nodos, { id, texto: 'palabra', x: p.x - 40, y: p.y - 16 }] })
          setEditando(id)
        }}
        onPointerMove={(e) => {
          if (!arrastre.current) return
          const p = punto(e)
          const { id, dx, dy } = arrastre.current
          cambiar({ ...mapa, nodos: mapa.nodos.map((n) => (n.id === id ? { ...n, x: Math.max(0, Math.min(ANCHO - 60, p.x - dx)), y: Math.max(0, Math.min(ALTO - 32, p.y - dy)) } : n)) })
        }}
        onPointerUp={() => (arrastre.current = null)}
        onPointerLeave={() => (arrastre.current = null)}
      >
        <defs>
          <marker id="mapa-punta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {mapa.flechas.map((f, k) => {
          const a = mapa.nodos.find((n) => n.id === f.de)
          const b = mapa.nodos.find((n) => n.id === f.a)
          if (!a || !b) return null
          const p1 = centro(a)
          const p2 = centro(b)
          const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
          const recorte = 22
          return (
            <line
              key={k}
              className="mapa-flecha"
              x1={p1.x + ((p2.x - p1.x) / d) * recorte}
              y1={p1.y + ((p2.y - p1.y) / d) * recorte}
              x2={p2.x - ((p2.x - p1.x) / d) * recorte}
              y2={p2.y - ((p2.y - p1.y) / d) * recorte}
              markerEnd="url(#mapa-punta)"
              onClick={() => !soloVer && cambiar({ ...mapa, flechas: mapa.flechas.filter((_, j) => j !== k) })}
            />
          )
        })}
        {mapa.nodos.map((n) => {
          const ancho = Math.max(60, n.texto.length * 7.2 + 20)
          return (
            <g
              key={n.id}
              className={`mapa-nodo ${uniendo === n.id ? 'elegido' : ''}`}
              transform={`translate(${n.x} ${n.y})`}
              onPointerDown={(e) => {
                if (soloVer || uniendo !== false || editando === n.id) return
                const p = punto(e)
                arrastre.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y }
              }}
              onClick={() => {
                if (soloVer || uniendo === false) return
                if (uniendo === null) setUniendo(n.id)
                else {
                  if (uniendo !== n.id && !mapa.flechas.some((f) => f.de === uniendo && f.a === n.id))
                    cambiar({ ...mapa, flechas: [...mapa.flechas, { de: uniendo, a: n.id }] })
                  setUniendo(null)
                }
              }}
              onDoubleClick={() => !soloVer && setEditando(n.id)}
            >
              <rect width={ancho} height={32} rx={10} />
              {editando === n.id ? (
                <foreignObject width={ancho + 60} height={32}>
                  <input
                    className="mapa-editar"
                    autoFocus
                    defaultValue={n.texto === 'palabra' ? '' : n.texto}
                    onBlur={(e) => {
                      const t = e.target.value.trim()
                      cambiar(
                        t
                          ? { ...mapa, nodos: mapa.nodos.map((x) => (x.id === n.id ? { ...x, texto: t.slice(0, 60) } : x)) }
                          : { nodos: mapa.nodos.filter((x) => x.id !== n.id), flechas: mapa.flechas.filter((f) => f.de !== n.id && f.a !== n.id) },
                      )
                      setEditando(null)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </foreignObject>
              ) : (
                <text x={ancho / 2} y={21} textAnchor="middle">
                  {n.texto}
                </text>
              )}
            </g>
          )
        })}
        {!mapa.nodos.length && (
          <text x={ANCHO / 2} y={ALTO / 2} textAnchor="middle" className="mapa-vacio">
            {soloVer ? 'Aún no has hecho tu mapa' : 'Doble clic para tu primera palabra clave'}
          </text>
        )}
      </svg>
    </div>
  )
}
