// Los vídeos dentro del roadmap: Magister elige las lecciones más duras (o las que más fallas) y tú dices si quieres
// más o menos, y de cuánto. Antes de hacer uno ves lo que gastaría de tu sesión y de tu semana.
// El vídeo sale de los apuntes: si la lección aún no los tiene, un solo botón los prepara y después hace el vídeo, en
// un único trabajo. Mientras tanto la fila enseña cómo va (lo sigue por SSE, como Lecciones) hasta que se puede ver.
import { useCallback, useEffect, useRef, useState } from 'react'
import { enviarJson, ErrorApi, leerSSE, pedir } from '../api.ts'
import BarraCuota from './BarraCuota.tsx'
import { irARuta } from './Vacio.tsx'
import { mensajeDe, TextoError } from './Cargando.tsx'

interface Recomendados {
  cuantos: 'ninguno' | 'pocos' | 'normal' | 'muchos'
  minutos: number
  estilo: string
  lecciones: { clave: string; titulo: string; razon: string; con_video: boolean }[]
}

// Cómo va el trabajo de una fila. «comprobando»: ha acabado y se está mirando si el vídeo ya se puede ver;
// «cortado»: sigue en marcha, pero se ha dejado de mirar (tope de tiempo o demasiados cortes).
interface Seguimiento {
  id: number
  estado: string
  nodo: string | null
  paso: number
  total: number
  error: string | null
  conApuntes: boolean
  // Lo pediste desde aquí (y no es, por ejemplo, unos apuntes que pediste en Lecciones).
  propio: boolean
}

type EventoTrabajo =
  | { tipo: 'fase'; nodo: string; paso: number; total: number; estado: string }
  | { tipo: 'aviso'; regla: string; detalle: string }
  | { tipo: 'fin' }
  | { tipo: 'error'; detalle: string }

const CUANTOS: Record<Recomendados['cuantos'], string> = {
  ninguno: 'Sin vídeos',
  pocos: 'Pocos vídeos',
  normal: 'Algunos vídeos',
  muchos: 'Muchos vídeos',
}

// Las fases de los apuntes (las mismas que nombra Lecciones).
const FASES_APUNTES = new Set(['entrada', 'contrato', 'escribir', 'lint', 'juez', 'refinar', 'aceptar', 'montar', 'completitud', 'ampliar', 'preguntas', 'pintar'])
const EN_MARCHA = ['pendiente', 'en_curso']
// Se deja de mirar a los 45 minutos o tras 6 cortes seguidos: nunca un seguimiento sin fin.
const TOPE_MS = 45 * 60_000
const MAX_CORTES = 6
const ESPERA_CORTE_MS = 4000

function etiqueta(t: Seguimiento): string {
  if (t.estado === 'comprobando') return 'Listo. Comprobando el vídeo…'
  if (t.estado === 'hecho') return 'Listo'
  if (t.nodo === 'guion') return 'Haciendo el vídeo…'
  if (t.nodo === 'diapositivas') return 'Haciendo las diapositivas…'
  if (t.nodo && FASES_APUNTES.has(t.nodo))
    return t.conApuntes ? `Preparando los apuntes…${t.total > 1 ? ` (bloque ${t.paso + 1} de ${t.total})` : ''}` : 'Empezando…'
  return t.estado === 'en_curso' ? 'Empezando…' : 'En cola…'
}

const esperar = (ms: number, signal: AbortSignal) =>
  new Promise<void>((listo) => {
    const t = setTimeout(listo, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      listo()
    }, { once: true })
  })

