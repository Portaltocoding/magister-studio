import { useCallback, useRef, useState } from 'react'
import { ErrorApi, type EventoTutor, type Mensaje } from '../api.ts'
import type { Burbuja } from './Hilo.tsx'

let contador = 0
const claveNueva = () => `tmp-${++contador}`

export const aBurbuja = (m: Mensaje): Burbuja => ({
  clave: `m-${m.id}`,
  rol: m.rol,
  contenido: m.contenido,
  estado: m.estado,
})

// Estado de un hilo que se alimenta de un flujo SSE del tutor.
// `abrirFlujo` recibe el texto y la señal de cancelación y devuelve los eventos.
export function usarConversacion(abrirFlujo: (texto: string, signal: AbortSignal) => AsyncIterable<EventoTutor>) {
  const [burbujas, setBurbujas] = useState<Burbuja[]>([])
  const [escribiendo, setEscribiendo] = useState(false)
  const control = useRef<AbortController | null>(null)

  const actualizarUltima = (cambio: (b: Burbuja) => Burbuja) =>
    setBurbujas((previas) => (previas.length ? [...previas.slice(0, -1), cambio(previas[previas.length - 1])] : previas))

  const enviar = useCallback(
    async (texto: string, alAcabar?: () => void) => {
      const propia: Burbuja = { clave: claveNueva(), rol: 'usuario', contenido: texto, estado: 'completo' }
      const tutor: Burbuja = { clave: claveNueva(), rol: 'tutor', contenido: '', estado: 'llegando' }
      setBurbujas((previas) => [...previas, propia, tutor])
      setEscribiendo(true)
      const c = new AbortController()
      control.current = c
      let empezo = false
      try {
        for await (const ev of abrirFlujo(texto, c.signal)) {
          empezo = true
          if (ev.tipo === 'delta') actualizarUltima((b) => ({ ...b, contenido: b.contenido + ev.t }))
          else if (ev.tipo === 'fin')
            actualizarUltima((b) => ({
              ...b,
              clave: ev.mensaje_id ? `m-${ev.mensaje_id}` : b.clave,
              estado: 'completo',
              tiempos: { primero: ev.ms_primer_token, total: ev.ms_total },
            }))
          else if (ev.tipo === 'error') actualizarUltima((b) => ({ ...b, contenido: ev.detalle, estado: 'error' }))
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          actualizarUltima((b) => ({ ...b, estado: 'interrumpido' }))
        } else if (!empezo && e instanceof ErrorApi) {
          // Falló antes del flujo (404, 422): se retiran las dos burbujas optimistas.
          setBurbujas((previas) => [
            ...previas.slice(0, -2),
            { clave: claveNueva(), rol: 'tutor', contenido: `No se pudo enviar: ${e.message}`, estado: 'error' },
          ])
        } else {
          actualizarUltima((b) => ({ ...b, contenido: String(e), estado: 'error' }))
        }
      } finally {
        setEscribiendo(false)
        control.current = null
        alAcabar?.()
      }
    },
    [abrirFlujo],
  )

  const parar = useCallback(() => control.current?.abort(), [])

  return { burbujas, setBurbujas, escribiendo, enviar, parar }
}
