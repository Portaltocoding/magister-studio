import { useEffect, useMemo, useState } from 'react'
import { idiomaActual, t, type Clave } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import { localeActual, numero, pluralT } from '../componentes/formato.ts'
import { listarPlanes, pedir, verPlan, type ResumenPlan, type VistaPlan } from '../api.ts'
import { planActivo, recordarPlan } from '../componentes/planActivo.ts'
import { colorDeTema } from '../componentes/colorTema.ts'
import { usarAviso } from '../componentes/Aviso.tsx'
import { mensajeDe } from '../componentes/Cargando.tsx'
import Pensando from '../componentes/Pensando.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import type { IdModo } from '../modos.ts'
import { repasosDelPlan, siguienteLeccion } from '../componentes/repaso.ts'

type EstadoConcepto = 'nuevo' | 'flojo' | 'aprendiendo' | 'dominado'

interface Concepto {
  plan_id: number
  concepto_id: string
  nombre: string
  leccion_clave: string
  p: number
  estado: EstadoConcepto
  aciertos: number
  fallos: number
  proxima: string | null
  repasos: { momento: string; nota: string }[]
  // Preguntas activas: con 0 nunca entra en el repaso; con 1, la vuelta de un fallo repite la misma.
  preguntas?: number
}

interface Resumen {
  camino: number
  horas_hechas: number
  horas_plan: number
  conceptos: number
  dominados: number
  dias_estudiados: number
  racha: number
  minutos_practica: number
  intentos?: number
}

interface EstadoMaterial {
  tipos: Record<string, string>
  fichas: number
  en_marcha: boolean
}

type Tramo = { predicho: number; observado: number; n: number }

// De más a menos sabido: así se leen las barras de izquierda a derecha.
const ESTADOS: { id: EstadoConcepto }[] = [{ id: 'dominado' }, { id: 'aprendiendo' }, { id: 'flojo' }, { id: 'nuevo' }]
const nombreEstado = (id: EstadoConcepto) => t(`progreso.est.${id}` as Clave)
const descEstado = (id: EstadoConcepto) => t(`progreso.est.${id}.d` as Clave)

const nombreLeccion = (estado: string) => (['hecha', 'empezada', 'pendiente'].includes(estado) ? t(`progreso.leccion.${estado}` as Clave) : estado)

const pct = (x: number) => `${Math.round(x * 100)}${idiomaActual() === 'en' ? '%' : ' %'}`
const horas = (h: number) => `${numero(h)} h`
const fechaCorta = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(localeActual(), { weekday: 'short', day: 'numeric', month: 'short' })

function material(e: EstadoMaterial | undefined): string {
  if (!e) return t('progreso.sinMaterial')
  if (e.en_marcha) return t('progreso.generando')
  if (e.tipos.apuntes) return t('progreso.listo', { fichas: pluralT(e.fichas, 'progreso.ficha', 'progreso.fichas') })
  return t('progreso.sinMaterial')
}

type Sobre = ReturnType<typeof usarAviso>['sobre']

// Barra segmentada fina: de más a menos sabido; «sin practicar» es la pista neutra.
function BarraDominio({ conceptos, sobre }: { conceptos: Concepto[]; sobre: Sobre }) {
  if (!conceptos.length) return <span className="pg-dominio" />
  return (
    <span className="pg-dominio" role="group" aria-label={t('progreso.dominioAria')}>
      {ESTADOS.map((e) => {
        const n = conceptos.filter((c) => c.estado === e.id).length
        return n ? (
          <span
            key={e.id}
            className={`pg-seg pg-${e.id}`}
            style={{ flexGrow: n }}
            {...sobre({ valor: pluralT(n, 'progreso.concepto', 'progreso.conceptos'), etiqueta: nombreEstado(e.id).toLowerCase() })}
          />
        ) : null
      })}
    </span>
  )
}

const ANCHO = 240
const ALTO = 210
const M = { izq: 40, der: 10, arr: 10, aba: 38 }
const px = (v: number) => M.izq + v * (ANCHO - M.izq - M.der)
const py = (v: number) => ALTO - M.aba - v * (ALTO - M.arr - M.aba)

