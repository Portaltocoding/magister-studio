import { useEffect, useRef, useState } from 'react'
import { crearFuente, enviarJson, listarFuentes, pedir, subirUrl } from '../api.ts'
import Pensando from './Pensando.tsx'

// Los botones del arnés bajo una respuesta: los pone el servidor según el caso (no el modelo, no gastan tokens).
export interface AccionArnes {
  tipo: 'ir' | 'buscar'
  etiqueta: string
  ruta?: string
  consulta?: string
}

interface Propuesta {
  url: string
  titulo: string
  motivo: string
}

const FUENTE = 'Documentos buscados'

async function fuenteDeBuscados(): Promise<number> {
  const fs = await listarFuentes()
  return (fs.find((f) => f.nombre === FUENTE) ?? (await crearFuente(FUENTE, 'web', 1))).id
}

function BuscarDocumentos({ consulta }: { consulta: string }) {
  const [estado, setEstado] = useState<'buscando' | 'hecho' | 'error'>('buscando')
  const [lista, setLista] = useState<Propuesta[]>([])
  const [anadidas, setAnadidas] = useState<Record<string, 'añadiendo' | 'añadida' | 'error'>>({})
  const [motivo, setMotivo] = useState<string | null>(null)

  const lanzada = useRef(false)
  useEffect(() => {
    if (lanzada.current) return
    lanzada.current = true
    pedir<{ propuestas: Propuesta[]; motivo_fin: string | null }>('/api/research/libre', enviarJson({ consulta }))
      .then((r) => {
        setLista(r.propuestas)
        setMotivo(r.motivo_fin)
        setEstado('hecho')
      })
      .catch((e) => {
        setMotivo(String((e as Error).message))
        setEstado('error')
      })
  }, [consulta])

  const anadir = async (p: Propuesta) => {
    setAnadidas((x) => ({ ...x, [p.url]: 'añadiendo' }))
    try {
      await subirUrl(await fuenteDeBuscados(), p.url, null)
      setAnadidas((x) => ({ ...x, [p.url]: 'añadida' }))
    } catch {
      setAnadidas((x) => ({ ...x, [p.url]: 'error' }))
    }
  }

  if (estado === 'buscando') return <Pensando texto="Buscando y leyendo páginas sobre esto… (uno o dos minutos)" />
  if (estado === 'error' || !lista.length)
    return <p className="nota">No he encontrado páginas que valgan la pena{motivo ? ` (${motivo})` : ''}. Puedes subir tú un PDF con el clip.</p>
  return (
    <div className="docs-buscados">
      <p className="nota">He leído y puntuado páginas sobre esto. Añade las que quieras: se indexan solas y tus próximas preguntas las citarán.</p>
      <ul>
        {lista.map((p) => (
          <li key={p.url}>
            <a href={p.url} target="_blank" rel="noreferrer">
              {p.titulo || p.url}
            </a>
            <small>{p.motivo}</small>
            <button className="boton-mini" disabled={!!anadidas[p.url] && anadidas[p.url] !== 'error'} onClick={() => anadir(p)}>
              {anadidas[p.url] === 'añadida' ? '✓ Añadida' : anadidas[p.url] === 'añadiendo' ? 'Añadiendo…' : anadidas[p.url] === 'error' ? 'Reintentar' : 'Añadir a mis fuentes'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Acciones({ acciones }: { acciones: AccionArnes[] }) {
  const [buscando, setBuscando] = useState<string | null>(null)
  return (
    <div className="acciones-arnes">
      <div className="respuestas-rapidas">
        {acciones.map((a) => (
          <button
            key={a.etiqueta}
            type="button"
            className="opcion opcion-chip accion-arnes"
            disabled={a.tipo === 'buscar' && buscando != null}
            onClick={() => (a.tipo === 'ir' && a.ruta ? (window.location.hash = a.ruta) : setBuscando(a.consulta ?? ''))}
          >
            {a.tipo === 'buscar' ? '🔎 ' : '→ '}
            {a.etiqueta}
          </button>
        ))}
      </div>
      {buscando != null && <BuscarDocumentos consulta={buscando} />}
    </div>
  )
}
