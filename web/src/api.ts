// El único fichero de la página que sabe cómo habla la API.
// Todas las URL son relativas: el proxy (Vite, Caddy o Electron) las lleva a la API.
import { textoValidacion } from './componentes/errores.ts'

// Una petición no ha llegado al servidor: la cabecera (BarraSesion) lo comprueba ya, sin esperar a su minuto.
export const EVENTO_SIN_RESPUESTA = 'magister-sin-respuesta'
const avisarSinRespuesta = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_SIN_RESPUESTA))
}

export type Rol = 'usuario' | 'tutor'
export type Estado = 'completo' | 'interrumpido' | 'error'

export interface CitaInfo {
  fragmento_id: number
  cita_literal: string
  dudosa: boolean
}

export interface Mensaje {
  id: number
  rol: Rol
  contenido: string
  estado: Estado
  creado_en: string
  citas?: CitaInfo[]
  traza_id?: string | null
  voto?: boolean | null
  cuenta?: boolean
  // Las respuestas rápidas del diagnóstico que acompañaban a este mensaje del tutor.
  respuestas_rapidas?: { campo: string; opciones: { valor: string; etiqueta: string }[] } | null
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
  | {
      tipo: 'fin'
      mensaje_id: number | null
      ms_primer_token: number | null
      ms_total: number
      citas?: CitaInfo[]
      busqueda_id?: number | null
      sin_fuentes?: boolean
      traza_id?: string | null
      retirado?: string[]
    }
  // `ya_decidido`: aceptaste dos veces el mismo plan; la segunda no es un fallo, el plan ya estaba aceptado.
  | { tipo: 'error'; detalle: string; ya_decidido?: boolean; plan_id?: number | null }
  // Ha llegado otro turno en la misma conversación y este se ha cortado (lo ya escrito queda guardado).
  | { tipo: 'cortado'; mensaje_id: number | null; detalle?: string }
  | { tipo: 'fase'; nodo: string; detalle?: string }
  // Mientras el modelo razona sin escribir: el pulso (segundos) y, si tarda, el guion y frases para la espera.
  | { tipo: 'latido'; segundos: number }
  | { tipo: 'adelanto'; guion: string; frases: string[] }
  | ({ tipo: 'plan' } & Propuesta)
  | { tipo: 'guardado'; plan_id: number; tema_id: number }
  // «Guárdalo» en el chat: la respuesta anterior ya está en Mis notas.
  | { tipo: 'nota'; id: number; mensaje_id: number }
  // El asesor ha preparado el cambio que ofreció (o no ha podido): lo aplicas tú.
  | ({ tipo: 'cambio' } & CambioAsesor)
  // `explicado`: no es un fallo, el asesor dice por qué eso no lo puede hacer (y dónde se hace).
  | { tipo: 'cambio_fallido'; detalle: string; explicado?: boolean }
  | { tipo: 'opciones'; campo: string; opciones: { valor: string; etiqueta: string }[] }
  | { tipo: 'acciones'; acciones: { tipo: 'ir' | 'buscar'; etiqueta: string; ruta?: string; consulta?: string }[] }

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
  // Si hace falta buscar fuentes para estudiarla (ADR-0021) y por qué, en una frase. Opcional: los planes de antes no
  // lo traen y el servidor los da como «conviene».
  necesita_fuentes?: NecesitaFuentes
  fuentes_por_que?: string
}

export type NecesitaFuentes = 'no' | 'conviene' | 'imprescindible'

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
  // Ya hay un plan aceptado de este tema y aceptar este lo sustituye (null si no); lo pinta PropuestaPlan.tsx.
  sustituye?: PlanSustituido | null
}

export interface PlanSustituido {
  plan_id: number
  version: number
  tema_id: number
  tema: string
  horas_hechas: number
  lecciones: number
  // Lo que hereda el plan nuevo: sus lecciones que siguen (claves del NUEVO), las horas y las fuentes que conservan.
  conserva: { lecciones: string[]; horas_hechas: number; fuentes: number }
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
    // Los fallos de validación (422), en castellano y sin repetir.
    if (Array.isArray(j.detail)) return textoValidacion(j.detail)
  } catch {
    /* no era JSON */
  }
  return cuerpo || r.statusText
}

