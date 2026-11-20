// La parte pura de adjuntar en Estudio libre: qué ficheros se aceptan y por qué se rechaza cada otro. Así un clic que
// no puede adjuntar lo dice con palabras, nunca se queda en silencio.

export const EXTENSIONES = ['.pdf', '.md', '.markdown', '.txt', '.html', '.htm']
export const MAX_BYTES = 50 * 1024 * 1024 // el servidor corta a los 50 MB (rutas_fuentes.py)

export interface Candidato {
  name: string
  size: number
}
export interface YaAdjunto {
  nombre: string
  tamano: number
  estado: 'subiendo' | 'indexando' | 'listo' | 'error'
}
export type Motivo = 'tipo' | 'repetido' | 'vacio' | 'grande'
export interface Rechazo {
  nombre: string
  motivo: Motivo
}

const extension = (nombre: string) => {
  const i = nombre.lastIndexOf('.')
  return i < 0 ? '' : nombre.slice(i).toLowerCase()
}

// Un fichero igual (mismo nombre y tamaño) que otro ya adjuntado y sin fallo no se vuelve a subir; uno que falló sí.
export function clasificar<T extends Candidato>(ficheros: T[], ya: YaAdjunto[]): { aceptados: T[]; rechazados: Rechazo[] } {
  const aceptados: T[] = []
  const rechazados: Rechazo[] = []
  const vistos = new Set(ya.filter((a) => a.estado !== 'error').map((a) => `${a.nombre}|${a.tamano}`))
  for (const f of ficheros) {
    const clave = `${f.name}|${f.size}`
    if (!EXTENSIONES.includes(extension(f.name))) rechazados.push({ nombre: f.name, motivo: 'tipo' })
    else if (f.size <= 0) rechazados.push({ nombre: f.name, motivo: 'vacio' })
    else if (f.size > MAX_BYTES) rechazados.push({ nombre: f.name, motivo: 'grande' })
    else if (vistos.has(clave)) rechazados.push({ nombre: f.name, motivo: 'repetido' })
    else {
      vistos.add(clave)
      aceptados.push(f)
    }
  }
  return { aceptados, rechazados }
}

// Los adjuntos que ya pueden viajar con el mensaje: los listos y los que aún se leen (el servidor los espera).
export const paraEnviar = <A extends { estado: string; version_id: number | null }>(adjuntos: A[]): number[] =>
  [...new Set(adjuntos.filter((a) => (a.estado === 'listo' || a.estado === 'indexando') && a.version_id != null).map((a) => a.version_id as number))]
