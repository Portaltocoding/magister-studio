import { useCallback, useEffect, useState } from 'react'
import Horario from '../componentes/Horario.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import {
  enviarJson,
  hoyIso,
  pedir,
  rutaExamen,
  lanzarResearch,
  listarPlanes,
  marcarSesion,
  recalcularPlan,
  verPlan,
  type ResumenPlan,
  type VistaPlan,
} from '../api.ts'

// Números a la española: coma decimal.
const num = (n: number | null | undefined) => (n == null ? '0' : String(n).replace('.', ','))

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
  const [horario, setHorario] = useState(false)
  const [reajuste, setReajuste] = useState<{ cambios: string[]; avisos: string[]; texto: string; sesiones: unknown[] | null } | null>(null)

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

  const borrarPlan = async () => {
    if (tema == null || !vista) return
    const nombre = planes?.find((x) => x.tema_id === tema)?.tema ?? 'este plan'
    const ok = confirm(
      `¿Borrar el plan «${nombre}»?\n\nSe borran sus ${vista.lecciones.length} lecciones, el calendario, los apuntes, las fichas, ` +
        'tus repasos de esos conceptos y sus exámenes. Las conversaciones se quedan. No se puede deshacer.',
    )
    if (!ok) return
    try {
      await pedir(`/api/temas/${tema}/plan`, { method: 'DELETE' })
      setVista(null)
      setTema(null)
      const ps = await listarPlanes()
      setPlanes(ps)
      if (ps.length) setTema(ps[0].tema_id)
      setAviso(`Plan «${nombre}» borrado.`)
    } catch (e) {
      setAviso(String((e as Error).message))
    }
  }

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
        <Vacio
          etiqueta="Sin plan todavía"
          titulo="Tu camino, lección a lección"
          texto="Un plan convierte «quiero aprender X» en lecciones ordenadas, con horas y fechas en tu calendario. Lo puedes cambiar cuando quieras."
          pasos={[
            { titulo: 'Cuatro preguntas', texto: 'Qué, para qué, qué sabes ya y cuánto tiempo tienes.' },
            { titulo: 'El tutor propone', texto: 'Lecciones, objetivos y calendario. Lo aceptas o lo cambias.' },
            { titulo: 'A estudiar', texto: 'Cada día, el tutor te dice qué toca.' },
          ]}
          acciones={[{ texto: 'Crear mi plan', principal: true, alPulsar: alNuevoPlan }]}
        />
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
              {p.lecciones} lecciones · {num(p.total_horas)} h · acaba {fechaCorta(p.fin)}
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
      {reajuste && (
        <section className="propuesta">
          <h2>Reajuste propuesto</h2>
          {reajuste.texto && <p>{reajuste.texto}</p>}
          <ul className="nota">
            {[...reajuste.cambios, ...reajuste.avisos].map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="botones">
            <button
              className="boton boton-principal"
              onClick={async () => {
                if (tema == null || !reajuste.sesiones) return
                setVista(await pedir<VistaPlan>(`/api/temas/${tema}/plan/reajuste/aceptar`, enviarJson({ sesiones: reajuste.sesiones })))
                setReajuste(null)
                setAviso('Reajuste aplicado.')
              }}
            >
              Aceptar
            </button>
            <button className="boton" onClick={() => setReajuste(null)}>
              Rechazar
            </button>
          </div>
        </section>
      )}
      {vista && (
        <>
          <p className="nota">
            Versión {vista.version} · {num(vista.horas_hechas)} de {num(vista.total_horas)} h hechas ({pct(vista.progreso)}) ·
            fin previsto {fechaCorta(vista.fin)}{' '}
            <button className="boton-mini" onClick={() => setHorario(!horario)}>
              Mi horario
            </button>{' '}
            <button className="boton-mini peligro" onClick={borrarPlan}>
              Borrar el plan
            </button>{' '}
            <button className="boton-mini" onClick={atrasado}>
              Me he atrasado
            </button>{' '}
            <button
              className="boton-mini"
              onClick={async () => {
                if (tema == null) return
                setAviso('Calculando el reajuste…')
                const r = await pedir<NonNullable<typeof reajuste>>(`/api/temas/${tema}/plan/reajuste`, { method: 'POST' })
                setAviso(r.cambios.length ? null : 'Tu calendario ya cuadra con tus repasos.')
                setReajuste(r.cambios.length ? r : null)
              }}
            >
              Reajustar con mis repasos
            </button>
          </p>
          {horario && tema != null && (
            <Horario
              temaId={tema}
              perfil={vista.perfil}
              alCerrar={() => setHorario(false)}
              alGuardar={(v) => {
                setVista(v)
                setHorario(false)
                setAviso(`Horario guardado. Ahora acabas el ${fechaCorta(v.fin)}.`)
              }}
            />
          )}
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
                      {num(l.horas_hechas)}/{num(l.horas)} h · {l.estado}
                      {l.depende_de.length ? ` · después de ${l.depende_de.join(', ')}` : ''} ·{' '}
                      {l.sin_material ? 'sin material' : `${l.fuentes} fragmentos de tus fuentes`}
                    </span>{' '}
                    {l.sin_material && (
                      <button
                        className="boton-mini"
                        onClick={async () => {
                          await lanzarResearch(vista.plan_id, [l.clave])
                          setAviso(`Buscando fuentes para ${l.clave}. Las propuestas aparecerán en Temas y fuentes.`)
                        }}
                      >
                        Buscar fuentes
                      </button>
                    )}
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
              {vista.examenes?.length > 0 && (
                <>
                  <h2>Exámenes</h2>
                  <ul className="hitos-examen">
                    {vista.examenes.map((h) => (
                      <li key={h.id} className={`${h.hecho ? 'hecho' : ''} ${h.final ? 'final' : ''}`}>
                        <span className="hito-fecha">{fechaCorta(h.fecha)}</span>
                        <span className="hito-titulo">
                          <strong>{h.titulo}</strong>
                          <small>
                            {h.preguntas} preguntas · {h.minutos} min
                            {h.nota != null ? ` · ${h.hecho ? 'aprobado con' : 'mejor nota'} ${h.nota.toFixed(1).replace('.', ',')}` : ''}
                          </small>
                        </span>
                        <button className="boton-mini" onClick={() => irARuta(rutaExamen(vista.plan_id, h))}>
                          {h.hecho ? 'Repetir' : 'Hacerlo'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
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
                            {x.inicio ?? ''} {x.clave} {x.titulo} · {num(x.horas)} h
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