function Fiabilidad({ titulo, tramos, sobre }: { titulo: string; tramos: Tramo[]; sobre: Sobre }) {
  return (
    <figure className="fiabilidad">
      <figcaption>{titulo}</figcaption>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="group" aria-label={titulo}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line className="viz-rejilla" x1={px(0)} x2={px(1)} y1={py(v)} y2={py(v)} />
            <text className="viz-tick" x={px(0) - 6} y={py(v) + 4} textAnchor="end">
              {pct(v)}
            </text>
            <text className="viz-tick" x={px(v)} y={py(0) + 16} textAnchor="middle">
              {pct(v)}
            </text>
          </g>
        ))}
        <line className="viz-referencia" x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} />
        <text className="viz-nota-ref" x={px(0.56)} y={py(0.56) - 8} transform={`rotate(-41 ${px(0.56)} ${py(0.56) - 8})`}>
          {t('progreso.calPerfecta')}
        </text>
        <text className="viz-eje" x={(px(0) + px(1)) / 2} y={ALTO - 4} textAnchor="middle">
          {t('progreso.ejeSeguro')}
        </text>
        <text className="viz-eje" transform={`translate(11 ${(py(0) + py(1)) / 2}) rotate(-90)`} textAnchor="middle">
          {t('progreso.ejeAcierto')}
        </text>
        {tramos.map((tr, i) => (
          <g
            key={i}
            {...sobre({
              valor: t('progreso.acertaste', { p: pct(tr.observado) }),
              etiqueta: t('progreso.cuandoDecias', { p: pct(tr.predicho), n: pluralT(tr.n, 'progreso.respuesta', 'progreso.respuestas') }),
            })}
          >
            <circle className="viz-punto" cx={px(tr.predicho)} cy={py(tr.observado)} r={Math.min(7, 4 + Math.sqrt(tr.n) / 2)} />
            <circle className="viz-zona" cx={px(tr.predicho)} cy={py(tr.observado)} r={12} />
          </g>
        ))}
      </svg>
    </figure>
  )
}