// Una lectura (GET) nunca se queda colgada: a los 20 s se corta, y si el servidor se está reiniciando
// (no contesta, o el proxy da 502/503) se reintenta dos veces antes de rendirse. Las escrituras no se
// reintentan (no son idempotentes) ni se cortan: algunas esperan al modelo.
const LIMITE_LECTURA_MS = 20_000
const ESPERAS_REINTENTO_MS = [800, 2000]
// Dos pantallas que piden lo mismo a la vez (Hoy y la barra de abajo piden /api/hoy) comparten la petición.
const enVuelo = new Map<string, Promise<unknown>>()

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function leerUnaVez(ruta: string, opciones: RequestInit): Promise<Response> {
  const corte = new AbortController()
  const reloj = setTimeout(() => corte.abort(new DOMException('tiempo', 'TimeoutError')), LIMITE_LECTURA_MS)
  const senal = opciones.signal ? AbortSignal.any([opciones.signal, corte.signal]) : corte.signal
  try {
    return await fetch(ruta, { ...opciones, signal: senal })
  } catch (e) {
    if (opciones.signal?.aborted) throw e
    if (corte.signal.aborted) throw new ErrorApi(0, 'El servidor tarda demasiado en contestar.')
    if (ruta !== '/api/salud') avisarSinRespuesta()
    throw new ErrorApi(0, 'No hay conexión con Magister: ¿está en marcha el servidor?')
  } finally {
    clearTimeout(reloj)
  }
}

async function leer<T>(ruta: string, opciones: RequestInit): Promise<T> {
  for (let intento = 0; ; intento++) {
    let r: Response
    try {
      r = await leerUnaVez(ruta, opciones)
    } catch (e) {
      // Sin conexión: el servidor puede estar arrancando. Un corte por tiempo no se repite (volvería a tardar).
      const reintentable = e instanceof ErrorApi && e.message.startsWith('No hay conexión')
      if (!reintentable || intento >= ESPERAS_REINTENTO_MS.length) throw e
      await espera(ESPERAS_REINTENTO_MS[intento])
      continue
    }
    if ((r.status === 502 || r.status === 503) && intento < ESPERAS_REINTENTO_MS.length) {
      await espera(ESPERAS_REINTENTO_MS[intento])
      continue
    }
    if (!r.ok) throw new ErrorApi(r.status, await detalleDe(r))
    if (r.status === 204) return undefined as T
    return (await r.json()) as T
  }
}

export async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const cabeceras: Record<string, string> = { ...(opciones.headers as Record<string, string>) }
  if (opciones.body && !(opciones.body instanceof FormData)) cabeceras['Content-Type'] = 'application/json'
  const metodo = (opciones.method ?? 'GET').toUpperCase()
  if (metodo === 'GET') {
    const comparte = !opciones.signal
    const previa = comparte ? enVuelo.get(ruta) : undefined
    if (previa) return previa as Promise<T>
    const p = leer<T>(ruta, { ...opciones, headers: cabeceras })
    if (comparte) {
      enVuelo.set(ruta, p)
      p.finally(() => enVuelo.delete(ruta)).catch(() => undefined)
    }
    return p
  }
  let r: Response
  try {
    r = await fetch(ruta, { ...opciones, headers: cabeceras })
  } catch (e) {
    if (opciones.signal?.aborted) throw e
    avisarSinRespuesta()
    throw new ErrorApi(0, 'No hay conexión con Magister: ¿está en marcha el servidor?')
  }
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
  let r: Response
  try {
    r = await fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal,
    })
  } catch (e) {
    // Parar no es un fallo; sin red, un ErrorApi con código 0 (el chat devuelve el texto a la caja).
    if (signal?.aborted) throw e
    avisarSinRespuesta()
    throw new ErrorApi(0, 'No hay conexión con Magister.')
  }
  yield* leerSSE<E>(r)
}

