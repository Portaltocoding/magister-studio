import { useEffect, useState } from 'react'
import type { Options } from 'react-markdown'

type Pluggable = NonNullable<Options['rehypePlugins']>[number]

// KaTeX pesa unos 260 KB: se carga la primera vez que algo de la pantalla lleva una fórmula, no al abrir la app.
// Mientras llega (solo la primera vez en la sesión; luego queda en memoria) la fórmula se ve como texto.
// La hoja de estilos de KaTeX sí va con la app (es pequeña y sus fuentes solo se descargan al usarse).

type Katex = typeof import('katex').default
export interface ModuloKatex {
  katex: Katex
  rehypeKatex: Pluggable
}

let cargado: ModuloKatex | null = null
let promesa: Promise<ModuloKatex> | null = null

export function cargarKatex(): Promise<ModuloKatex> {
  promesa ??= Promise.all([import('katex'), import('rehype-katex')])
    .then(([k, r]) => (cargado = { katex: k.default, rehypeKatex: r.default as Pluggable }))
    .catch((e) => {
      promesa = null // otra pantalla podrá volver a intentarlo
      throw e
    })
  return promesa
}

// ¿Puede llevar una fórmula? ($…$, $$…$$, \(…\) o \[…\]). Si no, ni se pide KaTeX.
export const tieneMates = (texto?: string | null) => !!texto && /\$|\\\(|\\\[/.test(texto)

// El módulo de KaTeX si ya está (o en cuanto llegue, si hace falta); null mientras no.
export function usarKatex(hace = true): ModuloKatex | null {
  const [k, setK] = useState<ModuloKatex | null>(cargado)
  useEffect(() => {
    if (k || !hace) return
    let vigente = true
    cargarKatex()
      .then((m) => vigente && setK(m))
      .catch(() => undefined)
    return () => {
      vigente = false
    }
  }, [k, hace])
  return k ?? cargado
}

// Los plugins rehype de Markdown con o sin KaTeX, según haya llegado.
export const conKatex = (k: ModuloKatex | null): Pluggable[] => (k ? [k.rehypeKatex] : [])
