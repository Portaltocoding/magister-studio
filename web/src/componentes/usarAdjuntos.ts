import { useCallback, useEffect, useState } from 'react'
import { crearFuente, listarDocumentos, listarFuentes, pedir, subirFichero, type VersionInfo } from '../api.ts'

const verVersion = (vid: number) => pedir<VersionInfo & { fragmentos: number }>(`/api/versiones/${vid}`)

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

  // Mientras alguno se esté indexando, se mira cada pocos segundos el estado de su versión.
  useEffect(() => {
    const ids = [...new Set(adjuntos.filter((a) => a.estado === 'indexando' && a.version_id != null).map((a) => a.version_id as number))]
    if (!ids.length) return
    const t = setInterval(async () => {
      const versiones = new Map<number, VersionInfo>()
      await Promise.all(
        ids.map((vid) =>
          verVersion(vid)
            .then((v) => versiones.set(vid, v))
            .catch(() => undefined),
        ),
      )
      // Volver a adjuntar un fichero que ya tenías deja su versión «retirada · sin cambios»: lo que vale es la
      // versión que ya tenía el documento (lista, en cuarentena o aún indexándose).
      const repetida = [...versiones.values()].some((v) => v.estado === 'retirada' && v.motivo === 'sin cambios')
      const docs = repetida && fuente != null ? await listarDocumentos(fuente).catch(() => []) : []
      setAdjuntos((a) =>
        a.map((x) => {
          let v = x.version_id != null ? versiones.get(x.version_id) : undefined
          if (!v || x.estado !== 'indexando') return x
          if (v.estado === 'retirada' && v.motivo === 'sin cambios') {
            v = docs.find((d) => d.uri === `subida/${x.nombre}`)?.version ?? undefined
            if (!v) return x
          }
          if (v.estado === 'lista') return { ...x, estado: 'listo' }
          if (v.estado === 'cuarentena' || v.estado === 'retirada')
            return { ...x, estado: 'error', detalle: v.motivo ?? 'No se pudo leer' }
          return x
        }),
      )
    }, 2500)
    return () => clearInterval(t)
  }, [fuente, adjuntos])

  const quitar = (nombre: string) => setAdjuntos((a) => a.filter((x) => x.nombre !== nombre))
  return { adjuntos, subir, quitar }
}
