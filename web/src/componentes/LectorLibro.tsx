import { Children, isValidElement, useEffect, useMemo, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Lee el markdown del motor del libro (cajas `::: nombre`, etiquetas `{etq="..."}`, `[x]{.clase}`)
// y lo pinta en pantalla con la misma maqueta: portada negra, teoría amarilla, práctica verde.

type Nodo = { clase: string; hijos: (Nodo | string)[] }

const ABRE = /^\s*:::\s*([\w-]+)\s*$/
const CIERRA = /^\s*:::\s*$/

function arbol(md: string): Nodo {
  const raiz: Nodo = { clase: 'raiz', hijos: [] }
  const pila = [raiz]
  let texto: string[] = []
  const volcar = () => {
    if (texto.join('').trim()) pila[pila.length - 1].hijos.push(texto.join('\n'))
    texto = []
  }
  for (const linea of md.split('\n')) {
    const abre = linea.match(ABRE)
    if (abre) {
      volcar()
      const n: Nodo = { clase: abre[1], hijos: [] }
      pila[pila.length - 1].hijos.push(n)
      pila.push(n)
    } else if (CIERRA.test(linea) && pila.length > 1) {
      volcar()
      pila.pop()
    } else texto.push(linea.replace(/^ {3}/, ''))
  }
  volcar()
  return raiz
}

// Las marcas del guion ([[intuicion]], [[choque]]...) se leen como etiquetas.
const MARCAS: Record<string, string> = {
  intuicion: 'Intuición',
  choque: 'Choque',
  nombre: 'Nombre',
  teoria: 'Teoría',
  ejemplo: 'Ejemplo',
  cierre: 'Cierre',
  practica: 'Práctica',
}
const marca = (m: string) => MARCAS[m] ?? m.charAt(0).toUpperCase() + m.slice(1)

// Las etiquetas del motor pasan a Markdown normal: la etiqueta de un título va como h6 encima.
function limpiar(t: string): string {
  return t
    .replace(/^\[\[([a-z_]+)\]\]\s*/gm, (_, m: string) => `###### ${marca(m)}\n\n`)
    .replace(/^(#{1,4}) (.+?)\s*\{([^}]*)\}\s*$/gm, (_, h: string, titulo: string, attrs: string) => {
      const etq = attrs.match(/etq="([^"]*)"/)
      return `${etq ? `###### ${etq[1]}\n\n` : ''}${h} ${titulo}`
    })
    .replace(/\[([^\]]+)\]\{\.salir\}/g, '> $1')
    .replace(/\[([^\]]+)\]\{\.num\}/g, '')
    .replace(/\[([^\]]+)\]\{\.cita\}/g, '*$1*')
    .replace(/\[([^\]]+)\]\{\.(ess|sec2)\}/g, '**$1**')
    .replace(/^\[\[\d+\]\]\s*$/gm, '')
    .replace(/\[\[\d+\]\]/g, '')
}

const texto = (n: ReactNode): string =>
  Children.toArray(n)
    .map((x) => (typeof x === 'string' ? x : isValidElement(x) ? texto((x.props as { children?: ReactNode }).children) : ''))
    .join('')

export const ancla = (t: string) =>
  'sec-' +
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const componentes: Components = {
  h2: ({ children }) => <h2 id={ancla(texto(children))}>{children}</h2>,
  h6: ({ children }) => <span className="lb-etq">{children}</span>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

function Pintar({ nodo }: { nodo: Nodo | string }) {
  if (typeof nodo === 'string')
    return (
      <Markdown remarkPlugins={[remarkGfm]} components={componentes}>
        {limpiar(nodo)}
      </Markdown>
    )
  const hijos = nodo.hijos.map((h, i) => <Pintar key={i} nodo={h} />)
  if (nodo.clase === 'raiz') return <>{hijos}</>
  if (nodo.clase === 'fantasma')
    return (
      <details className="lb-fantasma">
        <summary>Ver la respuesta</summary>
        {hijos}
      </details>
    )
  return <div className={`lb-${nodo.clase}`}>{hijos}</div>
}

export interface Seccion {
  id: string
  titulo: string
  etq: string | null
}

export function secciones(md: string): Seccion[] {
  return [...md.matchAll(/^## (.+?)(?:\s*\{([^}]*)\})?\s*$/gm)].map((m) => ({
    id: ancla(m[1]),
    titulo: m[1],
    etq: m[2]?.match(/etq="([^"]*)"/)?.[1] ?? null,
  }))
}

// El mismo papel y las mismas cajas, sin índice: para el guion y el modo foco.
export function TextoLibro({ markdown, className = '' }: { markdown: string; className?: string }) {
  const nodos = useMemo(() => arbol(markdown.replace(/^---\n[\s\S]*?\n---\n/, '')), [markdown])
  return (
    <article className={`lector-texto ${className}`}>
      <Pintar nodo={nodos} />
    </article>
  )
}

interface Props {
  markdown: string
  // Contenedor que se desplaza (para saber qué sección estás leyendo).
  raiz?: Element | null
}

export default function LectorLibro({ markdown, raiz }: Props) {
  const cuerpo = useMemo(() => markdown.replace(/^---\n[\s\S]*?\n---\n/, ''), [markdown])
  const nodos = useMemo(() => arbol(cuerpo), [cuerpo])
  const indice = useMemo(() => secciones(cuerpo), [cuerpo])
  const [activa, setActiva] = useState<string | null>(null)

  useEffect(() => {
    const vistos = new Map<string, boolean>()
    const obs = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((e) => vistos.set(e.target.id, e.isIntersecting))
        const primera = indice.find((s) => vistos.get(s.id))
        if (primera) setActiva(primera.id)
      },
      { root: raiz ?? null, rootMargin: '0px 0px -60% 0px' },
    )
    indice.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [indice, raiz])

  return (
    <div className="lector">
      <nav className="lector-indice" aria-label="Índice de los apuntes">
        <p className="lector-indice-titulo">En esta lección</p>
        <ol>
          {indice.map((s) => (
            <li key={s.id} className={activa === s.id ? 'activa' : ''}>
              <button onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                {s.etq && <small>{s.etq}</small>}
                {s.titulo}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <article className="lector-texto">
        <Pintar nodo={nodos} />
      </article>
    </div>
  )
}
