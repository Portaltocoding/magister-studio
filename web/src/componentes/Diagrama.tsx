import { useEffect, useMemo, useRef, useState } from 'react'

// Un diagrama SVG del tutor que se dibuja solo, trazo a trazo (como Vivus o Manim): primero las líneas,
// luego los rellenos y por último los textos. Sin caja de fondo: los colores se adaptan al tema.
// El SVG se limpia aquí antes de ponerlo en la página: solo formas y texto, nada que se ejecute o cargue de fuera.

const ETIQUETAS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker', 'title',
])
const ATRIBUTOS = new Set([
  'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity',
  'stroke-opacity', 'font-size', 'font-weight', 'font-family', 'font-style', 'text-anchor', 'dominant-baseline', 'dx', 'dy',
  'marker-end', 'marker-start', 'marker-mid', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'id', 'class',
])
const FORMAS = 'path, rect, circle, ellipse, line, polyline, polygon'

// Oscuro -> el color del texto; claro -> un relleno suave; con color -> el realce.
function recolorear(valor: string | null): string | null {
  if (!valor || valor === 'none' || valor.startsWith('url(') || valor === 'currentColor') return valor
  const m = valor.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return 'currentColor'
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const luz = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const saturacion = Math.max(r, g, b) - Math.min(r, g, b)
  if (saturacion > 0.25) return 'var(--dg-realce)'
  if (luz < 0.45) return 'currentColor'
  return 'var(--dg-relleno)'
}

function limpiar(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const raiz = doc.documentElement
  if (raiz.nodeName !== 'svg' || doc.querySelector('parsererror')) return null
  const recorrer = (el: Element) => {
    for (const hijo of Array.from(el.children)) {
      if (!ETIQUETAS.has(hijo.nodeName)) {
        hijo.remove()
        continue
      }
      for (const a of Array.from(hijo.attributes)) {
        const nombre = a.name
        if (!ATRIBUTOS.has(nombre) || /^\s*javascript:/i.test(a.value)) hijo.removeAttribute(nombre)
        else if (nombre === 'fill' || nombre === 'stroke') hijo.setAttribute(nombre, recolorear(a.value) ?? a.value)
      }
      recorrer(hijo)
    }
  }
  for (const a of Array.from(raiz.attributes)) if (!ATRIBUTOS.has(a.name) && a.name !== 'xmlns') raiz.removeAttribute(a.name)
  if (raiz.getAttribute('fill')) raiz.setAttribute('fill', recolorear(raiz.getAttribute('fill')) ?? 'currentColor')
  recorrer(raiz)
  raiz.removeAttribute('width')
  raiz.removeAttribute('height')
  return new XMLSerializer().serializeToString(raiz)
}

const quieto = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Pone cada forma a dibujarse en orden y los textos a aparecer detrás de la forma que les precede.
function animar(caja: HTMLElement) {
  const svg = caja.querySelector('svg')
  if (!svg || quieto()) return
  let t = 0
  const PASO = 140
  for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>(`${FORMAS}, text`))) {
    if (el.closest('marker, defs')) continue
    if (el.tagName === 'text') {
      el.style.animation = `dg-aparecer 420ms ease-out ${t + 120}ms backwards`
      continue
    }
    let largo = 0
    try {
      largo = (el as unknown as SVGGeometryElement).getTotalLength()
    } catch {
      largo = 0
    }
    if (!largo) continue
    const dura = Math.min(900, 260 + largo * 0.9)
    el.style.strokeDasharray = `${largo}`
    el.style.strokeDashoffset = `${largo}`
    el.style.animation = `dg-trazar ${dura}ms cubic-bezier(.45,0,.2,1) ${t}ms forwards, dg-rellenar 380ms ease-out ${t + dura * 0.7}ms backwards`
    // La punta de flecha sale cuando la línea llega a ella.
    for (const m of ['marker-end', 'marker-start']) {
      const v = el.getAttribute(m)
      if (v) {
        el.removeAttribute(m)
        window.setTimeout(() => el.setAttribute(m, v), t + dura * 0.9)
      }
    }
    t += PASO
  }
}

export default function Diagrama({ svg, completo }: { svg: string; completo: boolean }) {
  const limpio = useMemo(() => (completo ? limpiar(svg.trim()) : null), [svg, completo])
  const caja = useRef<HTMLDivElement | null>(null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    if (caja.current && limpio) animar(caja.current)
  }, [limpio, vuelta])

  if (!completo || (!limpio && !svg.trim().endsWith('</svg>'))) return <div className="diagrama-esperando">Dibujando…</div>
  if (!limpio) return null
  return (
    <figure className="diagrama-vivo">
      <div key={vuelta} ref={caja} className="diagrama-lienzo" dangerouslySetInnerHTML={{ __html: limpio }} />
      <button type="button" className="diagrama-otra" onClick={() => setVuelta((v) => v + 1)} title="Volver a dibujarlo">
        ↻
      </button>
    </figure>
  )
}
