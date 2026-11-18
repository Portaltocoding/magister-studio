// Los vídeos dentro del roadmap: Magister elige las lecciones más duras (o las que más fallas) y tú dices si quieres
// más o menos, y de cuánto. Antes de hacer uno ves lo que gastaría de tu sesión y de tu semana.
import { useCallback, useEffect, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import BarraCuota from './BarraCuota.tsx'
import { irARuta } from './Vacio.tsx'
import { mensajeDe } from './Cargando.tsx'

interface Recomendados {
  cuantos: 'ninguno' | 'pocos' | 'normal' | 'muchos'
  minutos: number
  estilo: string
  lecciones: { clave: string; titulo: string; razon: string; con_video: boolean }[]
}

const CUANTOS: Record<Recomendados['cuantos'], string> = {
  ninguno: 'Sin vídeos',
  pocos: 'Pocos vídeos',
  normal: 'Algunos vídeos',
  muchos: 'Muchos vídeos',
}

export default function VideosDelPlan({ planId, preparadas }: { planId: number; preparadas: Set<string> }) {
  const [r, setR] = useState<Recomendados | null>(null)
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [elegida, setElegida] = useState<string | null>(null)

  const cargar = useCallback(() => {
    pedir<Recomendados>(`/api/planes/${planId}/videos/recomendados`).then(setR).catch(() => undefined)
  }, [planId])
  useEffect(cargar, [cargar])

  const cambiar = async (cuerpo: object) => {
    await pedir('/api/videos/preferencias', { ...enviarJson(cuerpo), method: 'PUT' })
    cargar()
  }

  const hacer = async (clave: string) => {
    if (!r) return
    setHaciendo(clave)
    setAviso(null)
    try {
      await pedir(
        `/api/planes/${planId}/lecciones/${clave}/material`,
        enviarJson({ forzar: true, tipos: ['guion'], preferencias: { video: { estilo: r.estilo, minutos: r.minutos } } }),
      )
      setAviso(`Haciendo el vídeo de ${clave}: tarda un par de minutos. Lo verás en Vídeos.`)
      setElegida(null)
    } catch (e) {
      setAviso(mensajeDe(e))
    } finally {
      setHaciendo(null)
    }
  }

  if (!r) return null
  return (
    <section className="videos-plan">
      <h2>Vídeos de este plan</h2>
      <p className="nota">
        {r.cuantos === 'ninguno'
          ? 'No te propongo vídeos. Si un tema se te atraganta, pide más.'
          : 'Para las lecciones más duras (o las que más fallas), un vídeo animado antes de estudiarlas.'}
      </p>
      <div className="videos-plan-ajustes">
        <span className="chip">{CUANTOS[r.cuantos]}</span>
        <button className="boton-mini" disabled={r.cuantos === 'ninguno'} onClick={() => cambiar({ hacia: 'menos' })}>
          Menos
        </button>
        <button className="boton-mini" disabled={r.cuantos === 'muchos'} onClick={() => cambiar({ hacia: 'mas' })}>
          Más
        </button>
        <span className="videos-plan-duracion" role="radiogroup" aria-label="Duración de cada vídeo">
          {[3, 6, 10].map((m) => (
            <button key={m} role="radio" aria-checked={r.minutos === m} className={`boton-mini ${r.minutos === m ? 'elegido' : ''}`} onClick={() => cambiar({ minutos: m })}>
              {m} min
            </button>
          ))}
        </span>
      </div>
      {r.lecciones.length > 0 && (
        <ul className="videos-plan-lista">
          {r.lecciones.map((l) => (
            <li key={l.clave}>
              <span>
                <strong>
                  {l.clave} · {l.titulo}
                </strong>
                <small>{l.razon}</small>
              </span>
              {l.con_video ? (
                <button className="boton-mini" onClick={() => irARuta('#/video')}>
                  ▶ Ver
                </button>
              ) : preparadas.has(l.clave) ? (
                <button className="boton-mini" disabled={haciendo === l.clave} onClick={() => setElegida(elegida === l.clave ? null : l.clave)}>
                  Hacer vídeo
                </button>
              ) : (
                <small className="nota" title="El vídeo sale de los apuntes de la lección">
                  al preparar la lección
                </small>
              )}
              {elegida === l.clave && (
                <div className="videos-plan-confirmar">
                  <BarraCuota accion={{ accion: 'video', minutos: r.minutos }} />
                  <button className="boton boton-principal" disabled={haciendo === l.clave} onClick={() => hacer(l.clave)}>
                    Hacer el vídeo de {r.minutos} min
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {aviso && <p className="nota" role="status">{aviso}</p>}
    </section>
  )
}
