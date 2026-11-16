import { useCallback, useEffect, useState } from 'react'
import { crearFuente, listarDocumentos, listarFuentes, subirFichero } from '../api.ts'

// Adjuntar en Estudio libre: el fichero entra en la fuente «Adjuntos del chat», se indexa
// y desde ese momento el tutor lo usa y lo cita como el resto de tus fuentes.

export interface Adjunto {
  nombre: string
  version_id: number | null
  estado: 'subiendo' | 'indexando' | 'listo' | 'error'
  detalle?: string
}

const FUENTE = 'Adjuntos del chat'
export const ACEPTA = '.pdf,.md,.markdown,.txt,.html,.htm'

async function fuenteDeAdjuntos(): Promise<number> {
  const fs = await listarFuentes()
  const f = fs.find((x) => x.nombre === FUENTE) ?? (await crearFuente(FUENTE, 'pdf', 3))
  return f.id
}

export function usarAdjuntos(temaId: number | null = null) {
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([])
  const [fuente, setFuente] = useState<number | null>(null)

  const subir = useCallback(
    async (ficheros: File[]) => {
      if (!ficheros.length) return
      setAdjuntos((a) => [...a, ...ficheros.map((f) => ({ nombre: f.name, version_id: null, estado: 'subiendo' as const }))])
      try {
        const fid = fuente ?? (await fuenteDeAdjuntos())
        setFuente(fid)
        await Promise.all(
          ficheros.map(async (f) => {
            try {
              const r = await subirFichero(fid, f, temaId)
              setAdjuntos((a) => a.map((x) => (x.nombre === f.name && x.estado === 'subiendo' ? { ...x, version_id: r.version_id, estado: 'indexando' } : x)))
            } catch (e) {
              setAdjuntos((a) =>
                a.map((x) => (x.nombre === f.name && x.estado === 'subiendo' ? { ...x, estado: 'error', detalle: String((e as Error).message) } : x)),
              )
            }
          }),
        )
      } catch (e) {
        setAdjuntos((a) => a.map((x) => (x.estado === 'subiendo' ? { ...x, estado: 'error', detalle: String((e as Error).message) } : x)))
      }
    },
    [fuente, temaId],
  )

  // Mientras alguno se esté indexando, se mira cada pocos segundos.
  useEffect(() => {
    if (fuente == null || !adjuntos.some((a) => a.estado === 'indexando')) return
    const t = setInterval(async () => {
      const docs = await listarDocumentos(fuente)
      setAdjuntos((a) =>
        a.map((x) => {
          const d = docs.find((y) => y.version?.id === x.version_id)
          if (!d?.version || x.estado !== 'indexando') return x
          if (d.version.estado === 'lista') return { ...x, estado: 'listo' }
          if (d.version.estado === 'cuarentena' || d.version.estado === 'retirada')
            return { ...x, estado: 'error', detalle: d.version.motivo ?? 'No se pudo leer' }
          return x
        }),
      )
    }, 2500)
    return () => clearInterval(t)
  }, [fuente, adjuntos])

  const quitar = (nombre: string) => setAdjuntos((a) => a.filter((x) => x.nombre !== nombre))
  return { adjuntos, subir, quitar }
}