function TablaCalibracion({ tuya, modelo }: { tuya: Tramo[]; modelo: Tramo[] }) {
  return (
    <details className="viz-tabla">
      <summary>{t('progreso.verTabla')}</summary>
      <table>
        <thead>
          <tr>
            <th>{t('progreso.col.quien')}</th>
            <th>{t('progreso.col.seguridad')}</th>
            <th>{t('progreso.col.aciertos')}</th>
            <th>{t('progreso.col.respuestas')}</th>
          </tr>
        </thead>
        <tbody>
          {[...tuya.map((tr) => [t('progreso.tu'), tr] as const), ...modelo.map((tr) => [t('progreso.tutor'), tr] as const)].map(([q, tr], i) => (
            <tr key={i}>
              <td>{q}</td>
              <td>{pct(tr.predicho)}</td>
              <td>{pct(tr.observado)}</td>
              <td>{tr.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

interface EstadoModelo {
  conceptos_con_repasos: number
  conceptos_con_dos: number
  repasos: number
  umbral_inicial: number
  umbral_completo: number
  activo: { etapa: string; fecha: string; perdida_antes: number; perdida_despues: number; conceptos: number } | null
  red: {
    estado: 'sin_datos' | 'sombra' | 'activa'
    repasos: number
    minimo: number
    perdida_fsrs?: number
    perdida_red?: number
    fecha?: string
    racha?: number | null
    racha_necesaria?: number
  } | null
  // En qué capa vas y qué falta para la siguiente, ya redactado por el servidor (umbrales y recuentos salen de allí).
  resumen?: { capa: 'estandar' | 'inicial' | 'completo'; faltan: number | null; red: string; lineas: string[] }
}

const coma = (n?: number) => (n == null ? '·' : idiomaActual() === 'en' ? String(n) : String(n).replace('.', ','))

// «Tu modelo»: cuándo olvidas tú, no la media. FSRS ajustado a tus repasos, por escalones y solo si mejora.
function TuModelo() {
  const [e, setE] = useState<EstadoModelo | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  useEffect(() => {
    pedir<EstadoModelo>('/api/progreso/modelo').then(setE).catch(() => undefined)
  }, [])
  if (!e) return null
  const etapa = e.activo ? (e.activo.etapa === 'completo' ? t('progreso.modelo.entero') : t('progreso.modelo.inicial')) : t('progreso.modelo.defecto')
  const siguiente = e.conceptos_con_dos < e.umbral_inicial ? e.umbral_inicial : e.umbral_completo
  const ajustar = async () => {
    setHaciendo(true)
    try {
      const r = await pedir<{ hecho: boolean; motivo?: string | null; perdida_antes?: number; perdida_despues?: number; estado: EstadoModelo }>(
        '/api/progreso/modelo/ajustar',
        { method: 'POST' },
      )
      setE(r.estado)
      setAviso(
        r.hecho
          ? t('progreso.modelo.hecho', { antes: coma(r.perdida_antes), despues: coma(r.perdida_despues) })
          : (r.motivo ?? t('progreso.modelo.sinCambios')),
      )
    } catch (err) {
      setAviso(t('progreso.modelo.noAjusta', { motivo: mensajeDe(err) }))
    } finally {
      setHaciendo(false)
    }
  }
  return (
    <section className="pg-seccion tu-modelo">
      <h2>{t('progreso.modelo.titulo')}</h2>
      {e.resumen && (
        <div className="tu-modelo-capa" aria-label={t('progreso.modelo.capaAria')}>
          {e.resumen.lineas.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
      <p className="pg-explica">
        {t('progreso.modelo.explica')}
      </p>
      <div className="tu-modelo-cifras">
        <div>
          <strong>{etapa}</strong>
          <small>{e.activo ? t('progreso.modelo.desde', { fecha: new Date(e.activo.fecha).toLocaleDateString(localeActual()) }) : t('progreso.modelo.sinDatos')}</small>
        </div>
        <div>
          <strong>
            {e.conceptos_con_dos} <small>{t('progreso.de', { n: siguiente })}</small>
          </strong>
          <small>{t('progreso.modelo.conDos')}</small>
        </div>
        <div>
          <strong>{e.repasos}</strong>
          <small>{t('progreso.modelo.repasosTuyos')}</small>
        </div>
      </div>
      <span className="barra">
        <span style={{ width: `${Math.min(100, (e.conceptos_con_dos / siguiente) * 100)}%` }} />
      </span>
      <p className="nota">
        <button className="boton-mini" onClick={ajustar} disabled={haciendo}>
          {haciendo ? t('progreso.modelo.ajustando') : t('progreso.modelo.ajustar')}
        </button>
      </p>
      {e.red && (
        <div className="tu-modelo-red">
          <h3>{t('progreso.red.titulo')}</h3>
          <p className="pg-explica">
            {t('progreso.red.explica', { n: e.red.racha_necesaria ?? 2 })}
          </p>
          <p>
            <strong>
              {e.red.estado === 'activa'
                ? t('progreso.red.activa')
                : e.red.estado === 'sombra'
                  ? e.red.racha
                    ? t('progreso.red.sombraGana', { racha: e.red.racha, n: e.red.racha_necesaria ?? 2 })
                    : t('progreso.red.sombra')
                  : t('progreso.red.espera')}
            </strong>
            {e.red.estado === 'sin_datos'
              ? t('progreso.red.faltan', { repasos: e.red.repasos, minimo: e.red.minimo })
              : t('progreso.red.error', { fsrs: coma(e.red.perdida_fsrs), red: coma(e.red.perdida_red) })}
          </p>
          {e.red.estado === 'sin_datos' && (
            <span className="barra">
              <span style={{ width: `${Math.min(100, (e.red.repasos / e.red.minimo) * 100)}%` }} />
            </span>
          )}
        </div>
      )}
      {aviso && (
        <p className="nota" role="status">
          {aviso}
        </p>
      )}
    </section>
  )
}

// Progreso: dónde estás en el plan, lección a lección, y qué toca ahora.
export default function PanelProgreso({ irA }: { irA: (m: IdModo) => void }) {
  usarIdioma() // los textos siguen al idioma
  const [planes, setPlanes] = useState<ResumenPlan[] | null>(null)
  const [plan, setPlan] = useState<VistaPlan | null>(null)
  const [nombre, setNombre] = useState('')
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [conceptos, setConceptos] = useState<Concepto[]>([])
  const [materiales, setMateriales] = useState<Record<string, EstadoMaterial>>({})
  const [carga, setCarga] = useState<{ fecha: string; repasos: number; minutos: number }[]>([])
  const [tuya, setTuya] = useState<Tramo[]>([])
  const [modelo, setModelo] = useState<Tramo[]>([])
  // La cola de repaso es de todos los planes; aquí se cuentan los de este.
  const [cola, setCola] = useState<{ plan_id: number }[]>([])
  const [abierta, setAbierta] = useState<string | null>(null)
  const [elegido, setElegido] = useState<Concepto | null>(null)
  const { sobre, nodo: aviso } = usarAviso()

  // El plan que no se pudo abrir, para ofrecer «Reintentar».
  const [falloPlan, setFalloPlan] = useState<ResumenPlan | null>(null)
  const elegirPlan = (p: ResumenPlan) => {
    setFalloPlan(null)
    setNombre(p.tema)
    // Si falla, se queda el plan que estaba (y vuelve a poner su nombre) en vez de dejar la pantalla a medias.
    Promise.all([verPlan(p.tema_id), pedir<Record<string, EstadoMaterial>>(`/api/planes/${p.plan_id}/materiales`), cifrasDe(p.plan_id)])
      .then(([v, m, cifras]) => {
        recordarPlan(p.tema_id)
        setPlan(v)
        setMateriales(m)
        ponerCifras(cifras)
      })
      .catch(() => {
        setNombre((n) => (plan ? (planes?.find((x) => x.plan_id === plan.plan_id)?.tema ?? n) : n))
        setFalloPlan(p)
      })
  }

  const [fallo, setFallo] = useState(false)
  const [intento, setIntento] = useState(0)

  // Las cifras de un plan: con un plan elegido, todo lo que se enseña es de ese plan (la racha no: es de todos).
  const cifrasDe = (planId: number | null) => {
    const q = planId != null ? `plan_id=${planId}` : ''
    return Promise.all([
      pedir<Resumen>(`/api/progreso/resumen${q ? `?${q}` : ''}`),
      pedir<typeof carga>(`/api/progreso/carga?dias=14${q ? `&${q}` : ''}`),
      pedir<Tramo[]>(`/api/progreso/calibracion?fuente=usuario${q ? `&${q}` : ''}`),
      pedir<Tramo[]>(`/api/progreso/calibracion?fuente=modelo${q ? `&${q}` : ''}`),
    ])
  }
  const ponerCifras = ([r, cg, tu, mo]: Awaited<ReturnType<typeof cifrasDe>>) => {
    setResumen(r)
    setCarga(cg)
    setTuya(tu)
    setModelo(mo)
  }

  // Todo llega junto y se pinta de una vez: así la pantalla no da saltos mientras carga.
  useEffect(() => {
    setFallo(false)
    Promise.all([listarPlanes(), pedir<Concepto[]>('/api/progreso/conceptos'), pedir<{ plan_id: number }[]>('/api/practica/cola')])
      .then(async ([ps, c, co]) => {
        const activo = planActivo(ps)
        if (activo) {
          const [v, m, cifras] = await Promise.all([
            verPlan(activo.tema_id),
            pedir<Record<string, EstadoMaterial>>(`/api/planes/${activo.plan_id}/materiales`),
            cifrasDe(activo.plan_id),
          ])
          setNombre(activo.tema)
          setPlan(v)
          setMateriales(m)
          ponerCifras(cifras)
        } else ponerCifras(await cifrasDe(null))
        setConceptos(c)
        setCola(co)
        setPlanes(ps)
      })
      .catch(() => setFallo(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento])

  const delPlan = useMemo(() => conceptos.filter((c) => !plan || c.plan_id === plan.plan_id), [conceptos, plan])

  if (planes == null)
    return fallo ? (
      <div className="panel">
        <h1>{t('progreso.titulo')}</h1>
        <p role="alert" className="nota">{t('progreso.noCarga')}</p>
        <button className="boton" onClick={() => setIntento((x) => x + 1)}>
          {t('progreso.reintentar')}
        </button>
      </div>
    ) : (
      <Pensando texto={t('progreso.cargando')} />
    )

  if (!planes.length)
    return (
      <div className="panel">
        <h1>{t('progreso.titulo')}</h1>
        <Vacio
          etiqueta={t('vacio.progreso.etq')}
          titulo={t('vacio.progreso.titulo')}
          texto={t('vacio.progreso.texto')}
          pasos={[
            { titulo: t('vacio.progreso.p1.t'), texto: t('vacio.progreso.p1.x') },
            { titulo: t('vacio.progreso.p2.t'), texto: t('vacio.progreso.p2.x') },
            { titulo: t('vacio.progreso.p3.t'), texto: t('vacio.progreso.p3.x') },
          ]}
          acciones={[{ texto: t('vacio.progreso.crear'), principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  const lecciones = plan?.lecciones ?? []
  const hechas = lecciones.filter((l) => l.estado === 'hecha').length
  const dominados = delPlan.filter((c) => c.estado === 'dominado').length
  const totalCarga = carga.reduce((a, c) => a + c.repasos, 0)
  const maxCarga = Math.max(1, ...carga.map((c) => c.repasos))
  const respuestas = tuya.reduce((a, t) => a + t.n, 0)
  const hoyIso = carga[0]?.fecha
  // Lo siguiente de ESTE plan: su primera lección sin hacer y sus repasos pendientes (antes salía la de otro plan).
  const proxima = plan ? siguienteLeccion(lecciones) : null
  const repasosPlan = plan ? repasosDelPlan(cola, plan.plan_id) : 0
  const conMaterial = (clave: string) => !!materiales[clave]?.tipos.apuntes

  return (
    <div className="panel progreso-panel">
      <div className="cabecera-panel">
        <h1>{t('progreso.titulo')}</h1>
        {planes.length > 1 && (
          <span className="selector-tema">
          <span className="punto-tema" style={colorDeTema(plan?.tema_id, planes)?.estilo} aria-hidden="true" />
          <select
            aria-label={t('progreso.plan')}
            value={plan?.plan_id ?? ''}
            onChange={(e) => {
              const p = planes.find((x) => x.plan_id === Number(e.target.value))
              if (p) elegirPlan(p)
            }}
          >
            {planes.map((p) => (
              <option key={p.plan_id} value={p.plan_id}>
                {p.tema}
              </option>
            ))}
          </select>
          </span>
        )}
      </div>
      {falloPlan && (
        <p className="nota" role="alert">
          {t('progreso.noAbre', { tema: falloPlan.tema })}{' '}
          <button type="button" className="boton-mini" onClick={() => elegirPlan(falloPlan)}>
            {t('progreso.reintentar')}
          </button>
        </p>
      )}

      {plan && (
        <section className="pg-hero">
          <div className="pg-hero-cifra">
            <strong>{pct(plan.progreso)}</strong>
            <span>{t('progreso.delPlan')}</span>
          </div>
          <div className="pg-hero-cuerpo">
            <p className="pg-etq">{nombre}</p>
            <div className="pg-tramos" role="img" aria-label={t('progreso.leccionesHechasAria', { hechas, n: lecciones.length })}>
              {lecciones.map((l) => (
                <button
                  key={l.clave}
                  className={`pg-tramo ${l.estado}`}
                  style={{ flexGrow: l.horas }}
                  onClick={() => setAbierta(l.clave)}
                  {...sobre({ valor: t('progreso.horasDe', { a: horas(l.horas_hechas), b: horas(l.horas) }), etiqueta: `${l.clave} · ${l.titulo}` })}
                >
                  <span className="pg-tramo-relleno" style={{ width: `${Math.min(1, l.horas_hechas / (l.horas || 1)) * 100}%` }} />
                  <small>{l.clave}</small>
                </button>
              ))}
            </div>
            <p className="nota">
              {t('progreso.horasDe', { a: horas(plan.horas_hechas), b: horas(plan.total_horas) })} · {t('progreso.leccionesHechas', { hechas, n: lecciones.length })}
              {plan.fin ? t('progreso.acabas', { fecha: fechaCorta(plan.fin) }) : ''}
            </p>
          </div>
          {(proxima || repasosPlan > 0) && (
            <div className="pg-siguiente">
              <span className="pg-etq">{t('progreso.siguiente')}</span>
              {proxima && (
                <>
                  <strong>
                    {proxima.clave} · {proxima.titulo}
                  </strong>
                  <button className="boton boton-principal" onClick={() => irARuta(`#/fichas/${plan.tema_id}/${proxima.clave}`)}>
                    {conMaterial(proxima.clave) ? t('progreso.estudiarla') : t('progreso.prepararla')}
                  </button>
                </>
              )}
              {repasosPlan > 0 && (
                <button className="boton" onClick={() => irA('repaso')} title={t('progreso.repasoTitulo')}>
                  {t('progreso.repasosDeEstePlan', { n: pluralT(repasosPlan, 'progreso.repasoPend', 'progreso.repasosPend') })}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {resumen && (
        <div className="pg-cifras">
          <div className="pg-cifra">
            <strong>
              {hechas} <small>{t('progreso.de', { n: lecciones.length })}</small>
            </strong>
            <span>{t('progreso.leccionesHechasEtq')}</span>
          </div>
          <div className="pg-cifra">
            <strong>
              {dominados} <small>{t('progreso.de', { n: delPlan.length })}</small>
            </strong>
            <span>{t('progreso.conceptosDominados')}</span>
            {dominados === 0 && <em>{t('progreso.dominarSeguidos')}</em>}
          </div>
          <div className="pg-cifra">
            <strong>{pluralT(resumen.racha, 'progreso.dia', 'progreso.dias')}</strong>
            <span>
              {t('progreso.seguidos')}{plan ? t('progreso.cualquierPlan') : ''} · {pluralT(resumen.dias_estudiados, 'progreso.dia', 'progreso.dias')}
              {plan ? t('progreso.conEstePlan') : t('progreso.enTotal')}
            </span>
          </div>
          <div className="pg-cifra">
            <strong>{resumen.minutos_practica} min</strong>
            <span>
              {t('progreso.deRepaso')}{plan ? t('progreso.enEstePlan') : ''}
              {resumen.intentos ? ` · ${pluralT(resumen.intentos, 'progreso.respuesta', 'progreso.respuestas')}` : ''}
            </span>
            {resumen.minutos_practica === 0 && <em>{t('progreso.sinRepasar')}</em>}
          </div>
        </div>
      )}

      <section className="pg-seccion">
        <div className="pg-seccion-cabecera">
          <h2>{t('progreso.leccionALeccion')}</h2>
          <ul className="pg-leyenda">
            {ESTADOS.map((e) => (
              <li key={e.id} title={descEstado(e.id)}>
                <span className={`pg-punto pg-${e.id}`} />
                {nombreEstado(e.id)}
              </li>
            ))}
          </ul>
        </div>
        <p className="pg-explica">
          {t('progreso.unRepasoPorDia')}
        </p>
        <ol className="pg-lecciones">
          {lecciones.map((l) => {
            const suyos = delPlan.filter((c) => c.leccion_clave === l.clave)
            const dom = suyos.filter((c) => c.estado === 'dominado').length
            const abiertaEsta = abierta === l.clave
            return (
              <li key={l.clave} className={`pg-leccion ${l.estado} ${abiertaEsta ? 'abierta' : ''}`}>
                <button className="pg-fila" aria-expanded={abiertaEsta} onClick={() => setAbierta(abiertaEsta ? null : l.clave)}>
                  <span className="bloques-clave">{l.clave}</span>
                  <span className="pg-fila-titulo">
                    <strong>{l.titulo}</strong>
                    <small>
                      <span className={`pg-estado ${l.estado}`}>{nombreLeccion(l.estado)}</span> · {material(materiales[l.clave])}
                    </small>
                  </span>
                  <span className="pg-fila-horas">
                    <span className="barra">
                      <span style={{ width: `${Math.min(1, l.horas_hechas / (l.horas || 1)) * 100}%` }} />
                    </span>
                    <small>
                      {horas(l.horas_hechas)} de {horas(l.horas)}
                    </small>
                  </span>
                  <span className="pg-fila-dominio">
                    <BarraDominio conceptos={suyos} sobre={sobre} />
                    <small>
                      {t('progreso.dominadosDe', { dom, n: suyos.length })}
                    </small>
                  </span>
                  <span className="pg-flecha" aria-hidden>
                    ›
                  </span>
                </button>
                {abiertaEsta && (
                  <div className="pg-detalle">
                    <div className="pg-conceptos">
                      {suyos.map((c) => (
                        <button
                          key={c.concepto_id}
                          className={`pg-concepto pg-borde-${c.estado} ${elegido?.concepto_id === c.concepto_id ? 'elegido' : ''}`}
                          onClick={() => setElegido(elegido?.concepto_id === c.concepto_id ? null : c)}
                        >
                          <span className={`pg-punto pg-${c.estado}`} />
                          {c.nombre}
                        </button>
                      ))}
                    </div>
                    {elegido && elegido.leccion_clave === l.clave && (
                      <p className="pg-concepto-info">
                        <strong>{elegido.nombre}</strong>:{' '}
                        {t('progreso.conceptoInfo', {
                          estado: nombreEstado(elegido.estado).toLowerCase(),
                          p: pct(elegido.p),
                          aciertos: pluralT(elegido.aciertos, 'progreso.acierto', 'progreso.aciertos'),
                          fallos: pluralT(elegido.fallos, 'progreso.fallo', 'progreso.fallos'),
                        })}
                        {elegido.proxima ? t('progreso.proximoRepaso', { fecha: fechaCorta(elegido.proxima) }) : ''}
                        {conMaterial(l.clave) && elegido.preguntas === 0
                          ? t('progreso.sinPreguntas')
                          : conMaterial(l.clave) && elegido.preguntas === 1
                            ? t('progreso.unaPregunta')
                            : ''}
                      </p>
                    )}
                    <div className="botones">
                      <button className="boton" onClick={() => plan && irARuta(`#/fichas/${plan.tema_id}/${l.clave}`)}>
                        {materiales[l.clave]?.tipos.apuntes ? t('progreso.abrirApuntes') : t('progreso.prepararMaterial')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </section>

      <div className="pg-dos">
        <section className="pg-seccion">
          <h2>{t('progreso.proximasDos')}</h2>
          {totalCarga === 0 ? (
            <p className="pg-explica">
              {t('progreso.sinProgramados')}
            </p>
          ) : (
            <>
              <div className="viz-columnas" role="group" aria-label={t('progreso.previstosAria')}>
                {carga.map((c) => {
                  const destacar = c.repasos > 0 && (c.fecha === hoyIso || c.repasos === maxCarga)
                  return (
                    <div
                      key={c.fecha}
                      className={`viz-columna ${c.fecha === hoyIso ? 'hoy' : ''}`}
                      {...sobre({ valor: pluralT(c.repasos, 'progreso.repaso', 'progreso.repasos'), etiqueta: t('progreso.unosMin', { fecha: fechaCorta(c.fecha), min: Math.round(c.minutos) }) })}
                    >
                      <span className="viz-valor">{destacar ? c.repasos : ''}</span>
                      {c.repasos > 0 && <span className="viz-barra" style={{ height: `${(c.repasos / maxCarga) * 100}%` }} />}
                    </div>
                  )
                })}
              </div>
              <div className="viz-dias" aria-hidden>
                {carga.map((c) => (
                  <small key={c.fecha} className={c.fecha === hoyIso ? 'hoy' : ''}>
                    {c.fecha === hoyIso ? t('progreso.hoy') : new Date(c.fecha + 'T12:00:00').getDate()}
                  </small>
                ))}
              </div>
              <details className="viz-tabla">
                <summary>{t('progreso.verTabla')}</summary>
                <table>
                  <thead>
                    <tr>
                      <th>{t('progreso.col.dia')}</th>
                      <th>{t('progreso.col.repasos')}</th>
                      <th>{t('progreso.col.minutos')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carga.map((c) => (
                      <tr key={c.fecha}>
                        <td>{fechaCorta(c.fecha)}</td>
                        <td>{c.repasos}</td>
                        <td>{Math.round(c.minutos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <p className="nota">
                {t('progreso.en14', { n: pluralT(totalCarga, 'progreso.repaso', 'progreso.repasos'), min: Math.round(carga.reduce((a, c) => a + c.minutos, 0)) })}
              </p>
            </>
          )}
        </section>

        <TuModelo />

        <section className="pg-seccion">
          <h2>{t('progreso.aciertas')}</h2>
          {respuestas < 10 ? (
            <>
              <p className="pg-explica">
                {t('progreso.aciertasExplica')}
              </p>
              <span className="barra">
                <span style={{ width: `${(respuestas / 10) * 100}%` }} />
              </span>
              <p className="nota">{t('progreso.llevas', { n: respuestas })}</p>
            </>
          ) : (
            <>
              <p className="pg-explica">{t('progreso.cadaPunto')}</p>
              <div className="dos-columnas">
                <Fiabilidad titulo={t('progreso.tuSeguridad')} tramos={tuya} sobre={sobre} />
                <Fiabilidad titulo={t('progreso.apuestaTutor')} tramos={modelo} sobre={sobre} />
              </div>
              <TablaCalibracion tuya={tuya} modelo={modelo} />
            </>
          )}
        </section>
      </div>
      {aviso}
    </div>
  )
}
