import { useEffect, useState } from 'react'
import { pedir } from './api.ts'
import Afinar from './componentes/Afinar.tsx'

type Estado = 'comprobando' | 'conectado' | 'sin conexión'

interface Alerta {
  id: number
  nombre: string
  detalle: string
  runbook: string
}

export default function BarraSesion({ alMenu, alPlegar, plegada }: { alMenu?: () => void; alPlegar?: () => void; plegada?: boolean }) {
  const [estado, setEstado] = useState<Estado>('comprobando')
  const [alertas, setAlertas] = useState<Alerta[]>([])

  useEffect(() => {
    let vigente = true
    const comprobar = () => {
      pedir<{ ok: boolean }>('/api/salud')
        .then((s) => vigente && setEstado(s.ok ? 'conectado' : 'sin conexión'))
        .catch(() => vigente && setEstado('sin conexión'))
      pedir<Alerta[]>('/api/alertas')
        .then((a) => vigente && setAlertas(a))
        .catch(() => undefined)
    }
    comprobar()
    const t = setInterval(comprobar, 60_000)
    return () => {
      vigente = false
      clearInterval(t)
    }
  }, [])

  return (
    <header className="sesion">
      {alPlegar && (
        <button
          type="button"
          className="boton-plegar"
          onClick={alPlegar}
          aria-label={plegada ? 'Mostrar la barra lateral' : 'Plegar la barra lateral'}
          title={`${plegada ? 'Mostrar' : 'Plegar'} la barra lateral (Ctrl+B)`}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <rect x="2.5" y="3.5" width="15" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <line x1="7.5" y1="3.5" x2="7.5" y2="16.5" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      )}
      {alMenu && (
        <button type="button" className="boton-menu boton-mini" onClick={alMenu} aria-label="Abrir el menú">
          ☰ Menú
        </button>
      )}
      {alertas.map((a) => (
        <span key={a.id} className="alerta" role="alert" title={`Qué hacer: ${a.runbook}`}>
          ⚠ {a.detalle}{' '}
          <button
            className="boton-mini"
            onClick={() => pedir(`/api/alertas/${a.id}/resolver`, { method: 'POST' }).then(() => setAlertas(alertas.filter((x) => x.id !== a.id)))}
          >
            Resuelta
          </button>
        </span>
      ))}
      <span className={estado === 'conectado' ? 'estado estado-si' : 'estado estado-no'}>{estado}</span>
      <Afinar />
    </header>
  )
}
