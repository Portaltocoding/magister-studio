// Un diagrama rico que el tutor encarga (bloque ```diagrama) y se dibuja aparte mientras lees: en cuanto el encargo se
// cierra, se pide al servidor con el texto anterior como contexto. Mientras, «Dibujando el mapa…»; si no sale, el
// encargo como texto. Cada encargo se pide una vez por página (el servidor, además, lo guarda en su caché).
import { useEffect, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import Diagrama from './Diagrama.tsx'
import Pensando from './Pensando.tsx'

const pedidos = new Map<string, Promise<string | null>>()

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
  useEffect(() => {
    if (!cerrado) return
    let vigente = true
    pedirDibujo(encargo.trim(), contexto).then((s) => vigente && setSvg(s))
    return () => {
      vigente = false
    }
  }, [cerrado, encargo, contexto])

  const titulo = encargo.trim().split('\n')[0]
  if (svg === undefined) return <div className="diagrama-esperando"><Pensando texto={`Dibujando: ${titulo}`} /></div>
  if (svg === null) return <div className="diagrama-encargo">{encargo.trim()}</div>
  return (
    <div className="diagrama-rico">
      <Diagrama svg={svg} completo />
    </div>
  )
}

