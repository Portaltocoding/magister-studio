import { useCallback, useRef, useState } from 'react'
import { ErrorApi, EVENTO_NOTAS, type EventoTutor, type Mensaje, type Propuesta } from '../api.ts'
import type { Burbuja } from './Hilo.tsx'

let contador = 0
const claveNueva = () => `tmp-${++contador}`

export const aBurbuja = (m: Mensaje): Burbuja => ({
  clave: `m-${m.id}`,
  rol: m.rol,
  contenido: m.contenido,
  estado: m.estado,
  citas: m.citas,
  traza: m.traza_id ?? undefined,
  voto: m.voto ?? null,
  noCuenta: m.cuenta === false,
})

export const NOMBRE_FASE: Record<string, string> = {
  extraer: 'Entendiendo lo que quieres',
  a_diagnostico: 'Pasando a preparar tu plan',
  preguntar: 'Pensando la siguiente pregunta',
  planificar: 'Preparando el plan',
  calendarizar: 'Montando el calendario',
  negociar: 'Viendo si cabe',
  explicar_fallo: 'Revisando el plan',
  guardar: 'Guardando',
  buscar: 'Buscando en tus fuentes',
  recuperar: 'Buscando en tus fuentes',
  reescribir: 'Entendiendo tu pregunta',
  responder: 'Preparando la respuesta',
  aclarar: 'Pensando qué preguntarte',
  preparar: 'Preparando la lección',
  comprobar: 'Comprobando tu respuesta',
  corregir: 'Corrigiendo',
}

type AbrirFlujo = (texto: string, signal: AbortSignal) => AsyncIterable<EventoTutor>

// Estado de un hilo que se alimenta de un flujo SSE del tutor.
export function usarConversacion(
  abrirFlujo: AbrirFlujo,
  alPlan?: (p: Propuesta) => void,
  alGuardado?: (plan_id: number, tema_id: number) => void,
) {
  const [burbujas, setBurbujas] = useState<Burbuja[]>([])
  const [escribiendo, setEscribiendo] = useState(false)
  const [fase, setFase] = useState<string | null>(null)
  const [opciones, setOpciones] = useState<{ valor: string; etiqueta: string }[]>([])
  const control = useRef<AbortController | null>(null)

  const actualizarUltima = (cambio: (b: Burbuja) => Burbuja) =>
    setBurbujas((previas) => (previas.length ? [...previas.slice(0, -1), cambio(previas[previas.length - 1])] : previas))

  // `propia` es el texto que se pinta como mensaje del alumno (null si no hay, como al aceptar un plan).
  const correr = useCallback(
    async (propia: string | null, flujo: (signal: AbortSignal) => AsyncIterable<EventoTutor>, alAcabar?: () => void) => {
      const nuevas: Burbuja[] = []
      if (propia !== null) nuevas.push({ clave: claveNueva(), rol: 'usuario', contenido: propia, estado: 'completo' })
      nuevas.push({ clave: claveNueva(), rol: 'tutor', contenido: '', estado: 'llegando' })
      setBurbujas((previas) => [...previas, ...nuevas])
      setEscribiendo(true)
      setOpciones([])
      const c = new AbortController()
      control.current = c
      let empezo = false
      try {
        for await (const ev of flujo(c.signal)) {
          empezo = true
          switch (ev.tipo) {
            case 'delta':
              setFase(null)
              actualizarUltima((b) => ({ ...b, contenido: b.contenido + ev.t }))
              break
            case 'fase':
              setFase(NOMBRE_FASE[ev.nodo] ?? ev.nodo)
              break
            case 'plan':
              alPlan?.(ev)
              break
            case 'opciones':
              setOpciones(ev.opciones)
              break
            case 'acciones':
              actualizarUltima((b) => ({ ...b, acciones: ev.acciones }))
              break
            case 'nota':
              actualizarUltima((b) => ({ ...b, notaGuardada: true }))
              window.dispatchEvent(new Event(EVENTO_NOTAS))
              break
            case 'guardado':
              alGuardado?.(ev.plan_id, ev.tema_id)
              break
            case 'fin':
              actualizarUltima((b) => ({
                ...b,
                clave: ev.mensaje_id ? `m-${ev.mensaje_id}` : b.clave,
                estado: 'completo',
                tiempos: { primero: ev.ms_primer_token, total: ev.ms_total },
                citas: ev.citas,
                traza: ev.traza_id ?? undefined,
                sinFuentes: ev.sin_fuentes ?? undefined,
              }))
              break
            case 'error':
              actualizarUltima((b) => ({ ...b, contenido: ev.detalle, estado: 'error' }))
              break
            default:
              break // un evento desconocido no rompe el cliente
          }
        }
        // Sin texto (por ejemplo, solo se propuso un plan): se quita la burbuja vacía.
        setBurbujas((previas) => {
          const u = previas[previas.length - 1]
          return u && u.rol === 'tutor' && !u.contenido && u.estado !== 'error' ? previas.slice(0, -1) : previas
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          actualizarUltima((b) => ({ ...b, estado: 'interrumpido' }))
        } else if (!empezo && e instanceof ErrorApi) {
          setBurbujas((previas) => [
            ...previas.slice(0, -nuevas.length),
            { clave: claveNueva(), rol: 'tutor', contenido: `No se pudo enviar: ${e.message}`, estado: 'error' },
          ])
        } else {
          actualizarUltima((b) => ({ ...b, contenido: String(e), estado: 'error' }))
        }
      } finally {
        setEscribiendo(false)
        setFase(null)
        control.current = null
        alAcabar?.()
      }
    },
    [alPlan, alGuardado],
  )

  const enviar = useCallback(
    (texto: string, alAcabar?: () => void) => correr(texto, (signal) => abrirFlujo(texto, signal), alAcabar),
    [abrirFlujo, correr],
  )

  const parar = useCallback(() => control.current?.abort(), [])

  return { burbujas, setBurbujas, escribiendo, fase, opciones, enviar, correr, parar }
}
