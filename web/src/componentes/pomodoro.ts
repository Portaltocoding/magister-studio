import { useEffect, useState } from 'react'

// Pomodoro de la mascota: foco y descanso. Vive en el navegador (sigue aunque recargues o cambies de pantalla).

export type Fase = 'foco' | 'descanso'

export interface Pomodoro {
  fase: Fase | null // null: parado
  fin: number | null // cuándo acaba la fase (ms), si corre
  restante: number | null // ms que quedaban al pausar
  foco: number // minutos
  descanso: number
  rondas: number // focos terminados hoy
  dia?: string // el día de esas rondas: al cambiar de día vuelven a cero
}

const CLAVE = 'magister-pomodoro'
const EVENTO = 'magister-pomodoro'
const INICIAL: Pomodoro = { fase: null, fin: null, restante: null, foco: 25, descanso: 5, rondas: 0 }

function leer(): Pomodoro {
  try {
    const t = localStorage.getItem(CLAVE)
    const p = t ? { ...INICIAL, ...(JSON.parse(t) as Pomodoro) } : INICIAL
    const hoy = new Date().toDateString()
    return p.dia === hoy ? p : { ...p, rondas: 0, dia: hoy }
  } catch {
    return INICIAL
  }
}

function guardar(p: Pomodoro) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(p))
  } catch {
    /* sin almacenamiento: vale hasta recargar */
  }
  window.dispatchEvent(new Event(EVENTO))
}

// Un aviso del navegador si hay permiso; si no, nada (la cuenta atrás ya se ve).
export function avisar(titulo: string, cuerpo: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(titulo, { body: cuerpo, silent: false })
  } catch {
    /* algunos navegadores no dejan crear avisos fuera de un service worker */
  }
}

// Un «ding» suave al cambiar de fase.
function ding() {
  try {
    const ctx = new AudioContext()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = 660
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.95)
  } catch {
    /* sin audio */
  }
}

// `vigilar`: solo una instancia (la de la mascota) cambia de fase y avisa; las demás solo leen y mandan.
export function usarPomodoro(vigilar = false) {
  const [p, setP] = useState<Pomodoro>(leer)
  const [ahora, setAhora] = useState(Date.now())

  useEffect(() => {
    const cambio = () => setP(leer())
    window.addEventListener(EVENTO, cambio)
    return () => window.removeEventListener(EVENTO, cambio)
  }, [])

  useEffect(() => {
    if (!p.fin) return
    const t = window.setInterval(() => setAhora(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [p.fin])

  // Fin de fase: del foco al descanso; del descanso, se para y pregunta si otra ronda.
  useEffect(() => {
    if (!vigilar || !p.fin || ahora < p.fin) return
    ding()
    if (p.fase === 'foco') {
      avisar('Magister · Descanso', `Buen foco. ${p.descanso} minutos de descanso: levántate y mira lejos.`)
      guardar({ ...p, fase: 'descanso', fin: Date.now() + p.descanso * 60_000, restante: null, rondas: p.rondas + 1 })
    } else {
      avisar('Magister · ¿Otra ronda?', 'Se acabó el descanso. Pulsa la mascota para otro foco.')
      guardar({ ...p, fase: null, fin: null, restante: null })
    }
  }, [ahora, p, vigilar])

  const quedan = p.fin ? Math.max(0, p.fin - ahora) : p.restante
  return {
    p,
    quedan,
    empezar: (foco = p.foco, descanso = p.descanso) =>
      guardar({ ...p, foco, descanso, fase: 'foco', fin: Date.now() + foco * 60_000, restante: null }),
    pausar: () => p.fin && guardar({ ...p, fin: null, restante: Math.max(0, p.fin - Date.now()) }),
    seguir: () => p.restante != null && guardar({ ...p, fin: Date.now() + p.restante, restante: null }),
    parar: () => guardar({ ...p, fase: null, fin: null, restante: null }),
  }
}

export const mmss = (ms: number | null) => {
  if (ms == null) return ''
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
