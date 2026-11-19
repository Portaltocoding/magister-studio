// Un solo reloj en el modo foco: el pomodoro (el Tomate de la barra) es el reloj del foco. Si al entrar hay uno en
// marcha, el foco enseña su cuenta atrás y su descanso abre la pantalla de descanso del foco; si no, el ajuste
// «Pausa» crea uno. Con «sin pausa» y sin pomodoro, el reloj cuenta lo que llevas, como antes.
// Solo reglas, sin React (pruebas en web/pruebas/relojFoco.test.ts).
import type { Fase } from './pomodoro.ts'
import { relojZen } from './zen.ts'

export interface EstadoPomodoro {
  fase: Fase | null
  fin: number | null
}

// ¿Hay que crear un pomodoro? Solo en una lección abierta, con pausa elegida y sin ninguno en marcha.
export const crearPomodoro = (p: EstadoPomodoro, pausaMin: number, cerrada: boolean) => !cerrada && pausaMin > 0 && p.fase == null

// ¿El reloj del foco está parado? Con pomodoro, si el pomodoro lo está; sin él, la pausa propia del foco.
export const relojParado = (p: EstadoPomodoro, pausadoSinPomodoro: boolean) => (p.fase ? p.fin == null : pausadoSinPomodoro)

export const mmssDe = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Lo que dice el botón del reloj: la cuenta atrás y la fase («· pomodoro», «· descanso») o, sin pomodoro, lo que
// llevas. En zen, en minutos (redondeando hacia arriba en la cuenta atrás: «1 min» hasta el final).
export function textoReloj(c: { p: EstadoPomodoro; quedan: number | null; segundos: number; zen: boolean }): { tiempo: string; fase: string | null } {
  if (c.p.fase) {
    const ms = Math.max(0, c.quedan ?? 0)
    return { tiempo: c.zen ? relojZen(Math.ceil(ms / 60_000) * 60) : mmssDe(ms), fase: c.p.fase === 'foco' ? 'pomodoro' : 'descanso' }
  }
  const s = Math.max(0, c.segundos)
  const h = Math.floor(s / 3600)
  const largo = h ? `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : mmssDe(s * 1000)
  return { tiempo: c.zen ? relojZen(s) : largo, fase: null }
}
