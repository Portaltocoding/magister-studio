import { useEffect, useMemo, useState } from 'react'
import { listarPlanes, pedir, verPlan, type ResumenPlan, type VistaPlan } from '../api.ts'
import { usarAviso } from '../componentes/Aviso.tsx'
import Pensando from '../componentes/Pensando.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import type { IdModo } from '../modos.ts'

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

interface Hoy {
  estado: string
  leccion_clave?: string
  titulo?: string
  repasos: number
  material_id?: number | null
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
  const [hoy, setHoy] = useState<Hoy | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [elegido, setElegido] = useState<Concepto | null>(null)
  const { sobre, nodo: aviso } = usarAviso()

  const elegirPlan = (p: ResumenPlan) => {
    setNombre(p.tema)
    verPlan(p.tema_id).then(setPlan)
    pedir<Record<string, EstadoMaterial>>(`/api/planes/${p.plan_id}/materiales`).then(setMateriales)
  }

  const [fallo, setFallo] = useState(false)
  const [intento, setIntento] = useState(0)

  // Todo llega junto y se pinta de una vez: así la pantalla no da saltos mientras carga.
  useEffect(() => {
    setFallo(false)
    Promise.all([
      listarPlanes(),
      pedir<Resumen>('/api/progreso/resumen'),
      pedir<Concepto[]>('/api/progreso/conceptos'),
      pedir<typeof carga>('/api/progreso/carga?dias=14'),
      pedir<Tramo[]>('/api/progreso/calibracion?fuente=usuario'),
      pedir<Tramo[]>('/api/progreso/calibracion?fuente=modelo'),
      pedir<Hoy>('/api/hoy'),
    ])
      .then(async ([ps, r, c, cg, tu, mo, h]) => {
        if (ps[0]) {
          const [v, m] = await Promise.all([verPlan(ps[0].tema_id), pedir<Record<string, EstadoMaterial>>(`/api/planes/${ps[0].plan_id}/materiales`)])
          setNombre(ps[0].tema)
          setPlan(v)
          setMateriales(m)
        }
        setResumen(r)
        setConceptos(c)
        setCarga(cg)
        setTuya(tu)
        setModelo(mo)
        setHoy(h)
        setPlanes(ps)
      })
      .catch(() => setFallo(true))
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
          etiqueta="Aún no hay nada que medir"
          titulo="Tu progreso aparece cuando tengas un plan"
          texto="Aquí verás cuánto llevas de cada lección, qué conceptos ya dominas y qué repasos te esperan los próximos días."
          pasos={[
            { titulo: 'Crea un plan', texto: 'Cuatro preguntas y el tutor te propone lecciones y calendario.' },
            { titulo: 'Estudia las lecciones', texto: 'Con el tutor, en modo foco, o leyendo sus apuntes.' },
            { titulo: 'Repasa', texto: 'Cada respuesta mueve tus conceptos hacia «Dominado».' },
          ]}
          acciones={[{ texto: 'Crear mi primer plan', principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
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

  return (
    <div className="panel progreso-panel">
      <div className="cabecera-panel">
        <h1>Progreso</h1>
        {planes.length > 1 && (
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
        )}
      </div>

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
          {hoy && (hoy.titulo || hoy.repasos > 0) && (
            <div className="pg-siguiente">
              <span className="pg-etq">Lo siguiente</span>
              {hoy.titulo && (
                <>
                  <strong>
                    {hoy.leccion_clave} · {hoy.titulo}
                  </strong>
                  <button className="boton boton-principal" onClick={() => (hoy.material_id ? irARuta('#/tutor/foco') : irA('tutor'))}>
                    {hoy.material_id ? 'Estudiarla en modo foco' : 'Prepararla'}
                  </button>
                </>
              )}
              {hoy.repasos > 0 && (
                <button className="boton" onClick={() => irA('repaso')}>
                  {plural(hoy.repasos, 'repaso pendiente', 'repasos pendientes')}
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
            <span>seguidos estudiando · {resumen.dias_estudiados} en total</span>
          </div>
          <div className="pg-cifra">
            <strong>{resumen.minutos_practica} min</strong>
            <span>de repaso{resumen.intentos ? ` · ${plural(resumen.intentos, 'respuesta', 'respuestas')}` : ''}</span>
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
                        {plural(elegido.fallos, 'fallo', 'fallos')}
                        {elegido.proxima ? ` · próximo repaso el ${fechaCorta(elegido.proxima)}` : ''}
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