export default function VideosDelPlan({
  planId,
  temaId,
  preparadas,
  enMarcha,
  alAcabar,
}: {
  planId: number
  // El tema del plan: «Ver» abre #/video/<tema>, ese plan y no el que tuviera Vídeo.
  temaId?: number | null
  preparadas: Set<string>
  // Lecciones con un trabajo de material en marcha (de aquí o de Lecciones): se sigue ese, no se pide otro.
  enMarcha?: Set<string>
  // Al acabar un trabajo: Roadmap vuelve a leer qué tiene cada lección (apuntes listos).
  alAcabar?: () => void
}) {
  const [r, setR] = useState<Recomendados | null>(null)
  const [pidiendo, setPidiendo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [elegida, setElegida] = useState<string | null>(null)
  const [trabajos, setTrabajos] = useState<Record<string, Seguimiento>>({})
  const controles = useRef(new Map<string, AbortController>())
  const reanudados = useRef(new Set<string>())

  const cargar = useCallback(
    () =>
      pedir<Recomendados>(`/api/planes/${planId}/videos/recomendados`)
        .then(setR)
        .catch(() => undefined),
    [planId],
  )
  useEffect(() => {
    cargar()
  }, [cargar])

  // Al cambiar de plan o salir de la pantalla se deja de seguir todo (los trabajos siguen en el servidor).
  useEffect(() => {
    const mapa = controles.current
    const vistos = reanudados.current
    return () => {
      mapa.forEach((c) => c.abort())
      mapa.clear()
      vistos.clear()
      setTrabajos({})
    }
  }, [planId])

  const seguir = useCallback(
    async (clave: string, id: number, conApuntes: boolean, propio: boolean) => {
      controles.current.get(clave)?.abort()
      const c = new AbortController()
      controles.current.set(clave, c)
      const poner = (x: Partial<Seguimiento>) =>
        setTrabajos((t) => ({ ...t, [clave]: { ...(t[clave] ?? { id, estado: 'pendiente', nodo: null, paso: 0, total: 0, error: null, conApuntes, propio }), ...x } }))
      poner({ id, estado: 'pendiente', nodo: null, paso: 0, total: 0, error: null, conApuntes, propio })
      let vencido = false
      const tope = setTimeout(() => {
        vencido = true
        c.abort()
      }, TOPE_MS)
      let final: 'hecho' | 'fallido' | 'cancelado' | null = null
      try {
        for (let cortes = 0; !final && !c.signal.aborted; cortes++) {
          // Se cortó sin terminar (el servidor se reinició, la red): se vuelve a mirar en unos segundos, con tope.
          if (cortes > 0) {
            if (cortes > MAX_CORTES) break
            await esperar(ESPERA_CORTE_MS, c.signal)
            if (c.signal.aborted) break
          }
          try {
            const resp = await fetch(`/api/trabajos/${id}/eventos`, { signal: c.signal })
            for await (const ev of leerSSE<EventoTrabajo>(resp)) {
              if (ev.tipo === 'fase') poner({ estado: ev.estado, nodo: ev.nodo, paso: ev.paso, total: ev.total })
              else if (ev.tipo === 'error') {
                // Si lo paraste tú, no es un fallo.
                final = ev.detalle === 'cancelado' ? 'cancelado' : 'fallido'
                poner({ estado: final, error: final === 'fallido' ? ev.detalle : null })
              } else if (ev.tipo === 'fin') {
                final = 'hecho'
                poner({ estado: 'comprobando' })
              }
            }
          } catch (e) {
            if (c.signal.aborted) break
            if (e instanceof ErrorApi && e.codigo === 404) {
              final = 'fallido'
              poner({ estado: 'fallido', error: 'Ya no encuentro ese trabajo.' })
            }
          }
        }
      } finally {
        clearTimeout(tope)
        if (controles.current.get(clave) === c) controles.current.delete(clave)
      }
      if (vencido || (!final && !c.signal.aborted)) poner({ estado: 'cortado' })
      if (final === 'hecho' && !c.signal.aborted) {
        await cargar()
        alAcabar?.()
        poner({ estado: 'hecho' })
      }
    },
    [cargar, alAcabar],
  )

  // Si al entrar ya hay un trabajo en marcha en alguna de estas lecciones (lo pediste antes, aquí o en Lecciones), se
  // enseña cómo va. Una sola vez por lección: nada se relanza solo.
  const claveMarcha = [...(enMarcha ?? [])].sort().join(',')
  useEffect(() => {
    if (!r || !claveMarcha) return
    for (const l of r.lecciones) {
      if (!enMarcha?.has(l.clave) || reanudados.current.has(l.clave) || controles.current.has(l.clave)) continue
      reanudados.current.add(l.clave)
      pedir<{ ultimo_trabajo: { id: number; estado: string } | null }>(`/api/planes/${planId}/lecciones/${l.clave}/material`)
        .then((d) => {
          const t = d.ultimo_trabajo
          if (t && EN_MARCHA.includes(t.estado)) seguir(l.clave, t.id, !preparadas.has(l.clave), false)
        })
        .catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, claveMarcha, planId])

  const cambiar = async (cuerpo: object) => {
    await pedir('/api/videos/preferencias', { ...enviarJson(cuerpo), method: 'PUT' })
    cargar()
  }

  // conApuntes: la lección aún no tiene apuntes; se preparan y después se hace el vídeo, en un solo trabajo.
  const hacer = async (clave: string, conApuntes: boolean) => {
    if (!r || pidiendo) return
    setPidiendo(clave)
    setAviso(null)
    try {
      // No duplicar: si esta lección ya tiene un trabajo en marcha, se sigue ese en vez de pedir otro.
      const estados = await pedir<Record<string, { en_marcha?: boolean }>>(`/api/planes/${planId}/materiales`)
      if (estados[clave]?.en_marcha) {
        const d = await pedir<{ ultimo_trabajo: { id: number; estado: string } | null }>(`/api/planes/${planId}/lecciones/${clave}/material`)
        const t = d.ultimo_trabajo
        if (t && EN_MARCHA.includes(t.estado)) {
          setElegida(null)
          setAviso(`${clave} ya se estaba preparando: te enseño cómo va. Si al acabar falta el vídeo, pídelo entonces.`)
          seguir(clave, t.id, conApuntes, false)
          return
        }
      }
      const tipos = conApuntes ? ['apuntes', 'preguntas', 'guion'] : ['guion']
      const res = await pedir<{ trabajo_id: number }>(
        `/api/planes/${planId}/lecciones/${clave}/material`,
        enviarJson({ forzar: true, tipos, preferencias: { video: { estilo: r.estilo, minutos: r.minutos } } }),
      )
      setElegida(null)
      seguir(clave, res.trabajo_id, conApuntes, true)
    } catch (e) {
      setElegida(null)
      setTrabajos((t) => ({ ...t, [clave]: { id: 0, estado: 'fallido', nodo: null, paso: 0, total: 0, error: mensajeDe(e), conApuntes, propio: true } }))
    } finally {
      setPidiendo(null)
    }
  }

  if (!r) return null
  const hechos = r.lecciones.filter((l) => l.con_video).length
  const todos = r.lecciones.length > 0 && hechos === r.lecciones.length
  return (
    <section className="videos-plan">
      <h2>Vídeos de este plan</h2>
      <p className="nota">
        {r.cuantos === 'ninguno'
          ? 'No te propongo vídeos. Si un tema se te atraganta, pide más.'
          : r.lecciones.length === 0
            ? 'Este plan aún no tiene lecciones para proponerte vídeos.'
            : todos
              ? `Ya tienes ${hechos === 1 ? 'el vídeo que te propongo' : `los ${hechos} vídeos que te propongo`}. Si quieres más, pulsa Más.`
              : 'Para las lecciones más duras (o las que más fallas), un vídeo animado antes de estudiarlas. Sale de los apuntes: si la lección aún no los tiene, se preparan antes.'}
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
          {r.lecciones.map((l) => {
            const t = trabajos[l.clave]
            const enCurso = !!t && [...EN_MARCHA, 'comprobando'].includes(t.estado)
            const conApuntes = !preparadas.has(l.clave)
            // Falló, lo cancelaste o acabó sin vídeo: el mismo botón sirve para reintentarlo (pasando otra vez por la cuota).
            const fallo = !!t && (['fallido', 'cancelado'].includes(t.estado) || (t.estado === 'hecho' && t.propio))
            const abrirConfirmar = () => setElegida(elegida === l.clave ? null : l.clave)
            return (
              <li key={l.clave}>
                <span>
                  <strong>
                    {l.clave} · {l.titulo}
                  </strong>
                  <small>{l.razon}</small>
                </span>
                {l.con_video ? (
                  <span className="videos-plan-accion">
                    {t?.estado === 'hecho' && <small role="status">Listo</small>}
                    <button className="boton-mini" onClick={() => irARuta(temaId ? `#/video/${temaId}` : '#/video')}>
                      ▶ Ver
                    </button>
                  </span>
                ) : enCurso ? (
                  <small className="videos-plan-estado" role="status">
                    {etiqueta(t)}
                  </small>
                ) : (
                  <button className="boton-mini" disabled={pidiendo === l.clave} aria-expanded={elegida === l.clave} onClick={abrirConfirmar}>
                    {fallo ? 'Reintentar' : conApuntes ? 'Preparar y hacer vídeo' : 'Hacer vídeo'}
                  </button>
                )}
                {!l.con_video && t && (fallo || t.estado === 'cortado') && (
                  <div className="videos-plan-fallo">
                    {t.estado === 'fallido' ? (
                      <TextoError texto={t.error} antes="No ha salido. " rol="status" className="nota" />
                    ) : t.estado === 'cancelado' ? (
                      <p className="nota" role="status">Cancelado.</p>
                    ) : t.estado === 'cortado' ? (
                      <p className="nota" role="status">
                        Sigue en marcha, pero he dejado de mirarlo.{' '}
                        <button className="boton-mini" onClick={() => seguir(l.clave, t.id, t.conApuntes, t.propio)}>
                          Volver a mirar
                        </button>
                      </p>
                    ) : (
                      <p className="nota" role="status">
                        Ha acabado, pero el vídeo no ha pasado la revisión. Puedes mirar la lección en Lecciones o reintentarlo.
                      </p>
                    )}
                  </div>
                )}
                {elegida === l.clave && !enCurso && (
                  <div className="videos-plan-confirmar">
                    {conApuntes ? (
                      <>
                        <p className="nota">
                          Prepara los apuntes de {l.clave} (con sus fichas) y después hace el vídeo de {r.minutos} min. Tarda unos minutos y
                          puedes seguir usando la app.
                        </p>
                        <small className="videos-plan-cuota">Los apuntes</small>
                        <BarraCuota accion={{ accion: 'material' }} />
                        <small className="videos-plan-cuota">El vídeo de {r.minutos} min</small>
                        <BarraCuota accion={{ accion: 'video', minutos: r.minutos }} />
                      </>
                    ) : (
                      <BarraCuota accion={{ accion: 'video', minutos: r.minutos }} />
                    )}
                    <button className="boton boton-principal" disabled={pidiendo === l.clave} onClick={() => hacer(l.clave, conApuntes)}>
                      {pidiendo === l.clave
                        ? 'Pidiéndolo…'
                        : conApuntes
                          ? `Preparar los apuntes y hacer el vídeo de ${r.minutos} min`
                          : `Hacer el vídeo de ${r.minutos} min`}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {aviso && <p className="nota" role="status">{aviso}</p>}
    </section>
  )
}
