import { Children, isValidElement, useEffect, useMemo, useState, type ReactNode, createContext, useContext } from 'react'
import Markdown, { type Components } from './Markdown.tsx'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Diagrama } from './Interactivo.tsx'
import { conKatex, tieneMates, usarKatex } from './katexPerezoso.ts'
import 'katex/dist/katex.min.css'
import type { VarianteFicha } from './varianteFicha.ts'

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
    .replace(/^[ \t]*\$\$[ \t]*(.+?)[ \t]*\$\$[ \t]*$/gm, (_, f: string) => `$$\n${f}\n$$`)
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

// Rehacer un bloque desde la propia lectura. El panel dice qué títulos son bloques y qué hacer al pedirlo.
export interface Rehacer {
  bloques: Record<string, string> // título -> clave
  alRehacer: (clave: string, como: string) => Promise<void>
}
const RehacerContexto = createContext<Rehacer | null>(null)

const MANERAS: [string, string][] = [
  ['sencillo', 'Más sencillo'],
  ['ejemplos', 'Con más ejemplos'],
  ['codigo', 'Con código'],
  ['fondo', 'Más a fondo'],
  ['corto', 'Más corto'],
]

function TituloBloque({ texto: t, children }: { texto: string; children: ReactNode }) {
  const r = useContext(RehacerContexto)
  const [abierto, setAbierto] = useState(false)
  const [haciendo, setHaciendo] = useState(false)
  const [propio, setPropio] = useState('')
  const limpio = t.replace(/\s*\{[^}]*\}\s*$/, '').trim()
  const clave = r?.bloques[limpio]
  const pedir = async (como: string) => {
    if (!r || !clave) return
    setAbierto(false)
    setHaciendo(true)
    try {
      await r.alRehacer(clave, como)
    } finally {
      setHaciendo(false)
    }
  }
  return (
    <h2 id={ancla(t)} className={clave ? 'con-rehacer' : undefined}>
      {children}
      {clave && (
        <span className="rehacer">
          {haciendo ? (
            <small className="rehacer-haciendo">Rehaciendo este apartado…</small>
          ) : (
            <button type="button" className="rehacer-boton" aria-expanded={abierto} onClick={() => setAbierto(!abierto)} title="Rehacer solo este apartado, a tu manera">
              Rehacer ▾
            </button>
          )}
          {abierto && (
            <span className="rehacer-menu" role="menu">
              {MANERAS.map(([id, nombre]) => (
                <button key={id} type="button" role="menuitem" onClick={() => pedir(id)}>
                  {nombre}
                </button>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (propio.trim().length > 1) pedir(propio.trim())
                }}
              >
                <input value={propio} onChange={(e) => setPropio(e.target.value)} placeholder="O dime cómo…" aria-label="Cómo rehacerlo" />
              </form>
            </span>
          )}
        </span>
      )}
    </h2>
  )
}

const componentes: Components = {
  // Los diagramas ```svg de los apuntes, como imagen (no ejecuta nada).
  pre: ({ children }) => {
    const hijo = Children.toArray(children)[0]
    if (isValidElement<{ className?: string; children?: ReactNode }>(hijo) && (hijo.props.className ?? '').includes('language-svg'))
      return <Diagrama svg={String(hijo.props.children ?? '')} completo />
    return <pre>{children}</pre>
  },
  h2: ({ children }) => <TituloBloque texto={texto(children)}>{children}</TituloBloque>,
  h6: ({ children }) => <span className="lb-etq">{children}</span>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

function Pintar({ nodo }: { nodo: Nodo | string }) {
  const katex = usarKatex(typeof nodo === 'string' && tieneMates(nodo))
  if (typeof nodo === 'string')
    return (
      <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={conKatex(katex)} components={componentes}>
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
// `variante`: el estilo de la ficha (limpia, cuaderno o mixta, ver varianteFicha.ts); sin ella, el de siempre (mixta).
export function TextoLibro({ markdown, className = '', variante }: { markdown: string; className?: string; variante?: VarianteFicha }) {
  const nodos = useMemo(() => arbol(markdown.replace(/^---\n[\s\S]*?\n---\n/, '')), [markdown])
  return (
    <article className={`lector-texto ${className}`} data-ficha={variante}>
      <Pintar nodo={nodos} />
    </article>
  )
}

interface Props {
  markdown: string
  // Contenedor que se desplaza (para saber qué sección estás leyendo).
  raiz?: Element | null
  rehacer?: Rehacer
  variante?: VarianteFicha
}

export default function LectorLibro({ markdown, raiz, rehacer, variante }: Props) {
  const cuerpo = useMemo(() => markdown.replace(/^---\n[\s\S]*?\n---\n/, ''), [markdown])
  const nodos = useMemo(() => arbol(cuerpo), [cuerpo])
  const indice = useMemo(() => secciones(cuerpo), [cuerpo])
  const [activa, setActiva] = useState<string | null>(null)

  useEffect(() => {
    // La sección que lees es la última cuyo título ya ha pasado por encima del 40 % de la vista. Al final del todo,
    // la última («Repaso sin mirar») nunca llega ahí: si ya no se puede bajar más, es esa (antes se quedaba marcada
    // la anterior, o la que entrara en la franja aunque estuvieras más abajo).
    const caja = raiz instanceof HTMLElement ? raiz : null
    const desplaza: HTMLElement | Window = caja ?? window
    let pendiente = 0
    const mirar = () => {
      pendiente = 0
      const doc = caja ?? document.documentElement
      const arriba = caja ? caja.getBoundingClientRect().top : 0
      const alto = caja ? caja.clientHeight : window.innerHeight
      const titulos = indice.map((s) => ({ s, el: document.getElementById(s.id) })).filter((x) => x.el)
      if (!titulos.length) return
      const alFinal = doc.scrollTop > 0 && doc.scrollHeight - doc.scrollTop - doc.clientHeight < 8
      const pasados = titulos.filter((x) => x.el!.getBoundingClientRect().top - arriba <= alto * 0.4)
      const elegida = alFinal ? titulos[titulos.length - 1] : (pasados[pasados.length - 1] ?? titulos[0])
      setActiva(elegida.s.id)
    }
    const alDesplazar = () => {
      if (!pendiente) pendiente = window.requestAnimationFrame(mirar)
    }
    mirar()
    desplaza.addEventListener('scroll', alDesplazar, { passive: true })
    return () => {
      if (pendiente) window.cancelAnimationFrame(pendiente)
      desplaza.removeEventListener('scroll', alDesplazar)
    }
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
      <article className="lector-texto" data-ficha={variante}>
        <RehacerContexto.Provider value={rehacer ?? null}>
          <Pintar nodo={nodos} />
        </RehacerContexto.Provider>
      </article>
    </div>
  )
}

// Una fórmula suelta (glosario, fichas). KaTeX escapa el texto; si el LaTeX está mal, se ve tal cual.
export function Tex({ latex, bloque = false }: { latex: string; bloque?: boolean }) {
  const k = usarKatex()
  const html = useMemo(() => {
    if (!k) return null // mientras llega KaTeX (solo la primera vez), el LaTeX tal cual
    try {
      return k.katex.renderToString(latex, { displayMode: bloque, throwOnError: false, trust: false })
    } catch {
      return null
    }
  }, [k, latex, bloque])
  return html ? <span className="tex" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{latex}</code>
}
