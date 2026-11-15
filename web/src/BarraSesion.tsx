import { useEffect, useState } from 'react'
import { pedir } from './api.ts'

type Estado = 'comprobando' | 'conectado' | 'sin conexión'

interface Alerta {
  id: number
  nombre: string
  detalle: string
  runbook: string
}

export default function BarraSesion() {
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
    </header>
  )
}