// v0.1: temas, conversaciones y mensajes

export const listarTemas = () => pedir<Tema[]>('/api/temas')
export const crearTema = (nombre: string) => pedir<Tema>('/api/temas', enviarJson({ nombre }))
export const listarConversaciones = () => pedir<Conversacion[]>('/api/conversaciones')
export const crearConversacion = (titulo: string, tema_id: number | null = null, tipo: 'libre' | 'plan' | 'asesor' = 'libre') =>
  pedir<Conversacion>('/api/conversaciones', enviarJson({ titulo, tema_id, tipo }))
export const borrarConversacion = (id: number) => pedir<void>(`/api/conversaciones/${id}`, { method: 'DELETE' })
export const listarMensajes = (cid: number) => pedir<Mensaje[]>(`/api/conversaciones/${cid}/mensajes`)

// Lo que puede acompañar a un mensaje: llamada de voz, modo solo para este mensaje, lección de la que se habla y contexto.
export interface ExtraMensaje {
  llamada?: boolean
  modo?: string | null
  plan_id?: number | null
  leccion_clave?: string | null
  contexto?: string | null
  // El alumno responde a algo que el tutor ha preguntado: lo corrige el modelo grande.
  corregir?: boolean
  // El asesor (la mascota flotante): contesta corto sobre la pantalla que tienes abierta.
  asesor?: boolean
  // El proyecto que tienes en pantalla: el asesor prepara sobre él los cambios que ofrece.
  proyecto_id?: number | null
  // El plan activo de la app (Roadmap, Calendario, Hoy): el asesor mueve sus sesiones y marca o prepara sus lecciones.
  plan_activo_id?: number | null
}

// Un cambio que propone el asesor. Las líneas las escribe el código del servidor, no el modelo; nada cambia hasta
// que pulsas «Aplicar», y lo aplicado se puede deshacer.
export interface CambioAsesor {
  id: number
  estado: 'propuesta' | 'aplicada' | 'descartada' | 'deshecha' | 'caducada'
  resumen: string
  // Lo que hace el cambio en una frase, para la cabeza de la tarjeta.
  en_breve?: string
  lineas: { texto: string; motivo: string }[]
  mensaje_id: number | null
  proyecto_id: number | null
  motivo_estado: string | null
  creado_en: string
  // Lo que miró antes de proponer («tus notas sobre «moto»») y, ya aplicado, los pasos nuevos.
  consultado: string[]
  nuevos: string[]
  // Lo que pedías y se queda fuera de este cambio, con qué hacer.
  pendiente: string | null
  // El plan que toca (sus pantallas se recargan al aplicarlo) y si «Deshacer» deshace algo (preparar apuntes, no).
  plan_id?: number | null
  deshacible?: boolean
}
// Una línea de la tarjeta; `deshace: false` si «Deshacer» no la deshace.
export type LineaCambio = { texto: string; motivo: string; deshace?: boolean }

// Lo que viaja en EVENTO_CAMBIO_APLICADO: qué proyecto ha cambiado y qué pasos enseñar.
export interface CambioAplicado {
  proyecto_id: number | null
  nuevos: string[]
  // Y qué plan (Calendario, Roadmap y Hoy recargan sus datos).
  plan_id?: number | null
}

export const cambiosDe = (cid: number) => pedir<CambioAsesor[]>(`/api/conversaciones/${cid}/cambios`)
export const decidirCambio = (id: number, que: 'aplicar' | 'descartar' | 'deshacer') =>
  pedir<CambioAsesor>(`/api/cambios/${id}/${que}`, { method: 'POST' })
// Avisa a las pantallas abiertas (el proyecto, su diario) de que el asesor ha cambiado algo.
export const EVENTO_CAMBIO_APLICADO = 'magister-cambio-aplicado'

