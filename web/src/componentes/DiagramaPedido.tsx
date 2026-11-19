// Un diagrama rico que el tutor encarga (bloque ```diagrama) y se dibuja aparte mientras lees: en cuanto el encargo se
// cierra, se pide al servidor con el texto anterior como contexto. Mientras, «Dibujando: …» y, pasados 30 s, que tarda
// más de lo normal; si no sale, el encargo como texto y un «Reintentar» que hace una sola petición, nunca automática
// (el 18-11-2026 un reintento sin freno pidió un dibujo por trozo). Cada encargo se pide una vez por página (el
// servidor, además, lo guarda en su caché).
import { useEffect, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import Diagrama from './Diagrama.tsx'
import Pensando from './Pensando.tsx'

const pedidos = new Map<string, Promise<string | null>>()
const LENTO_MS = 30_000

function pedirDibujo(encargo: string, contexto: string): Promise<string | null> {
  let p = pedidos.get(encargo)
  if (!p) {
    p = pedir<{ svg: string | null }>('/api/diagramas', enviarJson({ encargo, contexto }))
      .then((r) => r.svg)
      .catch(() => {
        pedidos.delete(encargo) // se reintenta la próxima vez
        return null
      })
    pedidos.set(encargo, p)
  }
  return p
}

export default function DiagramaPedido({ encargo, contexto, cerrado }: { encargo: string; contexto: string; cerrado: boolean }) {
  const [svg, setSvg] = useState<string | null | undefined>(undefined)
  const [lento, setLento] = useState(false)
  const [intento, setIntento] = useState(0)
  useEffect(() => {
    if (!cerrado) return
    let vigente = true
    setSvg(undefined)
    setLento(false)
    const reloj = window.setTimeout(() => vigente && setLento(true), LENTO_MS)
    pedirDibujo(encargo.trim(), contexto).then((s) => {
      window.clearTimeout(reloj)
      if (vigente) setSvg(s)
    })
    return () => {
      vigente = false
      window.clearTimeout(reloj)
    }
  }, [cerrado, encargo, contexto, intento])

  // Solo al pulsar: olvida el resultado fallido y pide una vez más.
  const reintentar = () => {
    pedidos.delete(encargo.trim())
    setIntento((n) => n + 1)
  }

  const titulo = encargo.trim().split('\n')[0]
  if (svg === undefined) {
    const texto = lento ? `Dibujando: ${titulo}. Está tardando más de lo normal.` : `Dibujando: ${titulo}`
    return <div className="diagrama-esperando"><Pensando texto={texto} /></div>
  }
  if (svg === null)
    return (
      <div className="diagrama-encargo">
        <p className="aviso-nota" role="alert">No se ha podido dibujar el diagrama.</p>
        <button type="button" className="boton-mini" onClick={reintentar}>
          Reintentar
        </button>
        <div>{encargo.trim()}</div>
      </div>
    )
  return (
    <div className="diagrama-rico">
      <Diagrama svg={svg} completo />
    </div>
  )
}
