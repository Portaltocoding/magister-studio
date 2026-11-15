import { useCallback, useEffect, useState } from 'react'
import { hoyIso, marcarSesion, verCalendario, type SesionVista } from '../api.ts'
import { fechaCorta } from './PanelPlan.tsx'

// Calendario: las sesiones de todos tus planes, cuatro semanas desde este lunes.
export default function PanelCalendario() {
  const [dias, setDias] = useState<{ fecha: string; sesiones: SesionVista[] }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hoy = hoyIso()

  const cargar = useCallback(() => {
    verCalendario()
      .then(setDias)
      .catch((e) => setError(String(e.message)))
  }, [])

  useEffect(cargar, [cargar])

  if (error) return <p role="alert">{error}</p>
  if (dias == null) return <p className="vacio">Cargando…</p>
  if (!dias.length)
    return (
      <div className="panel">
        <h1>Calendario</h1>
        <p className="vacio">No hay sesiones en las próximas cuatro semanas. Acepta un plan en Roadmap.</p>
      </div>
    )

  return (
    <div className="panel">
      <h1>Calendario</h1>
      {dias.map((d) => (
        <div key={d.fecha} className={d.fecha === hoy ? 'dia dia-hoy' : 'dia'}>
          <span className="dia-fecha">{fechaCorta(d.fecha)}</span>
          <ul>
            {d.sesiones.map((x) => (
              <li key={x.id} className={`sesion-${x.estado}`}>
                {x.inicio ?? ''} <strong>{x.tema}</strong> · {x.clave} {x.titulo} · {x.horas} h{' '}
                <button
                  className="boton-mini"
                  onClick={async () => {
                    await marcarSesion(x.id, x.estado === 'hecha' ? 'pendiente' : 'hecha')
                    cargar()
                  }}
                >
                  {x.estado === 'hecha' ? 'Deshacer' : 'Hecha'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