export function enviar(cid: number, contenido: string, signal: AbortSignal, cuenta = true, voz = false, extra: ExtraMensaje = {}) {
  return flujo<EventoTutor>(`/api/conversaciones/${cid}/mensajes`, { contenido, cuenta, voz, ...extra }, signal)
}

// v0.2: el plan

export const propuestaPendiente = (cid: number) => pedir<Propuesta | null>(`/api/conversaciones/${cid}/propuesta`)

export function decidir(cid: number, accion: 'aceptar' | 'cambiar' | 'descartar', texto: string | null, signal: AbortSignal) {
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
  fuentes: number
  sin_material: boolean
  // La pequeña biblioteca de la lección: lo que el research trajo para ella y lo que falta. Opcional: un servidor de
  // antes no lo manda.
  biblioteca?: BibliotecaLeccion
  // Con qué se hicieron los apuntes frente a las fuentes de ahora; null si aún no hay apuntes.
  apuntes_fuentes?: 'sin_fuentes' | 'nuevas' | 'al_dia' | 'desconocido' | null
  // Hay material tuyo de este tema: manda sobre la etiqueta (nunca sale «no»).
  material_propio?: boolean
  // La etiqueta guardada (la del plan o la tuya); `necesita_fuentes` es la que se usa. Difieren si tu material manda.
  necesita_fuentes_guardada?: NecesitaFuentes | null
  // Por qué el research automático la investiga sola o no (servidor: plan/horizonte.py). Opcional: un servidor de
  // antes no lo manda.
  research_auto?: { motivo: 'no' | 'sin_juzgar' | 'imprescindible' | 'falta' | 'sugerencia'; texto: string }
}

export interface FuenteDeLeccion {
  propuesta_id: number
  titulo: string
  url: string
  dominio: string
  tipo: string | null
  // Objetivos que cubre, desde 1 (de la ficha del juez; vacío en las propuestas de antes de la ficha).
  cubre: number[]
  resumen: string | null
  estado: 'lista' | 'indexando' | 'problema' | 'propuesta'
  version_id: number | null
  documento_id: number | null
  fuente_id: number | null
  fragmentos: number
  // Entró a medias (un muro de pago, solo el resumen): el motivo.
  incompleta?: string | null
}

export interface BibliotecaLeccion {
  fuentes: FuenteDeLeccion[]
  // Objetivos (desde 1) sin ninguna fuente.
  sin_fuente: number[]
  research: 'sin_lanzar' | 'buscando' | 'acabada' | 'cortada'
  // false: las fuentes de antes de la ficha del juez no dicen qué objetivos cubren.
  cobertura_conocida: boolean
}

// Un examen del plan: sale del calendario (un parcial cada pocas lecciones y un final).
export interface HitoExamen {
  id: string
  titulo: string
  fecha: string
  lecciones: string[]
  final: boolean
  preguntas: number
  minutos: number
  hecho: boolean
  nota: number | null
  tema?: string
  tema_id?: number
  plan_id?: number
}

// La ruta que abre Examen con ese examen ya preparado.
export const rutaExamen = (planId: number, h: HitoExamen) => `#/examen/${planId}/${h.lecciones.join(',')}/${h.preguntas}/${h.minutos}`

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
  examenes: HitoExamen[]
  perfil?: { horas_por_dia?: number[] | null; inicio_por_dia?: (string | null)[] | null }
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
  return pedir<{ fecha: string; sesiones: SesionVista[]; examenes?: HitoExamen[] }[]>(`/api/calendario?${q}`)
}

export const hoyIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// v0.3: fuentes, búsqueda, citas y research

export interface Fuente {
  id: number
  nombre: string
  tipo: 'vault' | 'pdf' | 'libro' | 'web' | 'audio'
  confianza: number
}

