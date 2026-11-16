import { useCallback, useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { enviarJson, flujo, listarPlanes, pedir, type ResumenPlan } from '../api.ts'
import MarcoFoco, { pedirPantallaCompleta, reloj } from '../componentes/MarcoFoco.tsx'
import Pensando from '../componentes/Pensando.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import type { IdModo } from '../modos.ts'

type Modo = 'examen' | 'evaluacion'
type Nota = 'fallo' | 'parcial' | 'bien' | 'perfecta'

interface OpcionLeccion {
  clave: string
  titulo: string
  preguntas: number
}

interface PreguntaExamen {
  pregunta_id: string
  concepto_id: string
  leccion_clave: string
  tipo: string
  enunciado: string
  // Solo las tipo test: se corrigen sin modelo.
  opciones?: string[]
}

interface Examen {
  id: number
  plan_id: number
  modo: Modo
  minutos: number | null
  lecciones: string[]
  preguntas: PreguntaExamen[]
}

interface Respuesta {
  texto: string
  confianza: number | null
  marcada: boolean
  nota?: Nota | null
  explicacion?: string
  intento_id?: string
}

interface Detalle extends PreguntaExamen {
  respuesta: string
  nota: Nota | null
  explicacion: string
  referencia: string
}

interface Resumen {
  id: number
  modo: Modo
  lecciones: string[]
  creado: string
  segundos: number | null
  nota: number | null
  preguntas: number
  detalle?: Detalle[]
}

const CONFIANZAS: [number, string][] = [
  [0.25, 'No lo sé'],
  [0.5, 'Dudo'],
  [0.75, 'Bastante seguro'],
  [0.95, 'Seguro'],
]
const NOTA: Record<string, string> = { perfecta: 'Perfecta', bien: 'Bien', parcial: 'A medias', fallo: 'Fallada' }
const PUNTOS: Record<string, number> = { perfecta: 10, bien: 8, parcial: 5, fallo: 0 }
const TIPOS: Record<string, string> = {
  conceptual: 'Conceptual',
  calculo: 'Cálculo',
  fallo: 'Encuentra el fallo',
  escenario: 'Escenario',
  hablada: 'En voz alta',
  test: 'Tipo test',
}
const nueva = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
const conMates = { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] }
const color = (n: number) => (n >= 8 ? 'nota-alta' : n >= 5 ? 'nota-media' : 'nota-baja')
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// Corrige una respuesta con el mismo corrector del repaso. Devuelve la nota y la explicación.
async function corregir(p: PreguntaExamen, r: Respuesta, alTrozo?: (t: string) => void) {
  let nota: Nota = 'fallo'
  let explicacion = ''
  let intento_id: string | undefined
  for await (const ev of flujo<{ tipo: string; nota?: Nota; t?: string; intento_id?: string }>('/api/practica/intentos', {
    pregunta_id: p.pregunta_id,
    concepto_id: p.concepto_id,
    respuesta: r.texto,
    confianza: r.confianza ?? 0.5,
    clave: nueva(),
  })) {
    if (ev.tipo === 'nota' && ev.nota) nota = ev.nota
    else if (ev.tipo === 'delta' && ev.t) {
      explicacion += ev.t
      alTrozo?.(ev.t)
    } else if (ev.tipo === 'fin') intento_id = ev.intento_id
  }
  return { nota, explicacion, intento_id }
}

// ---------- Preparar ----------

