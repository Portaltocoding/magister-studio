import { useCallback, useEffect, useRef, useState } from 'react'
import { t, type Clave } from '../i18n/i18n.ts'
import { clasificar, type Rechazo } from './adjuntosPuro.ts'
import { crearFuente, listarDocumentos, listarFuentes, pedir, subirFichero, type VersionInfo } from '../api.ts'

const verVersion = (vid: number) => pedir<VersionInfo & { fragmentos: number }>(`/api/versiones/${vid}`)

// Adjuntar en Estudio libre: el fichero entra en la fuente «Adjuntos del chat», se indexa
// y desde ese momento el tutor lo usa y lo cita como el resto de tus fuentes.

export interface Adjunto {
  id: number // cada adjunto tiene el suyo: el mismo fichero dos veces, o dos con el mismo nombre, no se pisan
  nombre: string
  tamano: number
  version_id: number | null
  estado: 'subiendo' | 'indexando' | 'listo' | 'error'
  detalle?: string
}

const FUENTE = 'Adjuntos del chat'
export const ACEPTA = '.pdf,.md,.markdown,.txt,.html,.htm'
let contador = 0

// Lo que se dice cuando un fichero no se puede adjuntar (nunca en silencio).
export function avisoDeRechazos(rs: Rechazo[]): string | null {
  if (!rs.length) return null
  return rs.map((r) => t(`hilo.adj.no.${r.motivo}` as Clave, { nombre: r.nombre })).join(' ')
}

async function fuenteDeAdjuntos(): Promise<number> {
  const fs = await listarFuentes()
  const f = fs.find((x) => x.nombre === FUENTE) ?? (await crearFuente(FUENTE, 'pdf', 3))
  return f.id
}

export function usarAdjuntos(temaId: number | null = null) {
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([])
  const [fuente, setFuente] = useState<number | null>(null)

  const [aviso, setAviso] = useState<string | null>(null)
  // Lo último que se ve de la lista: `subir` no depende de ella para no quedarse con una copia vieja.
  const actuales = useRef<Adjunto[]>([])
  actuales.current = adjuntos

  const subir = useCallback(
    async (ficheros: File[]) => {
      if (!ficheros.length) return
      const { aceptados, rechazados } = clasificar(ficheros, actuales.current.map((a) => ({ nombre: a.nombre, tamano: a.tamano, estado: a.estado })))
      setAviso(avisoDeRechazos(rechazados))
      if (!aceptados.length) return
      const nuevos = aceptados.map((f) => ({ f, id: ++contador }))
      setAdjuntos((a) => [...a, ...nuevos.map(({ f, id }) => ({ id, nombre: f.name, tamano: f.size, version_id: null, estado: 'subiendo' as const }))])
      const cambiar = (id: number, cambio: Partial<Adjunto>) => setAdjuntos((a) => a.map((x) => (x.id === id ? { ...x, ...cambio } : x)))
      try {
        const fid = fuente ?? (await fuenteDeAdjuntos())
        setFuente(fid)
        await Promise.all(
          nuevos.map(async ({ f, id }) => {
            try {
              const r = await subirFichero(fid, f, temaId)
              cambiar(id, { version_id: r.version_id, estado: 'indexando' })
            } catch (e) {
              cambiar(id, { estado: 'error', detalle: String((e as Error).message) })
            }
          }),
        )
      } catch (e) {
        for (const { id } of nuevos) cambiar(id, { estado: 'error', detalle: String((e as Error).message) })
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
            x = { ...x, version_id: v.id } // la que sigue viva: es la que ve el tutor
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

  const quitar = (id: number) => setAdjuntos((a) => a.filter((x) => x.id !== id))
  // Tras enviar: la caja queda limpia; la conversación ya los recuerda en el servidor.
  const vaciar = useCallback(() => {
    setAdjuntos((a) => a.filter((x) => x.estado === 'subiendo'))
    setAviso(null)
  }, [])
  return { adjuntos, subir, quitar, vaciar, aviso, avisar: setAviso }
}