export interface VersionInfo {
  id: number
  estado: 'recibida' | 'pendiente' | 'lista' | 'cuarentena' | 'retirada'
  motivo: string | null
  extractor: string | null
  duplicado_de: number | null
  ingerida_en: string | null
  // De dónde vino: «research» si lo propuso la búsqueda de una lección (y si entró solo), null si lo subiste tú.
  origen?: 'research' | null
  automatica?: boolean
  leccion_clave?: string | null
  // Entró a medias (un muro de pago, solo el resumen): el motivo. Puede no venir.
  incompleta?: string | null
}

export interface DocumentoInfo {
  id: number
  titulo: string
  uri: string
  tema_id: number | null
  version: VersionInfo | null
  fragmentos: number
  incompleta?: string | null
  // Qué pasó, en claro, y si «Reintentar» puede servir (un fichero vacío o con otra extensión, no).
  que_paso?: string | null
  reintentable?: boolean
}

export interface FragmentoInfo {
  id: number
  texto: string
  antes: string
  despues: string
  documento: { id: number; titulo: string; uri: string }
  fuente: Fuente
  version: VersionInfo
}

export interface PropuestaInfo {
  id: number
  url: string
  titulo: string | null
  plan_id: number
  leccion_clave: string
  motivo: string
  estado: string
  creada_en: string
}

export const listarFuentes = () => pedir<Fuente[]>('/api/fuentes')
export const crearFuente = (nombre: string, tipo: Fuente['tipo'], confianza: number) =>
  pedir<Fuente>('/api/fuentes', enviarJson({ nombre, tipo, confianza }))
export const listarDocumentos = (fid: number) => pedir<DocumentoInfo[]>(`/api/fuentes/${fid}/documentos`)
export const verFragmento = (id: number) => pedir<FragmentoInfo>(`/api/fragmentos/${id}`)
export const estadoIndice = () =>
  pedir<{ fuentes: number; documentos: number; versiones_listas: number; fragmentos: number }>('/api/fuentes/estado')

export function subirFichero(fid: number, fichero: File, temaId: number | null) {
  const datos = new FormData()
  datos.append('fichero', fichero)
  if (temaId != null) datos.append('tema_id', String(temaId))
  return pedir<{ version_id: number }>(`/api/fuentes/${fid}/documentos`, { method: 'POST', body: datos })
}

export const subirUrl = (fid: number, url: string, tema_id: number | null) =>
  pedir<{ version_id: number }>(`/api/fuentes/${fid}/documentos`, enviarJson({ url, tema_id }))

// `objetivos` (desde 1): buscar solo para esos objetivos de la lección (vale con una sola lección).
// `forzar`: buscar aunque la lección esté marcada «no» (los botones de una lección lo mandan; un lote, nunca).
export const lanzarResearch = (plan_id: number, leccion_claves: string[], extra: { objetivos?: number[]; forzar?: boolean } = {}) =>
  // `saltadas`: las que el plan marca «no necesita fuentes» (no se buscan en un lote); `aviso` lo dice en una frase.
  pedir<{ tareas: number[]; saltadas?: string[]; aviso?: string | null }>('/api/research', enviarJson({ plan_id, leccion_claves, ...extra }))
export const verResearch = (id: number) =>
  pedir<{
    estado: string
    leccion_clave: string
    motivo_fin: string | null
    pasos: number
    paso_actual: Record<string, unknown> | null
    incorporar?: boolean
  }>(`/api/research/${id}`)

// Incorporar en bloque: las propuestas pendientes entran en tus fuentes por la cola, sin modelo.
export interface Incorporacion {
  trabajo_id: number
  estado: 'pendiente' | 'en_curso' | 'hecho' | 'fallido' | 'cancelado'
  error: string | null
  total: number
  van: number
  entradas: number
  fallidas: { propuesta_id: number; url: string; titulo: string | null; leccion_clave: string; motivo: string }[]
  automatica: boolean
  acabado_en: string | null
}
export const incorporarPropuestas = (filtro: { plan_id?: number; leccion_clave?: string } = {}) =>
  pedir<{ trabajo_id: number | null; total: number; ya_en_marcha: boolean }>('/api/incorporar', enviarJson(filtro))
