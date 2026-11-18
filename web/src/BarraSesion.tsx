import { useEffect, useState } from 'react'
import { pedir } from './api.ts'
import Afinar from './componentes/Afinar.tsx'
import Tomate from './componentes/Tomate.tsx'
import { EVENTO_CONECTADO } from './componentes/Cargando.tsx'

type Estado = 'comprobando' | 'conectado' | 'sin conexión'

interface Alerta {
  id: number
  nombre: string
  detalle: string
  runbook: string
}

export default function BarraSesion({ alMenu }: { alMenu?: () => void }) {
  const [estado, setEstado] = useState<Estado>('comprobando')
  const [alertas, setAlertas] = useState<Alerta[]>([])

  useEffect(() => {
    let vigente = true
    let antes: Estado = 'comprobando'
    let reloj = 0
    // Conectado se comprueba cada minuto; sin conexión, cada 4 s, y al volver se avisa a las pantallas
    // que no pudieron cargar para que lo reintenten solas (componentes/Cargando.tsx).
    const comprobar = () => {
      clearTimeout(reloj)
      pedir<{ ok: boolean }>('/api/salud')
        .then((s) => (s.ok ? 'conectado' : 'sin conexión') as Estado)
        .catch(() => 'sin conexión' as Estado)
        .then((ahora) => {
          if (!vigente) return
          setEstado(ahora)
          if (ahora === 'conectado' && antes === 'sin conexión') window.dispatchEvent(new Event(EVENTO_CONECTADO))
          antes = ahora
          reloj = window.setTimeout(comprobar, ahora === 'conectado' ? 60_000 : 4_000)
        })
      pedir<Alerta[]>('/api/alertas')
        .then((a) => vigente && setAlertas(a))
        .catch(() => undefined)
    }
    comprobar()
    const alVolver = () => document.visibilityState === 'visible' && comprobar()
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      vigente = false
      clearTimeout(reloj)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  return (
    <header className="sesion">
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
      <button type="button" className="boton-buscar" onClick={() => window.dispatchEvent(new Event('magister-paleta'))} title="Ir a o hacer (Ctrl+K)">
        <span className="buscar-texto">Buscar</span> <kbd>Ctrl K</kbd>
      </button>
      <span className={estado === 'conectado' ? 'estado estado-si' : 'estado estado-no'} title={estado}>
        <span className="estado-texto">{estado}</span>
      </span>
      <Tomate />
      <Afinar />
    </header>
  )
}
