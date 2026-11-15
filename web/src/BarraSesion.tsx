import { useEffect, useState } from 'react'
import type { components } from './tipos-api.ts'

type Salud = components['schemas']['Salud']
type Estado = 'comprobando' | 'conectado' | 'sin conexión'

export default function BarraSesion() {
  const [estado, setEstado] = useState<Estado>('comprobando')

  useEffect(() => {
    let vigente = true
    fetch('/api/salud')
      .then((r) => (r.ok ? (r.json() as Promise<Salud>) : Promise.reject(new Error(String(r.status)))))
      .then((salud) => {
        if (vigente) setEstado(salud.ok ? 'conectado' : 'sin conexión')
      })
      .catch(() => {
        if (vigente) setEstado('sin conexión')
      })
    return () => {
      vigente = false
    }
  }, [])

  return (
    <header className="sesion">
      <span className={estado === 'conectado' ? 'estado estado-si' : 'estado estado-no'}>{estado}</span>
    </header>
  )
}
