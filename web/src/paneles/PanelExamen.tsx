import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Markdown from '../componentes/Markdown.tsx'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { enviarJson, flujo, listarPlanes, pedir, type ResumenPlan } from '../api.ts'
import { planActivo, recordarPlan } from '../componentes/planActivo.ts'
import { colorDeTema } from '../componentes/colorTema.ts'
import MarcoFoco, { pedirPantallaCompleta, reloj } from '../componentes/MarcoFoco.tsx'
import Pensando from '../componentes/Pensando.tsx'
import Cargando, { mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import { errorLegible } from '../componentes/errores.ts'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import type { IdModo } from '../modos.ts'
import { barajar } from '../barajar.ts'
import { idiomaActual, t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import { borrarExamen, claveExamen, contador, guardarExamen, leerExamen, MAX_RESPUESTA } from '../componentes/repaso.ts'

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

const confianzas = (): [number, string][] => [
  [0.25, t('examen.conf.025')],
  [0.5, t('examen.conf.05')],
  [0.75, t('examen.conf.075')],
  [0.95, t('examen.conf.095')],
]
const nombreNota = (n: Nota): string => t(`examen.nota.${n}`)
const PUNTOS: Record<string, number> = { perfecta: 10, bien: 8, parcial: 5, fallo: 0 }
const TIPOS_CONOCIDOS = ['conceptual', 'calculo', 'fallo', 'escenario', 'hablada', 'test']
const nombreTipo = (k: string): string => (TIPOS_CONOCIDOS.includes(k) ? t(`examen.tipo.${k}` as 'examen.tipo.test') : k)
const lengua = () => (idiomaActual() === 'en' ? 'en-GB' : 'es-ES')
// Un decimal, con la coma o el punto de cada idioma.
const decimal = (n: number) => (idiomaActual() === 'en' ? n.toFixed(1) : n.toFixed(1).replace('.', ','))
const conMates = { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] }
const color = (n: number) => (n >= 8 ? 'nota-alta' : n >= 5 ? 'nota-media' : 'nota-baja')
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString(lengua(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// Corrige una respuesta con el mismo corrector del repaso. Devuelve la nota y la explicación.
// Las tipo test se comparan con la opción buena, sin modelo. Si el corrector falla, lanza: quien llama
// lo enseña como «No se pudo corregir» en vez de inventarse un fallo.
// La clave es estable (examen y pregunta), la misma que usa el servidor al corregir de una vez: si aquello falló a
// medias o se repite, no se duplica el intento, se devuelve el que ya estaba.
async function corregir(examenId: number, p: PreguntaExamen, r: Respuesta, alTrozo?: (t: string) => void) {
  const clave = claveExamen(examenId, p.pregunta_id)
  if (p.opciones?.length) {
    const res = await pedir<{ acierto: boolean; porque: string }>(
      '/api/practica/test',
      enviarJson({ pregunta_id: p.pregunta_id, opcion: r.texto, confianza: r.confianza, clave }),
    )
    return { nota: (res.acierto ? 'bien' : 'fallo') as Nota, explicacion: res.porque, intento_id: undefined }
  }
  let nota: Nota | null = null
  let explicacion = ''
  let intento_id: string | undefined
  for await (const ev of flujo<{ tipo: string; nota?: Nota; t?: string; intento_id?: string; detalle?: string }>(
    '/api/practica/intentos',
    {
      pregunta_id: p.pregunta_id,
      concepto_id: p.concepto_id,
      respuesta: r.texto,
      confianza: r.confianza,
      clave,
    },
  )) {
    if (ev.tipo === 'nota' && ev.nota) nota = ev.nota
    else if (ev.tipo === 'delta' && ev.t) {
      explicacion += ev.t
      alTrozo?.(ev.t)
    } else if (ev.tipo === 'fin') intento_id = ev.intento_id
    else if (ev.tipo === 'error') throw new Error(ev.detalle || t('examen.noCorregir'))
  }
  if (nota === null) throw new Error(t('examen.noCorregir'))
  return { nota, explicacion, intento_id }
}

// ---------- Preparar ----------

function Preparar({ alEmpezar, irA }: { alEmpezar: (e: Examen) => void; irA: (m: IdModo) => void }) {
  usarIdioma() // los textos siguen al idioma
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

  const [falloCarga, setFalloCarga] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const reintentar = useCallback(() => {
    setFalloCarga(null)
    setIntento((x) => x + 1)
  }, [])
  useEffect(() => {
    listarPlanes()
      .then((ps) => {
        setPlanes(ps)
        const deLaRuta = ps.find((p) => p.plan_id === desdeRuta?.plan)
        if (deLaRuta) recordarPlan(deLaRuta.tema_id)
        setPlan(deLaRuta ?? planActivo(ps) ?? null)
      })
      .catch((e) => setFalloCarga(mensajeDe(e)))
    if (desdeRuta?.n) setCantidad(Math.min(20, desdeRuta.n))
    if (desdeRuta?.min) setMinutos(desdeRuta.min)
  }, [desdeRuta, intento])

  useEffect(() => {
    if (!plan) return
    pedir<OpcionLeccion[]>(`/api/planes/${plan.plan_id}/examen/opciones`)
      .then((o) => {
        setOpciones(o)
        setOpcionesDe(plan.plan_id)
        const con = o.filter((x) => x.preguntas > 0).map((x) => x.clave)
        const pedidas = desdeRuta?.lecciones.filter((c) => con.includes(c)) ?? []
        setElegidas(pedidas.length ? pedidas : con)
      })
      .catch((e) => setError(mensajeDe(e)))
    pedir<Resumen[]>(`/api/examenes?plan_id=${plan.plan_id}`)
      .then(setHistorial)
      .catch(() => undefined)
  }, [plan, desdeRuta])

  const disponibles = opciones.filter((o) => elegidas.includes(o.clave)).reduce((a, o) => a + o.preguntas, 0)

  // Si el plan elegido aún no tiene preguntas, los otros planes que sí: se dice cuál es cuál en vez de un «Sin
  // preguntas» a secas (que parecía de todo, no de este plan).
  const [otros, setOtros] = useState<ResumenPlan[]>([])
  const [opcionesDe, setOpcionesDe] = useState<number | null>(null)
  useEffect(() => {
    setOtros([])
    if (!plan || !planes || opcionesDe !== plan.plan_id || opciones.some((o) => o.preguntas > 0)) return
    let vivo = true
    Promise.all(
      planes
        .filter((p) => p.plan_id !== plan.plan_id)
        .map((p) =>
          pedir<OpcionLeccion[]>(`/api/planes/${p.plan_id}/examen/opciones`)
            .then((o) => (o.some((x) => x.preguntas > 0) ? p : null))
            .catch(() => null),
        ),
    ).then((xs) => vivo && setOtros(xs.filter((x): x is ResumenPlan => x != null)))
    return () => {
      vivo = false
    }
  }, [plan, planes, opciones, opcionesDe])

  if (planes == null) return falloCarga ? <Cargando error={falloCarga} reintentar={reintentar} /> : <Pensando texto={t('examen.cargando')} />
  if (!plan)
    return (
      <div className="panel">
        <h1>{t('examen.titulo')}</h1>
        <Vacio
          etiqueta={t('examen.sinPlan')}
          titulo={t('examen.sinPlanTitulo')}
          texto={t('examen.sinPlanTexto')}
          acciones={[{ texto: t('examen.crearPlan'), principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
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
        <h1>{t('examen.titulo')}</h1>
        {planes.length > 1 && (
          <span className="selector-tema">
          <span className="punto-tema" style={colorDeTema(plan.tema_id, planes)?.estilo} aria-hidden="true" />
          <select aria-label={t('examen.planAria')} value={plan.plan_id} onChange={(e) => {
              const p = planes.find((x) => x.plan_id === Number(e.target.value)) ?? null
              recordarPlan(p?.tema_id)
              setPlan(p)
            }}>
            {planes.map((p) => (
              <option key={p.plan_id} value={p.plan_id}>
                {p.tema}
              </option>
            ))}
          </select>
          </span>
        )}
      </div>

      {conPreguntas.length === 0 ? (
        <Vacio
          etiqueta={t('examen.sinPreguntas', { tema: plan.tema })}
          titulo={t('examen.preparaAlguna')}
          texto={t('examen.bancoTexto') + (otros.length ? t('examen.otrosPlanes', { lista: otros.map((o) => `«${o.tema}»`).join(', ') }) : '')}
          acciones={[
            { texto: t('examen.prepararLeccion'), principal: true, alPulsar: () => irA('fichas') },
            ...otros.slice(0, 3).map((o) => ({
              texto: t('examen.examinarmeDe', { tema: o.tema }),
              alPulsar: () => {
                recordarPlan(o.tema_id)
                setPlan(o)
              },
            })),
          ]}
        />
      ) : (
        <section className="examen-preparar">
          <div className="examen-modos">
            <button className={`opcion ${modo === 'examen' ? 'elegida' : ''}`} onClick={() => setModo('examen')}>
              <strong>{t('examen.modoExamen')}</strong>
              <small>{t('examen.modoExamenDesc')}</small>
            </button>
            <button className={`opcion ${modo === 'evaluacion' ? 'elegida' : ''}`} onClick={() => setModo('evaluacion')}>
              <strong>{t('examen.modoEval')}</strong>
              <small>{t('examen.modoEvalDesc')}</small>
            </button>
          </div>

          <h2>{t('examen.deQueLecciones')}</h2>
          <div className="examen-lecciones">
            {opciones.map((o) => (
              <button
                key={o.clave}
                className={`examen-leccion ${elegidas.includes(o.clave) ? 'elegida' : ''}`}
                disabled={o.preguntas === 0}
                onClick={() => setElegidas((x) => (x.includes(o.clave) ? x.filter((c) => c !== o.clave) : [...x, o.clave]))}
                title={o.preguntas ? t('examen.nPreguntas', { n: o.preguntas }) : t('examen.sinPrepararAyuda')}
              >
                <span className="bloques-clave">{o.clave}</span>
                <span>{o.titulo}</span>
                <small>{o.preguntas ? t('examen.nPreg', { n: o.preguntas }) : t('examen.sinPreparar')}</small>
              </button>
            ))}
          </div>

          <div className="examen-ajustes">
            <div>
              <h2>{t('examen.cuantas')}</h2>
              <div className="respuestas-rapidas">
                {[...new Set([5, 10, 15, 20, cantidad])].sort((a, b) => a - b).map((n) => (
                  <button key={n} className={`opcion opcion-chip ${cantidad === n ? 'elegida' : ''}`} disabled={n > disponibles && n !== 5} onClick={() => setCantidad(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <p className="nota">{t('examen.hay', { n: disponibles })}</p>
            </div>
            {modo === 'examen' && (
              <div>
                <h2>{t('examen.cuantoTiempo')}</h2>
                <div className="respuestas-rapidas">
                  {[...new Set([10, 20, 30, 45, ...(minutos && ![10, 20, 30, 45].includes(minutos) ? [minutos] : [])])].sort((a, b) => a - b).map((m) => (
                    <button key={m} className={`opcion opcion-chip ${minutos === m ? 'elegida' : ''}`} onClick={() => setMinutos(m)}>
                      {t('examen.min', { m })}
                    </button>
                  ))}
                  <button className={`opcion opcion-chip ${minutos == null ? 'elegida' : ''}`} onClick={() => setMinutos(null)}>
                    {t('examen.sinLimite')}
                  </button>
                </div>
              </div>
            )}
          </div>
          {error && <TextoError texto={error} />}
          <div className="vacio-acciones">
            <button className="boton boton-principal" disabled={!elegidas.length || !disponibles} onClick={empezar}>
              {modo === 'examen' ? t('examen.empezarExamen') : t('examen.empezarEval')}
            </button>
            <span className="nota">{t('examen.seAbre')}</span>
          </div>
        </section>
      )}

      {historial.length > 0 && (
        <section className="pg-seccion">
          <h2>{t('examen.tusExamenes')}</h2>
          <ol className="examen-historial">
            {historial.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() =>
                    pedir<Resumen>(`/api/examenes/${h.id}`)
                      .then(setViendo)
                      .catch((e) => setError(t('examen.noAbrir', { motivo: (e as Error).message })))
                  }
                >
                  <strong className={`examen-nota-mini ${color(h.nota ?? 0)}`}>{decimal(h.nota ?? 0)}</strong>
                  <span>
                    {t('examen.preguntasN', { modo: h.modo === 'examen' ? t('examen.modoExamen') : t('examen.modoEval'), lecciones: h.lecciones.join(', '), n: h.preguntas })}
                  </span>
                  <small>
                    {fecha(h.creado)}
                    {h.segundos ? ` · ${reloj(h.segundos)}` : ''}
                  </small>
                </button>
                <button
                  className="borrar"
                  aria-label={t('examen.quitarAria')}
                  title={t('examen.quitarAyuda')}
                  onClick={async () => {
                    if (!confirm(t('examen.quitarConfirmar'))) return
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

function Haciendo({
  examen,
  alAcabar,
  alSalir,
  guardado,
}: {
  examen: Examen
  alAcabar: (r: Resumen) => void
  alSalir: () => void
  guardado?: { respuestas: Record<string, Respuesta>; i: number; inicio: number } | null
}) {
  usarIdioma() // los textos siguen al idioma
  const { preguntas } = examen
  const evaluacion = examen.modo === 'evaluacion'
  const [i, setI] = useState(() => Math.min(Math.max(0, guardado?.i ?? 0), preguntas.length - 1))
  const [resp, setResp] = useState<Record<string, Respuesta>>(() => guardado?.respuestas ?? {})
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

  // El tiempo sale del reloj, no de sumar ticks: con la pestaña oculta o el portátil suspendido, setInterval se para.
  // Al recargar, sigue desde cuando empezaste (el reloj del examen no vuelve a cero).
  const inicio = useRef(guardado?.inicio ?? Date.now())

  // Lo que llevas, en sessionStorage a cada cambio: recargar a mitad no lo pierde. Mientras se corrige no se toca.
  useEffect(() => {
    if (!corrigiendo) guardarExamen({ examen, respuestas: resp, i, inicio: inicio.current })
  }, [examen, resp, i, corrigiendo])
  useEffect(() => {
    if (corrigiendo) return
    const t = setInterval(() => setSegundos(Math.floor((Date.now() - inicio.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [corrigiendo])

  // Recargar o cerrar la pestaña con respuestas sin entregar las pierde: el navegador avisa antes.
  const sinEntregar = contestadas > 0 && !corrigiendo
  useEffect(() => {
    if (!sinEntregar) return
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [sinEntregar])

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
          const c = await corregir(examen.id, q, finales[q.pregunta_id])
          finales[q.pregunta_id] = { ...finales[q.pregunta_id], ...c }
        } catch {
          finales[q.pregunta_id] = { ...finales[q.pregunta_id], nota: null, explicacion: t('examen.noCorregirPunto') }
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
    try {
      const c = await corregir(examen.id, p, r, (t) =>
        setResp((x) => ({ ...x, [p.pregunta_id]: { ...x[p.pregunta_id], explicacion: (x[p.pregunta_id]?.explicacion ?? '') + t } })),
      )
      setResp((x) => ({ ...x, [p.pregunta_id]: { ...x[p.pregunta_id], nota: c.nota, intento_id: c.intento_id, explicacion: c.explicacion } }))
    } catch (e) {
      // Sin esto se quedaba en «Corrigiendo…» para siempre; así se puede volver a comprobar.
      setResp((x) => ({ ...x, [p.pregunta_id]: { ...x[p.pregunta_id], nota: null, explicacion: t('examen.noCorregirla', { motivo: errorLegible(mensajeDe(e)).mensaje }) } }))
    } finally {
      setCorrigiendoUna(false)
    }
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
      titulo={evaluacion ? t('examen.modoEval') : t('examen.modoExamen')}
      placa={evaluacion ? 'EV' : 'EX'}
      alSalir={() => {
        if (corrigiendo || confirm(t('examen.salirConfirmar'))) alSalir()
      }}
      teclas={teclas}
      pasos={
        <ol className="foco-pasos" aria-label={t('examen.preguntasAria')}>
          {preguntas.map((q, k) => {
            const x = resp[q.pregunta_id]
            return (
              <li key={q.pregunta_id}>
                <button
                  className={`foco-paso corto ${k === i ? 'actual' : ''} ${x?.nota ? `nota-${x.nota}` : x?.texto.trim() ? 'vista' : ''} ${x?.marcada ? 'marcada' : ''}`}
                  aria-label={t('examen.preguntaN', { n: k + 1 })}
                  disabled={!!corrigiendo}
                  onClick={() => setI(k)}
                />
              </li>
            )
          })}
        </ol>
      }
      reloj={
        <span className={`foco-reloj ${queda != null && queda < 60 ? 'pausado' : ''}`} title={queda != null ? t('examen.tiempoQueda') : t('examen.tiempo')}>
          {queda != null ? `⏳ ${reloj(queda)}` : reloj(segundos)}
        </span>
      }
      pie={
        !corrigiendo && (
          <>
            <button className="boton" disabled={i === 0} onClick={() => setI(i - 1)}>
              {t('examen.anterior')}
            </button>
            <span className="foco-atajos">
              {t('examen.contestadas', { n: contestadas, total: preguntas.length })}
            </span>
            {!evaluacion && (
              <button className="boton-mini" aria-pressed={r.marcada} onClick={() => poner({ marcada: !r.marcada })}>
                {r.marcada ? t('examen.marcada') : t('examen.marcar')}
              </button>
            )}
            {!ultimo && (
              <button className={`boton ${evaluacion && !corregida ? '' : 'boton-principal'}`} onClick={() => setI(i + 1)}>
                {t('examen.siguiente')}
              </button>
            )}
            {(ultimo || !evaluacion) && (
              <button className={`boton ${ultimo ? 'boton-principal' : ''}`} onClick={() => (contestadas < preguntas.length ? setConfirmar(true) : entregar())}>
                {evaluacion ? t('examen.terminar') : t('examen.entregar')}
              </button>
            )}
          </>
        )
      }
    >
      {corrigiendo ? (
        <section className="foco-descanso">
          <span className="foco-etq">{t('examen.corrigiendo')}</span>
          <div className="examen-corrigiendo">
            <Pensando />
          </div>
          <p>
            {corrigiendo.deUnaVez
              ? t('examen.corrigiendoVez', { n: corrigiendo.total })
              : t('examen.corrigiendoUna', { hechas: corrigiendo.hechas, total: corrigiendo.total })}
          </p>
        </section>
      ) : (
        <article className="foco-idea examen-pregunta">
          <span className="foco-etq">
            {t('examen.preguntaDe', { i: i + 1, total: preguntas.length, leccion: p.leccion_clave, tipo: nombreTipo(p.tipo) })}
          </span>
          <div className="examen-enunciado">
            <Markdown {...conMates}>{p.enunciado}</Markdown>
          </div>
          {p.opciones && p.opciones.length > 0 ? (
            <div className="examen-test">
              {barajar(p.opciones, p.pregunta_id).map((o, k) => (
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
          <>
          <textarea
            className="examen-respuesta"
            value={r.texto}
            disabled={corregida || corrigiendoUna}
            maxLength={MAX_RESPUESTA}
            onChange={(e) => poner({ texto: e.target.value })}
            placeholder={t('examen.tuRespuestaPh')}
            aria-label={t('examen.tuRespuesta')}
            autoFocus
          />
          {!corregida && contador(r.texto.length).visible && (
            <p className="nota" aria-live="polite">
              {t('examen.caracteres', { texto: contador(r.texto.length).texto })}
            </p>
          )}
          </>
          )}
          <div className="foco-confianza">
            <span>{t('examen.comoSeguro')}</span>
            {confianzas().map(([v, nombre]) => (
              <button key={v} className="opcion opcion-chip" data-elegida={r.confianza === v} disabled={corregida} onClick={() => poner({ confianza: v })}>
                {nombre}
              </button>
            ))}
            {evaluacion && !corregida && (
              <button
                className="boton boton-principal"
                disabled={!r.texto.trim() || r.texto.trim().length > MAX_RESPUESTA || corrigiendoUna}
                onClick={comprobarAhora}
              >
                {corrigiendoUna ? t('examen.corrigiendoPunto') : t('examen.comprobar')}
              </button>
            )}
          </div>
          {evaluacion && (corrigiendoUna || r.explicacion) && (
            <div className={`correccion nota-${r.nota ?? ''}`}>
              {/* «Leyendo…» solo mientras se corrige: si falló, se queda el motivo y se puede volver a comprobar. */}
              {r.nota ? <strong>{nombreNota(r.nota)}</strong> : corrigiendoUna ? <Pensando texto={t('examen.leyendo')} /> : null}
              <Markdown {...conMates}>{r.explicacion ?? ''}</Markdown>
            </div>
          )}
          {confirmar && (
            <div className="foco-aviso examen-confirmar" role="alertdialog">
              {t('examen.sinContestar', { n: preguntas.length - contestadas })}
              <button className="boton boton-principal" onClick={entregar}>
                {t('examen.entregarIgual')}
              </button>
              <button className="boton" onClick={() => setConfirmar(false)}>
                {t('examen.seguir')}
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
  usarIdioma() // los textos siguen al idioma
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
          <span className="pg-etq">{resumen.modo === 'examen' ? t('examen.modoExamen') : t('examen.modoEval')} · {fecha(resumen.creado)}</span>
          <strong>{decimal(nota)}</strong>
          <span>{t('examen.sobre10')}{resumen.segundos ? t('examen.enTiempo', { reloj: reloj(resumen.segundos) }) : ''}</span>
        </div>
        <ul className="examen-por-leccion">
          {porLeccion.map((l) => (
            <li key={l.clave}>
              <span className="bloques-clave">{l.clave}</span>
              <span className="barra">
                <span style={{ width: `${l.nota * 10}%` }} />
              </span>
              <small>{decimal(l.nota)}</small>
            </li>
          ))}
        </ul>
        <div className="botones">
          {falladas > 0 && (
            <button className="boton boton-principal" onClick={() => irA('repaso')}>
              {t('examen.repasar', { n: falladas })}
            </button>
          )}
          <button className="boton" onClick={alVolver}>
            {t('examen.otro')}
          </button>
        </div>
      </section>

      <ol className="examen-revision">
        {detalle.map((d, k) => (
          <li key={d.pregunta_id} className={`nota-borde-${d.nota ?? 'fallo'}`}>
            <div className="examen-revision-cabecera">
              <span className="foco-etq">
                {k + 1} · {d.leccion_clave} · {nombreTipo(d.tipo)}
              </span>
              <span className={`chip nota-${d.nota ?? 'fallo'}`}>{d.nota ? nombreNota(d.nota) : t('examen.sinResponder')}</span>
            </div>
            <div className="examen-enunciado">
              <Markdown {...conMates}>{d.enunciado}</Markdown>
            </div>
            <p className="examen-tuya">
              <small>{t('examen.tuResp')}</small>
              {d.respuesta || <em>{t('examen.sinResponder')}</em>}
            </p>
            {d.explicacion && (
              <div className="examen-correccion">
                <Markdown {...conMates}>{d.explicacion}</Markdown>
              </div>
            )}
            {d.referencia && (
              <details>
                <summary>{t('examen.verReferencia')}</summary>
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
  // Si recargaste a mitad de un examen, vuelve con lo que llevabas (sessionStorage, por examen).
  const [guardado] = useState(() => leerExamen<Examen, Respuesta>())
  const [examen, setExamen] = useState<Examen | null>(() => guardado?.examen ?? null)
  const [resultado, setResultado] = useState<Resumen | null>(null)
  const [vuelta, setVuelta] = useState(0)

  if (examen)
    return (
      <Haciendo
        examen={examen}
        guardado={guardado && guardado.examen.id === examen.id ? guardado : null}
        alSalir={() => {
          borrarExamen()
          setExamen(null)
        }}
        alAcabar={(r) => {
          borrarExamen()
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
