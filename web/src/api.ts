// El único fichero de la página que sabe cómo habla la API.
// Todas las URL son relativas: el proxy (Vite, Caddy o Electron) las lleva a la API.

export type Rol = 'usuario' | 'tutor'
export type Estado = 'completo' | 'interrumpido' | 'error'

export interface Mensaje {
  id: number
  rol: Rol
  contenido: string
  estado: Estado
  creado_en: string
}

export interface Conversacion {
  id: number
  titulo: string
  tema_id: number | null
  tipo: 'libre' | 'plan' | 'tutor'
  creada_en: string
  actualizada_en: string
}

export interface Tema {
  id: number
  nombre: string
}

export type EventoTutor =
  | { tipo: 'inicio'; conversacion_id: number | null }
  | { tipo: 'delta'; t: string }
  | { tipo: 'fin'; mensaje_id: number | null; ms_primer_token: number | null; ms_total: number }
  | { tipo: 'error'; detalle: string }
  | { tipo: 'fase'; nodo: string }
  | ({ tipo: 'plan' } & Propuesta)

export interface ConceptoPlan {
  id: string
  nombre: string
}

export interface LeccionPlan {
  clave: string
  titulo: string
  objetivos: string[]
  conceptos: ConceptoPlan[]
  horas: number
  depende_de: string[]
}

export interface SesionPlan {
  fecha: string
  inicio: string | null
  clave: string
  horas: number
}

export interface Propuesta {
  tema: string | null
  razonamiento: string
  lecciones: LeccionPlan[]
  total_horas: number
  capacidad_horas: number
  sesiones: SesionPlan[]
  fin: string | null
}

export class ErrorApi extends Error {
  codigo: number
  constructor(codigo: number, detalle: string) {
    super(detalle)
    this.codigo = codigo
  }
}

async function detalleDe(r: Response): Promise<string> {
  const cuerpo = await r.text()
  try {
    const j = JSON.parse(cuerpo)
    if (typeof j.detail === 'string') return j.detail
    if (Array.isArray(j.detail)) return j.detail.map((d: { msg: string }) => d.msg).join('; ')
  } catch {
    /* no era JSON */
  }
  return cuerpo || r.statusText
}

export async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const cabeceras: Record<string, string> = { ...(opciones.headers as Record<string, string>) }
  if (opciones.body && !(opciones.body instanceof FormData)) cabeceras['Content-Type'] = 'application/json'
  const r = await fetch(ruta, { ...opciones, headers: cabeceras })
  if (!r.ok) throw new ErrorApi(r.status, await detalleDe(r))
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
}

export const enviarJson = (datos: unknown, metodo = 'POST'): RequestInit => ({
  method: metodo,
  body: JSON.stringify(datos),
})

// Lee un flujo SSE: corta por línea en blanco y entrega {tipo, ...datos}.
// TextDecoderStream no rompe las tildes partidas entre bloques; el resto del búfer
// se guarda para la vuelta siguiente.
export async function* leerSSE<E extends { tipo: string }>(r: Response): AsyncGenerator<E> {
  if (!r.ok) throw new ErrorApi(r.status, await detalleDe(r))
  if (!r.body) return
  const lector = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let bufer = ''
  for (;;) {
    const { value, done } = await lector.read()
    if (done) break
    bufer += value.replace(/\r\n/g, '\n')
    let corte: number
    while ((corte = bufer.indexOf('\n\n')) >= 0) {
      const bloque = bufer.slice(0, corte)
      bufer = bufer.slice(corte + 2)
      let nombre = 'message'
      const datos: string[] = []
      for (const linea of bloque.split('\n')) {
        if (linea.startsWith('event:')) nombre = linea.slice(6).trim()
        else if (linea.startsWith('data:')) datos.push(linea.slice(5).trimStart())
      }
      if (!datos.length) continue
      yield { tipo: nombre, ...JSON.parse(datos.join('\n')) } as E
    }
  }
}

export async function* flujo<E extends { tipo: string }>(
  ruta: string,
  cuerpo: unknown,
  signal?: AbortSignal,
): AsyncGenerator<E> {
  const r = await fetch(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal,
  })
  yield* leerSSE<E>(r)
}

// v0.1: temas, conversaciones y mensajes

export const listarTemas = () => pedir<Tema[]>('/api/temas')
export const crearTema = (nombre: string) => pedir<Tema>('/api/temas', enviarJson({ nombre }))
export const listarConversaciones = () => pedir<Conversacion[]>('/api/conversaciones')
export const crearConversacion = (titulo: string, tema_id: number | null = null, tipo: 'libre' | 'plan' = 'libre') =>
  pedir<Conversacion>('/api/conversaciones', enviarJson({ titulo, tema_id, tipo }))
export const borrarConversacion = (id: number) => pedir<void>(`/api/conversaciones/${id}`, { method: 'DELETE' })
export const listarMensajes = (cid: number) => pedir<Mensaje[]>(`/api/conversaciones/${cid}/mensajes`)

export function enviar(cid: number, contenido: string, signal: AbortSignal, cuenta = true) {
  return flujo<EventoTutor>(`/api/conversaciones/${cid}/mensajes`, { contenido, cuenta }, signal)
}

// v0.2: el plan

export const propuestaPendiente = (cid: number) => pedir<Propuesta | null>(`/api/conversaciones/${cid}/propuesta`)

export function decidir(cid: number, accion: 'aceptar' | 'cambiar', texto: string | null, signal: AbortSignal) {
  return flujo<EventoTutor>(`/api/conversaciones/${cid}/plan/decision`, { accion, texto }, signal)
}

export interface SesionVista {
  id: number
  clave: string
  titulo: string
  inicio: string | null
  horas: number
  estado: 'pendiente' | 'hecha' | 'saltada'
  tema?: string
  tema_id?: number
}

export interface LeccionVista extends LeccionPlan {
  horas_hechas: number
  estado: 'pendiente' | 'empezada' | 'hecha'
}

export interface VistaPlan {
  plan_id: number
  tema_id: number
  version: number
  razonamiento: string
  total_horas: number
  horas_hechas: number
  progreso: number
  lecciones: LeccionVista[]
  semanas: { lunes: string; dias: { fecha: string; hoy: boolean; sesiones: SesionVista[] }[] }[]
  fin: string | null
  hoy: string
}

export interface ResumenPlan {
  plan_id: number
  tema_id: number
  tema: string
  version: number
  lecciones: number
  total_horas: number
  horas_hechas: number
  progreso: number
  fin: string | null
}

export const listarPlanes = () => pedir<ResumenPlan[]>('/api/planes')
export const verPlan = (temaId: number) => pedir<VistaPlan>(`/api/temas/${temaId}/plan`)
export const recalcularPlan = (temaId: number, desde: string) =>
  pedir<VistaPlan>(`/api/temas/${temaId}/plan/recalcular`, enviarJson({ desde }))
export const marcarSesion = (id: number, estado: SesionVista['estado']) =>
  pedir<{ id: number; estado: string }>(`/api/sesiones/${id}`, enviarJson({ estado }, 'PATCH'))
export const verCalendario = (desde?: string, hasta?: string) => {
  const q = new URLSearchParams()
  if (desde) q.set('desde', desde)
  if (hasta) q.set('hasta', hasta)
  return pedir<{ fecha: string; sesiones: SesionVista[] }[]>(`/api/calendario?${q}`)
}

export const hoyIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
