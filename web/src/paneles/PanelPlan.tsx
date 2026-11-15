import { useCallback, useEffect, useState } from 'react'
import { hoyIso, listarPlanes, marcarSesion, recalcularPlan, verPlan, type ResumenPlan, type VistaPlan } from '../api.ts'

interface Props {
  alNuevoPlan: () => void
  temaInicial?: number | null
}

export const fechaCorta = (iso: string | null) =>
  iso
    ? new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
    : '·'

const pct = (x: number) => `${Math.round(x * 100)} %`

// Roadmap: tus planes aceptados, sus lecciones con ideas clave y el calendario por semanas.
export default function PanelPlan({ alNuevoPlan, temaInicial }: Props) {
  const [planes, setPlanes] = useState<ResumenPlan[] | null>(null)
  const [tema, setTema] = useState<number | null>(temaInicial ?? null)
  const [vista, setVista] = useState<VistaPlan | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    listarPlanes()
      .then((ps) => {
        setPlanes(ps)
        if (ps.length && tema == null) setTema(ps[0].tema_id)
      })
      .catch((e) => setAviso(String(e.message)))
  }, [tema])

  const cargar = useCallback(() => {
    if (tema == null) return
    verPlan(tema)
      .then(setVista)
      .catch((e) => setAviso(String(e.message)))
  }, [tema])

  useEffect(cargar, [cargar])

  const atrasado = async () => {
    if (tema == null) return
    try {
      setVista(await recalcularPlan(tema, hoyIso()))
      setAviso('Calendario recalculado desde hoy. Lo hecho no se toca.')
    } catch (e) {
      setAviso(String((e as Error).message))
    }
  }

  if (planes == null) return <p className="vacio">Cargando…</p>

  if (!planes.length)
    return (
      <div className="panel">
        <h1>Roadmap</h1>
        <p className="vacio">Aún no tienes ningún plan. Cuéntale al tutor qué quieres aprender y te propone uno.</p>
        <button className="boton boton-principal" onClick={alNuevoPlan}>
          Nuevo plan
        </button>
      </div>
    )

  return (
    <div className="panel">
      <div className="cabecera-panel">
        <h1>Roadmap</h1>
        <button className="boton" onClick={alNuevoPlan}>
          Nuevo plan
        </button>
      </div>
      <div className="tarjetas">
        {planes.map((p) => (
          <button
            key={p.plan_id}
            className="tarjeta"
            aria-pressed={p.tema_id === tema}
            onClick={() => setTema(p.tema_id)}
          >
            <strong>{p.tema}</strong>
            <span className="nota">
              {p.lecciones} lecciones · {p.total_horas} h · acaba {fechaCorta(p.fin)}
            </span>
            <span className="barra" aria-label={`Progreso ${pct(p.progreso)}`}>
              <span style={{ width: pct(p.progreso) }} />
            </span>
          </button>
        ))}
      </div>
      {aviso && (
        <p className="nota" role="status">
          {aviso}
        </p>
      )}
      {vista && (
        <>
          <p className="nota">
            Versión {vista.version} · {vista.horas_hechas} de {vista.total_horas} h hechas ({pct(vista.progreso)}) ·
            fin previsto {fechaCorta(vista.fin)}{' '}
            <button className="boton-mini" onClick={atrasado}>
              Me he atrasado
            </button>
          </p>
          <div className="dos-columnas">
            <section>
              <h2>Lecciones</h2>
              <ol className="lecciones">
                {vista.lecciones.map((l) => (
                  <li key={l.clave} className={`leccion-${l.estado}`}>
                    <strong>
                      {l.clave} · {l.titulo}
                    </strong>{' '}
                    <span className="nota-linea">
                      {l.horas_hechas}/{l.horas} h · {l.estado}
                      {l.depende_de.length ? ` · después de ${l.depende_de.join(', ')}` : ''}
                    </span>
                    <ul>
                      {l.objetivos.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                    <div className="chips">
                      {l.conceptos.map((c) => (
                        <span key={c.id} className="chip">
                          {c.nombre}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h2>Calendario</h2>
              {vista.semanas.map((s) => (
                <div key={s.lunes} className="semana">
                  <h3>Semana del {fechaCorta(s.lunes)}</h3>
                  {s.dias.map((d) => (
                    <div key={d.fecha} className={d.hoy ? 'dia dia-hoy' : 'dia'}>
                      <span className="dia-fecha">{fechaCorta(d.fecha)}</span>
                      <ul>
                        {d.sesiones.map((x) => (
                          <li key={x.id} className={`sesion-${x.estado}`}>
                            {x.inicio ?? ''} {x.clave} {x.titulo} · {x.horas} h
                            <select
                              aria-label={`Estado de ${x.clave} el ${d.fecha}`}
                              value={x.estado}
                              onChange={async (e) => {
                                await marcarSesion(x.id, e.target.value as typeof x.estado)
                                cargar()
                              }}
                            >
                              <option value="pendiente">pendiente</option>
                              <option value="hecha">hecha</option>
                              <option value="saltada">saltada</option>
                            </select>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
