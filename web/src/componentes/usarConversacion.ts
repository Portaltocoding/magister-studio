import { useCallback, useRef, useState } from 'react'
import { t, type Clave } from '../i18n/i18n.ts'
import { ErrorApi, EVENTO_NOTAS, type EventoTutor, type Mensaje, type Propuesta } from '../api.ts'
import type { Burbuja } from './Hilo.tsx'
import { errorLegible, esSinConexion, mensajeSinConexion } from './errores.ts'
import { escribirEnChat } from './preferencias.ts'
import { crearTurnos, trasFalloAlEnviar, trasFalloSinConexion } from './turnos.ts'

// Aceptar un plan que ya estaba aceptado (dos clics, dos pestañas): lo que se dice en vez de un error.
export const mensajeYaAceptado = () => t('pensando.yaAceptado')

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

// Las respuestas rápidas guardadas solo valen si su mensaje sigue siendo el último del hilo.
export const respuestasDelUltimo = (ms: Mensaje[]): { valor: string; etiqueta: string }[] => {
  const u = ms[ms.length - 1]
  return u && u.rol === 'tutor' ? (u.respuestas_rapidas?.opciones ?? []) : []
}

// Lo que se enseña de cada nodo del grafo mientras trabaja; el diccionario (pensando.fase.<nodo>) lo da en el idioma de ahora.
const NODOS_FASE = ['extraer', 'a_diagnostico', 'preguntar', 'planificar', 'calendarizar', 'negociar', 'explicar_fallo', 'guardar', 'buscar', 'recuperar', 'reescribir', 'responder', 'aclarar', 'preparar', 'comprobar', 'corregir']
export const nombreFase = (nodo: string): string => (NODOS_FASE.includes(nodo) ? t(`pensando.fase.${nodo}` as Clave) : nodo)

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
  alYaDecidido?: (plan_id: number | null) => void,
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
      // El aviso de «sin conexión» de un intento anterior sobra en cuanto lo reenvías.
      setBurbujas((previas) => {
        const u = previas[previas.length - 1]
        const sinAviso = u && u.estado === 'error' && esSinConexion(u.contenido) ? previas.slice(0, -1) : previas
        return [...sinAviso, ...nuevas]
      })
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
              const nombre = nombreFase(ev.nodo)
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
              if (ev.ya_decidido) {
                // La decisión ya estaba tomada (aceptaste dos veces): no es un fallo.
                actualizarUltima((b) => ({ ...b, contenido: mensajeYaAceptado(), estado: 'completo' }))
                alYaDecidido?.(ev.plan_id ?? null)
                break
              }
              actualizarUltima((b) => ({ ...b, contenido: errorLegible(ev.detalle).mensaje, estado: 'error' }))
              break
            case 'cortado':
              // Se queda con lo que llevaba escrito, como una respuesta que paraste tú.
              actualizarUltima((b) => ({ ...b, clave: ev.mensaje_id ? `m-${ev.mensaje_id}` : b.clave, estado: 'interrumpido' }))
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
        } else if (!empezo && e instanceof ErrorApi && e.codigo === 0) {
          // Sin conexión no ha llegado nada: tu mensaje sale del hilo (no se envió) y vuelve a la caja para reenviarlo.
          const error: Burbuja = { clave: claveNueva(), rol: 'tutor', contenido: mensajeSinConexion(), estado: 'error' }
          setBurbujas((previas) => trasFalloSinConexion(previas, error, propia !== null))
          if (propia !== null) escribirEnChat(propia)
        } else if (!empezo && e instanceof ErrorApi) {
          // Tu mensaje se queda en el hilo y su texto vuelve a la caja para reenviarlo.
          setBurbujas((previas) =>
            trasFalloAlEnviar(previas, {
              clave: claveNueva(),
              rol: 'tutor',
              contenido: `No se pudo enviar. ${errorLegible(e.message).mensaje}`,
              estado: 'error',
            }),
          )
          if (propia !== null) escribirEnChat(propia)
        } else {
          // A mitad de respuesta (se cortó la red, un fallo del navegador): en castellano, nunca «TypeError: …».
          actualizarUltima((b) => ({ ...b, contenido: errorLegible(String(e)).mensaje, estado: 'error' }))
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
    [alPlan, alGuardado, alYaDecidido, turnos],
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

  // El hilo guardado (al abrir o recargar): las respuestas rápidas del último mensaje, si es del tutor, vuelven a salir.
  const cargar = useCallback((ms: Mensaje[]) => {
    setBurbujas(ms.map(aBurbuja))
    setOpciones(respuestasDelUltimo(ms))
  }, [])

  return { burbujas, setBurbujas, cargar, escribiendo, fase, espera, opciones, enviar, correr, parar, soltar }
}
