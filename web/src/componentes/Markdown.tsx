import { useEffect, useState, type ComponentType } from 'react'
import type { Options } from 'react-markdown'

export type { Components } from 'react-markdown'

// react-markdown (unos 100 KB) no va en el paquete de arranque: se pide aparte en cuanto la app está quieta, y casi
// siempre ha llegado antes de que haga falta. Si una pantalla lo necesita antes, ese instante enseña el texto tal cual
// (con sus saltos de línea) y en cuanto llega se pinta con formato. Mismas props que react-markdown.

type ComponenteMarkdown = ComponentType<Options>

let cargado: ComponenteMarkdown | null = null
let promesa: Promise<ComponenteMarkdown> | null = null

export function cargarMarkdown(): Promise<ComponenteMarkdown> {
  promesa ??= import('react-markdown')
    .then((m) => (cargado = m.default))
    .catch((e) => {
      promesa = null // otra pantalla podrá volver a intentarlo
      throw e
    })
  return promesa
}

// Se pide sin estorbar al arranque: cuando el navegador está libre (o a los 1,5 s como mucho).
if (typeof window !== 'undefined') {
  const pedirlo = () => void cargarMarkdown().catch(() => undefined)
  if ('requestIdleCallback' in window) window.requestIdleCallback(pedirlo, { timeout: 1500 })
  else setTimeout(pedirlo, 300)
}

export default function Markdown(props: Options) {
  const [Componente, setComponente] = useState<ComponenteMarkdown | null>(() => cargado)
  useEffect(() => {
    if (Componente) return
    let vigente = true
    cargarMarkdown()
      .then((m) => vigente && setComponente(() => m))
      .catch(() => undefined)
    return () => {
      vigente = false
    }
  }, [Componente])
  const Listo = Componente ?? cargado
  if (Listo) return <Listo {...props} />
  return <div style={{ whiteSpace: 'pre-wrap' }}>{props.children}</div>
}
