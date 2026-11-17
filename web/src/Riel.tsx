import { useEffect, useState, type ReactElement } from 'react'
import { pedir } from './api.ts'
import type { IdModo } from './modos.ts'

// La tira fina de la izquierda: siempre a la vista con la barra lateral plegada.
// El icono del tutor lleva un globito con lo pendiente para que no se te pase.

interface Hoy {
  estado: string
  leccion_clave?: string
  titulo?: string
  fecha?: string
  inicio?: string | null
  repasos: number
  examen?: { titulo: string } | null
}

const ICONOS: Record<string, ReactElement> = {
  menu: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect x="2.5" y="3.5" width="15" height="13" rx="3" />
      <line x1="7.5" y1="3.5" x2="7.5" y2="16.5" />
    </svg>
  ),
  hoy: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </svg>
  ),
  libre: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.5 3v-3h0a2 2 0 0 1-2-2z" />
    </svg>
  ),
  fichas: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M3.5 4.5c2.5-1 4.5-1 6.5 0.5c2-1.5 4-1.5 6.5-0.5v11c-2.5-1-4.5-1-6.5 0.5c-2-1.5-4-1.5-6.5-0.5z" />
      <line x1="10" y1="5" x2="10" y2="16" />
    </svg>
  ),
  repaso: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M15.5 8a6 6 0 1 0 .4 4" />
      <path d="M16 3.5v4.5h-4.5" />
    </svg>
  ),
  examen: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect x="4" y="3" width="12" height="14" rx="2" />
      <path d="M7 8l1.5 1.5L11.5 6.5M7 13h6" />
    </svg>
  ),
  foco: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  ),
  llamada: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M6.2 3.5l2 3.2-1.4 1.6a9 9 0 0 0 4.9 4.9l1.6-1.4 3.2 2-1 2.4c-6.5.4-11.8-4.9-11.4-11.4z" />
    </svg>
  ),
  progreso: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M3.5 16.5h13" />
      <path d="M6 13.5v-3M10 13.5v-7M14 13.5v-5" />
    </svg>
  ),
}

const ATAJOS: { id: IdModo; nombre: string }[] = [
  { id: 'libre', nombre: 'Estudio libre' },
  { id: 'foco', nombre: 'Modo foco' },
  { id: 'fichas', nombre: 'Lecciones' },
  { id: 'llamada', nombre: 'Llamada' },
  { id: 'repaso', nombre: 'Repaso' },
  { id: 'examen', nombre: 'Examen' },
  { id: 'progreso', nombre: 'Progreso' },
]

export function usarHoy() {
  const [hoy, setHoy] = useState<Hoy | null>(null)
  useEffect(() => {
    const cargar = () => pedir<Hoy>('/api/hoy').then(setHoy).catch(() => undefined)
    cargar()
    const t = setInterval(cargar, 120_000)
    const alVolver = () => document.visibilityState === 'visible' && cargar()
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])
  return hoy
}

// Lo pendiente de hoy, en una cifra y una frase.
export function pendienteDeHoy(hoy: Hoy | null): { n: number; texto: string } {
  if (!hoy) return { n: 0, texto: 'Hoy' }
  const partes: string[] = []
  let n = 0
  const hoyIso = new Date().toISOString().slice(0, 10)
  if (hoy.titulo && hoy.fecha && hoy.fecha <= hoyIso && hoy.estado !== 'solo_repaso') {
    partes.push(`${hoy.leccion_clave} ${hoy.titulo}`)
    n += 1
  }
  if (hoy.examen) {
    partes.push(hoy.examen.titulo)
    n += 1
  }
  if (hoy.repasos) {
    partes.push(`${hoy.repasos} repasos`)
    n += hoy.repasos
  }
  return { n, texto: partes.length ? `Hoy: ${partes.join(' · ')}` : 'Hoy: nada pendiente' }
}

export default function Riel({ modo, alAbrir, alIr, hoy }: { modo: IdModo; alAbrir: () => void; alIr: (m: IdModo) => void; hoy: Hoy | null }) {
  const p = pendienteDeHoy(hoy)
  return (
    <nav className="riel" aria-label="Accesos rápidos">
      <button type="button" className="riel-boton" onClick={alAbrir} title="Abrir la barra lateral (Ctrl+B)" aria-label="Abrir la barra lateral">
        {ICONOS.menu}
      </button>
      <button
        type="button"
        className={`riel-boton riel-hoy ${modo === 'tutor' ? 'actual' : ''} ${p.n ? 'con-aviso' : ''}`}
        onClick={() => alIr('tutor')}
        title={p.texto}
        aria-label={p.texto}
      >
        {ICONOS.hoy}
        {p.n > 0 && <span className="riel-globo">{p.n > 99 ? '99+' : p.n}</span>}
      </button>
      <span className="riel-separador" />
      {ATAJOS.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`riel-boton ${modo === a.id ? 'actual' : ''}`}
          onClick={() => alIr(a.id)}
          title={a.nombre}
          aria-label={a.nombre}
        >
          {ICONOS[a.id]}
        </button>
      ))}
    </nav>
  )
}
