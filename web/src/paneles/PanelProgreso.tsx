import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n/i18n.ts'
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
const ESTADOS: { id: EstadoConcepto; nombre: string; desc: string }[] = [
  { id: 'dominado', nombre: 'Dominado', desc: 'Lo recuerdas aunque pasen días' },
  { id: 'aprendiendo', nombre: 'Aprendiendo', desc: 'Lo vas fijando con repasos' },
  { id: 'flojo', nombre: 'Flojo', desc: 'Lo fallaste hace poco' },
  { id: 'nuevo', nombre: 'Sin practicar', desc: 'Aún no lo has repasado' },
]
const NOMBRE_ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.id, e.nombre])) as Record<EstadoConcepto, string>

const LECCION: Record<string, string> = { hecha: 'Estudiada', empezada: 'Empezada', pendiente: 'Pendiente' }

const pct = (x: number) => `${Math.round(x * 100)} %`
const horas = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} h`
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const fechaCorta = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

function material(e: EstadoMaterial | undefined): string {
  if (!e) return 'sin material'
  if (e.en_marcha) return 'generando material'
  if (e.tipos.apuntes) return `material listo · ${plural(e.fichas, 'ficha', 'fichas')}`
  return 'sin material'
}

type Sobre = ReturnType<typeof usarAviso>['sobre']

// Barra segmentada fina: de más a menos sabido; «sin practicar» es la pista neutra.
function BarraDominio({ conceptos, sobre }: { conceptos: Concepto[]; sobre: Sobre }) {
  if (!conceptos.length) return <span className="pg-dominio" />
  return (
    <span className="pg-dominio" role="group" aria-label="Dominio de los conceptos">
      {ESTADOS.map((e) => {
        const n = conceptos.filter((c) => c.estado === e.id).length
        return n ? (
          <span
            key={e.id}
            className={`pg-seg pg-${e.id}`}
            style={{ flexGrow: n }}
            {...sobre({ valor: plural(n, 'concepto', 'conceptos'), etiqueta: e.nombre.toLowerCase() })}
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
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line className="viz-rejilla" x1={px(0)} x2={px(1)} y1={py(t)} y2={py(t)} />
            <text className="viz-tick" x={px(0) - 6} y={py(t) + 4} textAnchor="end">
              {pct(t)}
            </text>
            <text className="viz-tick" x={px(t)} y={py(0) + 16} textAnchor="middle">
              {pct(t)}
            </text>
          </g>
        ))}
        <line className="viz-referencia" x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} />
        <text className="viz-nota-ref" x={px(0.56)} y={py(0.56) - 8} transform={`rotate(-41 ${px(0.56)} ${py(0.56) - 8})`}>
          calibración perfecta
        </text>
        <text className="viz-eje" x={(px(0) + px(1)) / 2} y={ALTO - 4} textAnchor="middle">
          Lo seguro que estabas
        </text>
        <text className="viz-eje" transform={`translate(11 ${(py(0) + py(1)) / 2}) rotate(-90)`} textAnchor="middle">
          Lo que acertaste
        </text>
        {tramos.map((t, i) => (
          <g
            key={i}
            {...sobre({ valor: `acertaste ${pct(t.observado)}`, etiqueta: `cuando decías ${pct(t.predicho)} · ${plural(t.n, 'respuesta', 'respuestas')}` })}
          >
            <circle className="viz-punto" cx={px(t.predicho)} cy={py(t.observado)} r={Math.min(7, 4 + Math.sqrt(t.n) / 2)} />
            <circle className="viz-zona" cx={px(t.predicho)} cy={py(t.observado)} r={12} />
          </g>
        ))}
      </svg>
    </figure>
  )
}

function TablaCalibracion({ tuya, modelo }: { tuya: Tramo[]; modelo: Tramo[] }) {
  return (
    <details className="viz-tabla">
      <summary>Ver como tabla</summary>
      <table>
        <thead>
          <tr>
            <th>Quién</th>
            <th>Seguridad</th>
            <th>Aciertos</th>
            <th>Respuestas</th>
          </tr>
        </thead>
        <tbody>
          {[...tuya.map((t) => ['Tú', t] as const), ...modelo.map((t) => ['Tutor', t] as const)].map(([q, t], i) => (
            <tr key={i}>
              <td>{q}</td>
              <td>{pct(t.predicho)}</td>
              <td>{pct(t.observado)}</td>
              <td>{t.n}</td>
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

const coma = (n?: number) => (n == null ? '·' : String(n).replace('.', ','))

// «Tu modelo»: cuándo olvidas tú, no la media. FSRS ajustado a tus repasos, por escalones y solo si mejora.
function TuModelo() {
  const [e, setE] = useState<EstadoModelo | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  useEffect(() => {
    pedir<EstadoModelo>('/api/progreso/modelo').then(setE).catch(() => undefined)
  }, [])
  if (!e) return null
  const etapa = e.activo ? (e.activo.etapa === 'completo' ? 'Ajustado entero a ti' : 'Ajustado a ti (estabilidad inicial)') : 'Por defecto'
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
          ? `Hecho: ahora predice tus aciertos mejor (pérdida ${String(r.perdida_antes).replace('.', ',')} → ${String(r.perdida_despues).replace('.', ',')}).`
          : (r.motivo ?? 'Sin cambios.'),
      )
    } catch (err) {
      setAviso(`No he podido ajustarlo: ${mensajeDe(err)}`)
    } finally {
      setHaciendo(false)
    }
  }
  return (
    <section className="pg-seccion tu-modelo">
      <h2>Tu modelo de olvido</h2>
      {e.resumen && (
        <div className="tu-modelo-capa" aria-label="En qué capa vas">
          {e.resumen.lineas.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
      <p className="pg-explica">
        Magister decide cuándo repasas con FSRS. Con tus repasos, aprende cuánto aguantas tú cada concepto y se reajusta solo una vez al
        día, solo si predice tus aciertos mejor que antes. Lo que fallas vuelve en la misma sesión, y lo recién aprendido vuelve
        pronto (a los 3 y a los 9 días como mucho).
      </p>
      <div className="tu-modelo-cifras">
        <div>
          <strong>{etapa}</strong>
          <small>{e.activo ? `desde el ${new Date(e.activo.fecha).toLocaleDateString('es-ES')}` : 'aún sin datos tuyos'}</small>
        </div>
        <div>
          <strong>
            {e.conceptos_con_dos} <small>de {siguiente}</small>
          </strong>
          <small>conceptos con dos repasos o más</small>
        </div>
        <div>
          <strong>{e.repasos}</strong>
          <small>repasos tuyos</small>
        </div>
      </div>
      <span className="barra">
        <span style={{ width: `${Math.min(100, (e.conceptos_con_dos / siguiente) * 100)}%` }} />
      </span>
      <p className="nota">
        <button className="boton-mini" onClick={ajustar} disabled={haciendo}>
          {haciendo ? 'Ajustando…' : 'Ajustar ahora'}
        </button>
      </p>
      {e.red && (
        <div className="tu-modelo-red">
          <h3>Red neuronal</h3>
          <p className="pg-explica">
            Encima de FSRS, una red pequeña aprende de lo que FSRS no ve: tu seguridad al responder, lo que tardas, la hora, tu
            racha y si te pasaste de seguro. Recién creada es igual que FSRS; se entrena cada día y solo decide cuando acierta más
            que FSRS con tus repasos más recientes, que no ha visto, en {e.red.racha_necesaria ?? 2} entrenamientos seguidos y con
            repasos nuevos entre uno y otro. Si luego pierde, vuelve a decidir FSRS.
          </p>
          <p>
            <strong>
              {e.red.estado === 'activa'
                ? 'Activa: decide ella'
                : e.red.estado === 'sombra'
                  ? e.red.racha
                    ? `En sombra: ha ganado ${e.red.racha} de ${e.red.racha_necesaria ?? 2} entrenamientos seguidos`
                    : 'En sombra: entrenada, aún no gana a FSRS'
                  : 'Esperando datos'}
            </strong>
            {e.red.estado === 'sin_datos'
              ? ` · ${e.red.repasos} de ${e.red.minimo} repasos para empezar a entrenarse`
              : ` · error en lo no visto: FSRS ${coma(e.red.perdida_fsrs)}, red ${coma(e.red.perdida_red)} (menos es mejor)`}
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
        <h1>Progreso</h1>
        <p role="alert" className="nota">No he podido cargar tu progreso. Comprueba que Magister sigue en marcha.</p>
        <button className="boton" onClick={() => setIntento((x) => x + 1)}>
          Reintentar
        </button>
      </div>
    ) : (
      <Pensando texto="Cargando tu progreso…" />
    )

  if (!planes.length)
    return (
      <div className="panel">
        <h1>Progreso</h1>
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
        <h1>Progreso</h1>
        {planes.length > 1 && (
          <span className="selector-tema">
          <span className="punto-tema" style={colorDeTema(plan?.tema_id, planes)?.estilo} aria-hidden="true" />
          <select
            aria-label="Plan"
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
          No he podido abrir «{falloPlan.tema}».{' '}
          <button type="button" className="boton-mini" onClick={() => elegirPlan(falloPlan)}>
            Reintentar
          </button>
        </p>
      )}

      {plan && (
        <section className="pg-hero">
          <div className="pg-hero-cifra">
            <strong>{pct(plan.progreso)}</strong>
            <span>del plan</span>
          </div>
          <div className="pg-hero-cuerpo">
            <p className="pg-etq">{nombre}</p>
            <div className="pg-tramos" role="img" aria-label={`${hechas} de ${lecciones.length} lecciones hechas`}>
              {lecciones.map((l) => (
                <button
                  key={l.clave}
                  className={`pg-tramo ${l.estado}`}
                  style={{ flexGrow: l.horas }}
                  onClick={() => setAbierta(l.clave)}
                  {...sobre({ valor: `${horas(l.horas_hechas)} de ${horas(l.horas)}`, etiqueta: `${l.clave} · ${l.titulo}` })}
                >
                  <span className="pg-tramo-relleno" style={{ width: `${Math.min(1, l.horas_hechas / (l.horas || 1)) * 100}%` }} />
                  <small>{l.clave}</small>
                </button>
              ))}
            </div>
            <p className="nota">
              {horas(plan.horas_hechas)} de {horas(plan.total_horas)} · {hechas} de {lecciones.length} lecciones hechas
              {plan.fin ? ` · acabas el ${fechaCorta(plan.fin)}` : ''}
            </p>
          </div>
          {(proxima || repasosPlan > 0) && (
            <div className="pg-siguiente">
              <span className="pg-etq">Lo siguiente</span>
              {proxima && (
                <>
                  <strong>
                    {proxima.clave} · {proxima.titulo}
                  </strong>
                  <button className="boton boton-principal" onClick={() => irARuta(`#/fichas/${plan.tema_id}/${proxima.clave}`)}>
                    {conMaterial(proxima.clave) ? 'Estudiarla' : 'Prepararla'}
                  </button>
                </>
              )}
              {repasosPlan > 0 && (
                <button className="boton" onClick={() => irA('repaso')} title="En Repaso salen junto a los de tus otros planes">
                  {plural(repasosPlan, 'repaso pendiente', 'repasos pendientes')} de este plan
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
              {hechas} <small>de {lecciones.length}</small>
            </strong>
            <span>lecciones hechas</span>
          </div>
          <div className="pg-cifra">
            <strong>
              {dominados} <small>de {delPlan.length}</small>
            </strong>
            <span>conceptos dominados</span>
            {dominados === 0 && <em>Se dominan acertándolos en repasos separados en el tiempo.</em>}
          </div>
          <div className="pg-cifra">
            <strong>{plural(resumen.racha, 'día', 'días')}</strong>
            <span>
              seguidos estudiando{plan ? ' (cualquier plan)' : ''} · {plural(resumen.dias_estudiados, 'día', 'días')}
              {plan ? ' con este plan' : ' en total'}
            </span>
          </div>
          <div className="pg-cifra">
            <strong>{resumen.minutos_practica} min</strong>
            <span>
              de repaso{plan ? ' en este plan' : ''}
              {resumen.intentos ? ` · ${plural(resumen.intentos, 'respuesta', 'respuestas')}` : ''}
            </span>
            {resumen.minutos_practica === 0 && <em>Aún no has repasado. Diez minutos al día bastan.</em>}
          </div>
        </div>
      )}

      <section className="pg-seccion">
        <div className="pg-seccion-cabecera">
          <h2>Lección a lección</h2>
          <ul className="pg-leyenda">
            {ESTADOS.map((e) => (
              <li key={e.id} title={e.desc}>
                <span className={`pg-punto pg-${e.id}`} />
                {e.nombre}
              </li>
            ))}
          </ul>
        </div>
        <p className="pg-explica">
          Los aciertos y fallos de cada concepto cuentan un repaso por día: el primer intento del día. Lo que repites ese mismo
          día, los reintentos y las vueltas de «otra vez» no suman, aunque sí los veas en Repaso.
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
                      <span className={`pg-estado ${l.estado}`}>{LECCION[l.estado]}</span> · {material(materiales[l.clave])}
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
                      {dom} de {suyos.length} dominados
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
                        <strong>{elegido.nombre}</strong>: {NOMBRE_ESTADO[elegido.estado].toLowerCase()}, {pct(elegido.p)} de
                        probabilidad de recordarlo ahora · {plural(elegido.aciertos, 'acierto', 'aciertos')},{' '}
                        {plural(elegido.fallos, 'fallo', 'fallos')} (un repaso por día)
                        {elegido.proxima ? ` · próximo repaso el ${fechaCorta(elegido.proxima)}` : ''}
                        {conMaterial(l.clave) && elegido.preguntas === 0
                          ? ' · no tiene preguntas, así que no entra en el repaso: regenera el material de la lección'
                          : conMaterial(l.clave) && elegido.preguntas === 1
                            ? ' · solo tiene una pregunta: si la fallas, vuelve la misma'
                            : ''}
                      </p>
                    )}
                    <div className="botones">
                      <button className="boton" onClick={() => plan && irARuta(`#/fichas/${plan.tema_id}/${l.clave}`)}>
                        {materiales[l.clave]?.tipos.apuntes ? 'Abrir sus apuntes y fichas' : 'Preparar su material'}
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
          <h2>Repasos de las próximas dos semanas</h2>
          {totalCarga === 0 ? (
            <p className="pg-explica">
              No tienes repasos programados. Cada vez que respondes en Repaso o en el tutor, el concepto vuelve justo antes de
              que lo olvides: aquí verás cuántos te tocan cada día.
            </p>
          ) : (
            <>
              <div className="viz-columnas" role="group" aria-label="Repasos previstos por día">
                {carga.map((c) => {
                  const destacar = c.repasos > 0 && (c.fecha === hoyIso || c.repasos === maxCarga)
                  return (
                    <div
                      key={c.fecha}
                      className={`viz-columna ${c.fecha === hoyIso ? 'hoy' : ''}`}
                      {...sobre({ valor: plural(c.repasos, 'repaso', 'repasos'), etiqueta: `${fechaCorta(c.fecha)} · unos ${Math.round(c.minutos)} min` })}
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
                    {c.fecha === hoyIso ? 'hoy' : new Date(c.fecha + 'T12:00:00').getDate()}
                  </small>
                ))}
              </div>
              <details className="viz-tabla">
                <summary>Ver como tabla</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Día</th>
                      <th>Repasos</th>
                      <th>Minutos</th>
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
                {plural(totalCarga, 'repaso', 'repasos')} en 14 días · unos {Math.round(carga.reduce((a, c) => a + c.minutos, 0))} min
              </p>
            </>
          )}
        </section>

        <TuModelo />

        <section className="pg-seccion">
          <h2>¿Aciertas tanto como crees?</h2>
          {respuestas < 10 ? (
            <>
              <p className="pg-explica">
                Al responder en Repaso dices lo seguro que estás. Con diez respuestas, aquí verás si tu seguridad cuadra con tus
                aciertos: es la mejor alarma contra el «me lo sé» que no es verdad.
              </p>
              <span className="barra">
                <span style={{ width: `${(respuestas / 10) * 100}%` }} />
              </span>
              <p className="nota">Llevas {respuestas} de 10.</p>
            </>
          ) : (
            <>
              <p className="pg-explica">Cada punto compara lo seguro que estabas con lo que acertaste. Sobre la diagonal, bien calibrado.</p>
              <div className="dos-columnas">
                <Fiabilidad titulo="Tu seguridad" tramos={tuya} sobre={sobre} />
                <Fiabilidad titulo="La apuesta del tutor" tramos={modelo} sobre={sobre} />
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