export const verIncorporacion = (tid: number) => pedir<Incorporacion>(`/api/incorporar/${tid}`)
export const ultimaIncorporacion = () => pedir<{ ultimo: Incorporacion | null; solas: boolean }>('/api/incorporar/ultimo')
export const cancelarTrabajo = (tid: number) => pedir<{ cancelado: boolean }>(`/api/trabajos/${tid}/cancelar`, { method: 'POST' })

// Lo que se queda a medias en tus fuentes, de un vistazo.
export interface DocumentoResumen {
  documento_id: number
  titulo: string
  uri: string
  fuente_id: number
  fuente: string
  version_id: number
  estado: VersionInfo['estado']
  motivo: string | null
  fragmentos: number
  origen: 'research' | null
  automatica?: boolean
  leccion_clave?: string | null
  que_paso: string | null
  reintentable: boolean
  tema_id?: number | null
  tema?: string | null
  incompleta?: string | null
}
export interface ResumenFuentes {
  listos: number
  indexando: number
  con_problema: number
  problemas: DocumentoResumen[]
  del_research: DocumentoResumen[]
  // Lo que entró a medias (un artículo con muro de pago del que solo se ve el resumen). Puede no venir.
  incompletas?: DocumentoResumen[]
}
export const resumenFuentes = () => pedir<ResumenFuentes>('/api/fuentes/resumen')
export const reintentarVersion = (vid: number) =>
  pedir<{ version_id: number; estado: string }>(`/api/versiones/${vid}/reintentar`, { method: 'POST' })
export const listarPropuestas = () => pedir<PropuestaInfo[]>('/api/propuestas?estado=pendiente')
export const decidirPropuesta = (id: number, accion: 'aprobar' | 'rechazar') =>
  pedir<{ estado: string }>(`/api/propuestas/${id}`, enviarJson({ accion }))

// Mis notas: lo que guardas de Estudio libre (una respuesta entera o un trozo marcado).
export interface Nota {
  id: number
  texto: string
  comentario: string | null
  mensaje_id: number | null
  conversacion_id: number | null
  origen: string | null
  completa: boolean
  creada_en: string
}
export const EVENTO_NOTAS = 'magister-notas'
export const listarNotas = () => pedir<Nota[]>('/api/notas')
export const guardarNota = (d: { texto: string; mensaje_id?: number | null; completa?: boolean; comentario?: string | null }) =>
  pedir<Nota>('/api/notas', enviarJson(d))
export const comentarNota = (id: number, comentario: string | null) =>
  pedir<Nota>(`/api/notas/${id}`, enviarJson({ comentario }, 'PATCH'))
export const borrarNota = (id: number) => pedir<void>(`/api/notas/${id}`, { method: 'DELETE' })

// Tus datos (Ajustes): descargarlos todos en un ZIP y las copias de seguridad de la base.
export interface CopiaBase {
  id: string
  carpeta: string
  nombre: string
  dia: string | null
  bytes: number
  fecha: string
}
// Sin el corte de 20 s de las lecturas: preparar el ZIP con tus ficheros puede tardar.
export async function descargarMisDatos(): Promise<{ datos: Blob; cabecera: string | null }> {
  let r: Response
  try {
    r = await fetch('/api/datos/exportar')
  } catch {
    throw new ErrorApi(0, 'No hay conexión con Magister: ¿está en marcha el servidor?')
  }
  if (!r.ok) throw new ErrorApi(r.status, await detalleDe(r))
  return { datos: await r.blob(), cabecera: r.headers.get('Content-Disposition') }
}
export const listarCopias = () => pedir<{ copias: CopiaBase[]; ocupado: boolean }>('/api/datos/copias')
export const hacerCopia = () => pedir<CopiaBase>('/api/datos/copias', { method: 'POST' })
export const restaurarCopia = (copia: string, confirmacion: string) =>
  pedir<{ copia_previa: string; restaurada: string }>('/api/datos/copias/restaurar', enviarJson({ copia, confirmacion }))
