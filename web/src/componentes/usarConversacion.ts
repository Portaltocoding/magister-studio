import { useCallback, useRef, useState } from 'react'
import { ErrorApi, EVENTO_NOTAS, type EventoTutor, type Mensaje, type Propuesta } from '../api.ts'
import type { Burbuja } from './Hilo.tsx'
import { errorLegible } from './errores.ts'
import { escribirEnChat } from './preferencias.ts'
import { crearTurnos, trasFalloAlEnviar } from './turnos.ts'

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

// Lo que se ve mientras llega la respuesta: los pasos hechos, el pulso del modelo (cada señal mientras razona) y, si
// tarda, el guion de por dónde irá y frases con gracia sobre el tema.
export interface Espera {
  pasos: string[]
  segundos: number | null
  pulsos: number
  ultimo: number | null
  guion: string | null
  frases: string[]
}
export const ESPERA_VACIA: Espera = { pasos: [], segundos: null, pulsos: 0, ultimo: null, guion: null, frases: [] }

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
  const [espera, setEspera] = useState<Espera>(ESPERA_VACIA)
  const control = useRef<AbortController | null>(null)
  const [turnos] = useState(crearTurnos)

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
      setEspera(ESPERA_VACIA)
      const c = new AbortController()
      control.current = c
      const mio = turnos.nuevo()
      let empezo = false
      try {
        for await (const ev of flujo(c.signal)) {
          empezo = true
          // Soltado (cambiaste de conversación): se sigue leyendo para que el servidor la acabe, sin tocar este hilo.
          // Solo pasa «guardado»: el plan que aceptaste se guarda igual y su búsqueda de fuentes no se pierde.
          if (!turnos.vigente(mio) && ev.tipo !== 'guardado') continue
          switch (ev.tipo) {
            case 'delta':
              setFase(null)
              actualizarUltima((b) => ({ ...b, contenido: b.contenido + ev.t }))
              break
            case 'fase': {
              const nombre = NOMBRE_FASE[ev.nodo] ?? ev.nodo
              setFase(nombre)
              setEspera((e) => (e.pasos[e.pasos.length - 1] === nombre ? e : { ...e, pasos: [...e.pasos, nombre] }))
              break
            }
            case 'latido':
              setEspera((e) => ({ ...e, segundos: ev.segundos, pulsos: e.pulsos + 1, ultimo: Date.now() }))
              break
            case 'adelanto':
              setEspera((e) => ({ ...e, guion: ev.guion, frases: ev.frases }))
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
              actualizarUltima((b) => ({ ...b, contenido: errorLegible(ev.detalle).mensaje, estado: 'error' }))
              break
            default:
              break // un evento desconocido no rompe el cliente
          }
        }
        // Sin texto (por ejemplo, solo se propuso un plan): se quita la burbuja vacía.
        if (turnos.vigente(mio))
          setBurbujas((previas) => {
            const u = previas[previas.length - 1]
            return u && u.rol === 'tutor' && !u.contenido && u.estado !== 'error' ? previas.slice(0, -1) : previas
          })
      } catch (e) {
        if (!turnos.vigente(mio)) {
          // Ya no es el hilo que ves: su fallo no se pinta en otra conversación.
        } else if (e instanceof DOMException && e.name === 'AbortError') {
          actualizarUltima((b) => ({ ...b, estado: 'interrumpido' }))
        } else if (!empezo && e instanceof ErrorApi) {
          // Tu mensaje se queda en el hilo y su texto vuelve a la caja para reenviarlo.
          setBurbujas((previas) =>
            trasFalloAlEnviar(previas, {
              clave: claveNueva(),
              rol: 'tutor',
              contenido: `No se pudo enviar: ${e.message}`,
              estado: 'error',
            }),
          )
          if (propia !== null) escribirEnChat(propia)
        } else {
          actualizarUltima((b) => ({ ...b, contenido: String(e), estado: 'error' }))
        }
      } finally {
        if (turnos.vigente(mio)) {
          setEscribiendo(false)
          setFase(null)
          control.current = null
        }
        alAcabar?.()
      }
    },
    [alPlan, alGuardado, turnos],
  )

  const enviar = useCallback(
    (texto: string, alAcabar?: () => void) => correr(texto, (signal) => abrirFlujo(texto, signal), alAcabar),
    [abrirFlujo, correr],
  )

  const parar = useCallback(() => control.current?.abort(), [])

  // Al cambiar de conversación: la respuesta en curso termina en segundo plano y deja de pintarse aquí.
  const soltar = useCallback(() => {
    turnos.soltar()
    control.current = null
    setEscribiendo(false)
    setFase(null)
    setEspera(ESPERA_VACIA)
    setOpciones([])
  }, [turnos])

  return { burbujas, setBurbujas, escribiendo, fase, espera, opciones, enviar, correr, parar, soltar }
}