function Preparar({ alEmpezar, irA }: { alEmpezar: (e: Examen) => void; irA: (m: IdModo) => void }) {
  const [planes, setPlanes] = useState<ResumenPlan[] | null>(null)
  const [plan, setPlan] = useState<ResumenPlan | null>(null)
  const [opciones, setOpciones] = useState<OpcionLeccion[]>([])
  const [elegidas, setElegidas] = useState<string[]>([])
  const [modo, setModo] = useState<Modo>('examen')
  const [cantidad, setCantidad] = useState(10)
  const [minutos, setMinutos] = useState<number | null>(20)
  const [historial, setHistorial] = useState<Resumen[]>([])
  const [viendo, setViendo] = useState<Resumen | null>(null)
  const [error, setError] = useState<string | null>(null)

  // #/examen/1/L1,L2,L3/12/24: viene del plan o del calendario, con el examen ya preparado.
  const [desdeRuta] = useState(() => {
    const [, plan, lecs, n, min] = window.location.hash.replace(/^#\/?/, '').split('/')
    if (plan) window.history.replaceState(null, '', '#/examen')
    return plan ? { plan: Number(plan), lecciones: (lecs ?? '').split(',').filter(Boolean), n: Number(n), min: Number(min) } : null
  })

  useEffect(() => {
    listarPlanes().then((ps) => {
      setPlanes(ps)
      setPlan(ps.find((p) => p.plan_id === desdeRuta?.plan) ?? ps[0] ?? null)
    })
    if (desdeRuta?.n) setCantidad(Math.min(20, desdeRuta.n))
    if (desdeRuta?.min) setMinutos(desdeRuta.min)
  }, [desdeRuta])

  useEffect(() => {
    if (!plan) return
    pedir<OpcionLeccion[]>(`/api/planes/${plan.plan_id}/examen/opciones`).then((o) => {
      setOpciones(o)
      const con = o.filter((x) => x.preguntas > 0).map((x) => x.clave)
      const pedidas = desdeRuta?.lecciones.filter((c) => con.includes(c)) ?? []
      setElegidas(pedidas.length ? pedidas : con)
    })
    pedir<Resumen[]>(`/api/examenes?plan_id=${plan.plan_id}`).then(setHistorial)
  }, [plan, desdeRuta])

  const disponibles = opciones.filter((o) => elegidas.includes(o.clave)).reduce((a, o) => a + o.preguntas, 0)

  if (planes == null) return <Pensando texto="Cargando…" />
  if (!plan)
    return (
      <div className="panel">
        <h1>Examen</h1>
        <Vacio
          etiqueta="Sin plan todavía"
          titulo="Para examinarte hace falta un plan con lecciones"
          texto="Los exámenes salen de las preguntas de tus lecciones preparadas."
          acciones={[{ texto: 'Crear un plan', principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  if (viendo) return <Resultado resumen={viendo} alVolver={() => setViendo(null)} irA={irA} />

  const conPreguntas = opciones.filter((o) => o.preguntas > 0)
  const empezar = async () => {
    setError(null)
    try {
      pedirPantallaCompleta()
      const e = await pedir<Examen>(
        '/api/examenes',
        enviarJson({ plan_id: plan.plan_id, lecciones: elegidas, cantidad, minutos: modo === 'examen' ? minutos : null, modo }),
      )
      alEmpezar(e)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  return (
    <div className="panel examen-panel">
      <div className="cabecera-panel">
        <h1>Examen</h1>
        {planes.length > 1 && (
          <select aria-label="Plan" value={plan.plan_id} onChange={(e) => setPlan(planes.find((p) => p.plan_id === Number(e.target.value)) ?? null)}>
            {planes.map((p) => (
              <option key={p.plan_id} value={p.plan_id}>
                {p.tema}
              </option>
            ))}
          </select>
        )}
      </div>

      {conPreguntas.length === 0 ? (
        <Vacio
          etiqueta="Sin preguntas todavía"
          titulo="Prepara alguna lección y podrás examinarte"
          texto="Cada lección preparada trae su banco de preguntas: de ahí salen los exámenes."
          acciones={[{ texto: 'Preparar una lección', principal: true, alPulsar: () => irA('fichas') }]}
        />
      ) : (
        <section className="examen-preparar">
          <div className="examen-modos">
            <button className={`opcion ${modo === 'examen' ? 'elegida' : ''}`} onClick={() => setModo('examen')}>
              <strong>Examen</strong>
              <small>Con reloj, sin ayudas. Corriges al entregar y sacas nota.</small>
            </button>
            <button className={`opcion ${modo === 'evaluacion' ? 'elegida' : ''}`} onClick={() => setModo('evaluacion')}>
              <strong>Evaluación</strong>
              <small>Sin prisa: cada respuesta se corrige al momento y te explica lo que falló.</small>
            </button>
          </div>

          <h2>¿De qué lecciones?</h2>
          <div className="examen-lecciones">
            {opciones.map((o) => (
              <button
                key={o.clave}
                className={`examen-leccion ${elegidas.includes(o.clave) ? 'elegida' : ''}`}
                disabled={o.preguntas === 0}
                onClick={() => setElegidas((x) => (x.includes(o.clave) ? x.filter((c) => c !== o.clave) : [...x, o.clave]))}
                title={o.preguntas ? `${o.preguntas} preguntas` : 'Sin preparar: no tiene preguntas'}
              >
                <span className="bloques-clave">{o.clave}</span>
                <span>{o.titulo}</span>
                <small>{o.preguntas ? `${o.preguntas} preg.` : 'sin preparar'}</small>
              </button>
            ))}
          </div>

          <div className="examen-ajustes">
            <div>
              <h2>¿Cuántas preguntas?</h2>
              <div className="respuestas-rapidas">
                {[...new Set([5, 10, 15, 20, cantidad])].sort((a, b) => a - b).map((n) => (
                  <button key={n} className={`opcion opcion-chip ${cantidad === n ? 'elegida' : ''}`} disabled={n > disponibles && n !== 5} onClick={() => setCantidad(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <p className="nota">Hay {disponibles} en las lecciones elegidas.</p>
            </div>
            {modo === 'examen' && (
              <div>
                <h2>¿Cuánto tiempo?</h2>
                <div className="respuestas-rapidas">
                  {[...new Set([10, 20, 30, 45, ...(minutos && ![10, 20, 30, 45].includes(minutos) ? [minutos] : [])])].sort((a, b) => a - b).map((m) => (
                    <button key={m} className={`opcion opcion-chip ${minutos === m ? 'elegida' : ''}`} onClick={() => setMinutos(m)}>
                      {m} min
                    </button>
                  ))}
                  <button className={`opcion opcion-chip ${minutos == null ? 'elegida' : ''}`} onClick={() => setMinutos(null)}>
                    Sin límite
                  </button>
                </div>
              </div>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="vacio-acciones">
            <button className="boton boton-principal" disabled={!elegidas.length || !disponibles} onClick={empezar}>
              {modo === 'examen' ? 'Empezar el examen' : 'Empezar la evaluación'}
            </button>
            <span className="nota">Se abre en modo foco. Lo que respondas cuenta para tu repaso.</span>
          </div>
        </section>
      )}

      {historial.length > 0 && (
        <section className="pg-seccion">
          <h2>Tus exámenes</h2>
          <ol className="examen-historial">
            {historial.map((h) => (
              <li key={h.id}>
                <button onClick={() => pedir<Resumen>(`/api/examenes/${h.id}`).then(setViendo)}>
                  <strong className={`examen-nota-mini ${color(h.nota ?? 0)}`}>{(h.nota ?? 0).toFixed(1).replace('.', ',')}</strong>
                  <span>
                    {h.modo === 'examen' ? 'Examen' : 'Evaluación'} · {h.lecciones.join(', ')} · {h.preguntas} preguntas
                  </span>
                  <small>
                    {fecha(h.creado)}
                    {h.segundos ? ` · ${reloj(h.segundos)}` : ''}
                  </small>
                </button>
                <button
                  className="borrar"
                  aria-label="Quitar del historial"
                  title="Quitar del historial (lo que respondiste sigue contando para tu repaso)"
                  onClick={async () => {
                    if (!confirm('¿Quitar este examen del historial? Lo que respondiste sigue contando para tu repaso.')) return
                    await pedir(`/api/examenes/${h.id}`, { method: 'DELETE' })
                    setHistorial((x) => x.filter((y) => y.id !== h.id))
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

// ---------- Hacer el examen ----------

function Haciendo({ examen, alAcabar, alSalir }: { examen: Examen; alAcabar: (r: Resumen) => void; alSalir: () => void }) {
  const { preguntas } = examen
  const evaluacion = examen.modo === 'evaluacion'
  const [i, setI] = useState(0)
  const [resp, setResp] = useState<Record<string, Respuesta>>({})
  const [segundos, setSegundos] = useState(0)
  const [corrigiendo, setCorrigiendo] = useState<{ hechas: number; total: number; deUnaVez?: boolean } | null>(null)
  const [corrigiendoUna, setCorrigiendoUna] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const servidas = useMemo(() => new Set<string>(), [])
  const limite = examen.minutos ? examen.minutos * 60 : null

  const p = preguntas[i]
  const r: Respuesta = resp[p.pregunta_id] ?? { texto: '', confianza: null, marcada: false }
  const poner = (cambio: Partial<Respuesta>) => setResp((x) => ({ ...x, [p.pregunta_id]: { ...r, ...cambio } }))
  const contestadas = preguntas.filter((q) => resp[q.pregunta_id]?.texto.trim()).length

  useEffect(() => {
    if (servidas.has(p.pregunta_id)) return
    servidas.add(p.pregunta_id)
    pedir(`/api/tutor/servir/${p.pregunta_id}`, { method: 'POST' }).catch(() => undefined)
  }, [p.pregunta_id, servidas])

  useEffect(() => {
    if (corrigiendo) return
    const t = setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [corrigiendo])

  const entregar = useCallback(async () => {
    setConfirmar(false)
    const finales = { ...resp }
    // Primero, todo el examen en una sola corrección; si falla, se corrige de una en una.
    const pendientesUna = preguntas.filter((q) => finales[q.pregunta_id]?.texto.trim() && !finales[q.pregunta_id].nota)
    if (pendientesUna.length > 0 && pendientesUna.length === preguntas.filter((q) => finales[q.pregunta_id]?.texto.trim()).length) {
      setCorrigiendo({ hechas: 0, total: pendientesUna.length, deUnaVez: true })
      try {
        const fin = await pedir<Resumen>(
          `/api/examenes/${examen.id}/corregir`,
          enviarJson({
            segundos,
            resultados: preguntas.map((q) => ({
              pregunta_id: q.pregunta_id,
              respuesta: finales[q.pregunta_id]?.texto ?? '',
              confianza: finales[q.pregunta_id]?.confianza ?? null,
            })),
          }),
        )
        alAcabar(fin)
        return
      } catch {
        /* sigue abajo, de una en una */
      }
    }
    const pendientes = preguntas.filter((q) => finales[q.pregunta_id]?.texto.trim() && !finales[q.pregunta_id].nota)
    setCorrigiendo({ hechas: 0, total: pendientes.length })
    // De tres en tres, para no saturar el modelo.
    let siguiente = 0
    const trabajador = async () => {
      while (siguiente < pendientes.length) {
        const q = pendientes[siguiente++]
        try {
          const c = await corregir(q, finales[q.pregunta_id])
          finales[q.pregunta_id] = { ...finales[q.pregunta_id], ...c }
        } catch {
          finales[q.pregunta_id] = { ...finales[q.pregunta_id], nota: null, explicacion: 'No se pudo corregir.' }
        }
        setCorrigiendo((c) => c && { ...c, hechas: c.hechas + 1 })
      }
    }
    await Promise.all([trabajador(), trabajador(), trabajador()])
    const fin = await pedir<Resumen>(
      `/api/examenes/${examen.id}/terminar`,
      enviarJson({
        segundos,
        resultados: preguntas.map((q) => {
          const x = finales[q.pregunta_id]
          return {
            pregunta_id: q.pregunta_id,
            respuesta: x?.texto ?? '',
            nota: x?.nota ?? null,
            intento_id: x?.intento_id ?? null,
            explicacion: x?.explicacion ?? '',
            confianza: x?.confianza ?? null,
          }
        }),
      }),
    )
    alAcabar(fin)
  }, [resp, preguntas, examen.id, segundos, alAcabar])

  // Se acaba el tiempo: se entrega solo.
  useEffect(() => {
    if (limite && segundos >= limite && !corrigiendo) entregar()
  }, [limite, segundos, corrigiendo, entregar])

  const comprobarAhora = async () => {
    setCorrigiendoUna(true)
    poner({ explicacion: '' })
    const c = await corregir(p, r, (t) =>
      setResp((x) => ({ ...x, [p.pregunta_id]: { ...x[p.pregunta_id], explicacion: (x[p.pregunta_id]?.explicacion ?? '') + t } })),
    )
    setResp((x) => ({ ...x, [p.pregunta_id]: { ...x[p.pregunta_id], nota: c.nota, intento_id: c.intento_id, explicacion: c.explicacion } }))
    setCorrigiendoUna(false)
  }

  const teclas = useCallback(
    (e: KeyboardEvent) => {
      if (corrigiendo) return true
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setI((x) => Math.min(preguntas.length - 1, x + 1))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setI((x) => Math.max(0, x - 1))
      }
      else return false
      return true
    },
    [corrigiendo, preguntas.length],
  )

  const queda = limite ? Math.max(0, limite - segundos) : null
  const ultimo = i === preguntas.length - 1
  const corregida = r.nota != null

  return (
    <MarcoFoco
      titulo={evaluacion ? 'Evaluación' : 'Examen'}
      placa={evaluacion ? 'EV' : 'EX'}
      alSalir={() => {
        if (corrigiendo || confirm('¿Salir? Lo que llevas no se guarda.')) alSalir()
      }}
      teclas={teclas}
      pasos={
        <ol className="foco-pasos" aria-label="Preguntas">
          {preguntas.map((q, k) => {
            const x = resp[q.pregunta_id]
            return (
              <li key={q.pregunta_id}>
                <button
                  className={`foco-paso corto ${k === i ? 'actual' : ''} ${x?.nota ? `nota-${x.nota}` : x?.texto.trim() ? 'vista' : ''} ${x?.marcada ? 'marcada' : ''}`}
                  aria-label={`Pregunta ${k + 1}`}
                  disabled={!!corrigiendo}
                  onClick={() => setI(k)}
                />
              </li>
            )
          })}
        </ol>
      }
      reloj={
        <span className={`foco-reloj ${queda != null && queda < 60 ? 'pausado' : ''}`} title={queda != null ? 'Tiempo que queda' : 'Tiempo'}>
          {queda != null ? `⏳ ${reloj(queda)}` : reloj(segundos)}
        </span>
      }
      pie={
        !corrigiendo && (
          <>
            <button className="boton" disabled={i === 0} onClick={() => setI(i - 1)}>
              ← Anterior
            </button>
            <span className="foco-atajos">
              {contestadas} de {preguntas.length} contestadas · Alt + ← → para moverte
            </span>
            {!evaluacion && (
              <button className="boton-mini" aria-pressed={r.marcada} onClick={() => poner({ marcada: !r.marcada })}>
                {r.marcada ? '★ Marcada' : '☆ Marcar para revisar'}
              </button>
            )}
            {!ultimo && (
              <button className={`boton ${evaluacion && !corregida ? '' : 'boton-principal'}`} onClick={() => setI(i + 1)}>
                Siguiente →
              </button>
            )}
            {(ultimo || !evaluacion) && (
              <button className={`boton ${ultimo ? 'boton-principal' : ''}`} onClick={() => (contestadas < preguntas.length ? setConfirmar(true) : entregar())}>
                {evaluacion ? 'Terminar' : 'Entregar'}
              </button>
            )}
          </>
        )
      }
    >
      {corrigiendo ? (
        <section className="foco-descanso">
          <span className="foco-etq">Corrigiendo</span>
          <div className="examen-corrigiendo">
            <Pensando />
          </div>
          <p>
            {corrigiendo.deUnaVez
              ? `Corrigiendo tus ${corrigiendo.total} respuestas de una vez contra las respuestas de referencia. Los tipo test ya están corregidos.`
              : `${corrigiendo.hechas} de ${corrigiendo.total} respuestas corregidas. El corrector lee cada una contra la respuesta de referencia y tus fuentes.`}
          </p>
        </section>
      ) : (
        <article className="foco-idea examen-pregunta">
          <span className="foco-etq">
            Pregunta {i + 1} de {preguntas.length} · {p.leccion_clave} · {TIPOS[p.tipo] ?? p.tipo}
          </span>
          <div className="examen-enunciado">
            <Markdown {...conMates}>{p.enunciado}</Markdown>
          </div>
          {p.opciones && p.opciones.length > 0 ? (
            <div className="examen-test">
              {p.opciones.map((o, k) => (
                <button
                  key={o}
                  type="button"
                  className={`test-opcion ${r.texto === o ? 'elegida' : ''}`}
                  disabled={corregida || corrigiendoUna}
                  onClick={() => poner({ texto: o })}
                >
                  <span className="test-letra">{String.fromCharCode(65 + k)}</span>
                  <Markdown {...conMates}>{o}</Markdown>
                </button>
              ))}
            </div>
          ) : (
          <textarea
            className="examen-respuesta"
            value={r.texto}
            disabled={corregida || corrigiendoUna}
            onChange={(e) => poner({ texto: e.target.value })}
            placeholder="Tu respuesta, con tus palabras"
            aria-label="Tu respuesta"
            autoFocus
          />
          )}
          <div className="foco-confianza">
            <span>¿Cómo de seguro estás?</span>
            {CONFIANZAS.map(([v, t]) => (
              <button key={v} className="opcion opcion-chip" data-elegida={r.confianza === v} disabled={corregida} onClick={() => poner({ confianza: v })}>
                {t}
              </button>
            ))}
            {evaluacion && !corregida && (
              <button className="boton boton-principal" disabled={!r.texto.trim() || corrigiendoUna} onClick={comprobarAhora}>
                {corrigiendoUna ? 'Corrigiendo…' : 'Comprobar'}
              </button>
            )}
          </div>
          {evaluacion && (corrigiendoUna || r.explicacion) && (
            <div className={`correccion nota-${r.nota ?? ''}`}>
              {r.nota ? <strong>{NOTA[r.nota]}</strong> : <Pensando texto="Leyendo tu respuesta…" />}
              <Markdown {...conMates}>{r.explicacion ?? ''}</Markdown>
            </div>
          )}
          {confirmar && (
            <div className="foco-aviso examen-confirmar" role="alertdialog">
              Te quedan {preguntas.length - contestadas} sin contestar: cuentan como falladas.
              <button className="boton boton-principal" onClick={entregar}>
                Entregar igualmente
              </button>
              <button className="boton" onClick={() => setConfirmar(false)}>
                Seguir
              </button>
            </div>
          )}
        </article>
      )}
    </MarcoFoco>
  )
}

// ---------- Resultado ----------

function Resultado({ resumen, alVolver, irA }: { resumen: Resumen; alVolver: () => void; irA: (m: IdModo) => void }) {
  const detalle = resumen.detalle ?? []
  const nota = resumen.nota ?? 0
  const porLeccion = useMemo(() => {
    const m = new Map<string, number[]>()
    detalle.forEach((d) => m.set(d.leccion_clave, [...(m.get(d.leccion_clave) ?? []), PUNTOS[d.nota ?? 'fallo'] ?? 0]))
    return [...m.entries()].map(([c, ps]) => ({ clave: c, nota: ps.reduce((a, b) => a + b, 0) / ps.length, n: ps.length }))
  }, [detalle])
  const falladas = detalle.filter((d) => d.nota !== 'bien' && d.nota !== 'perfecta').length

  return (
    <div className="panel examen-panel">
      <section className={`examen-nota ${color(nota)}`}>
        <div>
          <span className="pg-etq">{resumen.modo === 'examen' ? 'Examen' : 'Evaluación'} · {fecha(resumen.creado)}</span>
          <strong>{nota.toFixed(1).replace('.', ',')}</strong>
          <span>sobre 10{resumen.segundos ? ` · en ${reloj(resumen.segundos)}` : ''}</span>
        </div>
        <ul className="examen-por-leccion">
          {porLeccion.map((l) => (
            <li key={l.clave}>
              <span className="bloques-clave">{l.clave}</span>
              <span className="barra">
                <span style={{ width: `${l.nota * 10}%` }} />
              </span>
              <small>{l.nota.toFixed(1).replace('.', ',')}</small>
            </li>
          ))}
        </ul>
        <div className="botones">
          {falladas > 0 && (
            <button className="boton boton-principal" onClick={() => irA('repaso')}>
              Repasar las {falladas} que fallaste
            </button>
          )}
          <button className="boton" onClick={alVolver}>
            Otro examen
          </button>
        </div>
      </section>

      <ol className="examen-revision">
        {detalle.map((d, k) => (
          <li key={d.pregunta_id} className={`nota-borde-${d.nota ?? 'fallo'}`}>
            <div className="examen-revision-cabecera">
              <span className="foco-etq">
                {k + 1} · {d.leccion_clave} · {TIPOS[d.tipo] ?? d.tipo}
              </span>
              <span className={`chip nota-${d.nota ?? 'fallo'}`}>{d.nota ? NOTA[d.nota] : 'Sin responder'}</span>
            </div>
            <div className="examen-enunciado">
              <Markdown {...conMates}>{d.enunciado}</Markdown>
            </div>
            <p className="examen-tuya">
              <small>Tu respuesta</small>
              {d.respuesta || <em>Sin responder</em>}
            </p>
            {d.explicacion && (
              <div className="examen-correccion">
                <Markdown {...conMates}>{d.explicacion}</Markdown>
              </div>
            )}
            {d.referencia && (
              <details>
                <summary>Ver la respuesta de referencia</summary>
                <Markdown {...conMates}>{d.referencia}</Markdown>
              </details>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

// Modo Examen: preparas, haces (en modo foco), corriges y ves la nota con la revisión.
export default function PanelExamen({ irA }: { irA: (m: IdModo) => void }) {
  const [examen, setExamen] = useState<Examen | null>(null)
  const [resultado, setResultado] = useState<Resumen | null>(null)
  const [vuelta, setVuelta] = useState(0)

  if (examen)
    return (
      <Haciendo
        examen={examen}
        alSalir={() => setExamen(null)}
        alAcabar={(r) => {
          if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
          setExamen(null)
          setResultado(r)
        }}
      />
    )
  if (resultado)
    return (
      <Resultado
        resumen={resultado}
        irA={irA}
        alVolver={() => {
          setResultado(null)
          setVuelta((v) => v + 1)
        }}
      />
    )
  return <Preparar key={vuelta} alEmpezar={setExamen} irA={irA} />
}
