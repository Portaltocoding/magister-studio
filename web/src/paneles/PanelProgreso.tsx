import { useEffect, useMemo, useState } from 'react'
import { listarPlanes, pedir, verPlan, type ResumenPlan, type VistaPlan } from '../api.ts'
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

const LECCION: Record<string, string> = { hecha: 'Hecha', empezada: 'En curso', pendiente: 'Pendiente' }

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

// Una barra por estado, proporcional al número de conceptos.
function BarraDominio({ conceptos }: { conceptos: Concepto[] }) {
  if (!conceptos.length) return <span className="pg-dominio vacia" />
  return (
    <span className="pg-dominio" role="img" aria-label={ESTADOS.map((e) => `${conceptos.filter((c) => c.estado === e.id).length} ${e.nombre}`).join(', ')}>
      {ESTADOS.map((e) => {
        const n = conceptos.filter((c) => c.estado === e.id).length
        return n ? <span key={e.id} className={`pg-${e.id}`} style={{ flexGrow: n }} title={`${n} ${e.nombre.toLowerCase()}`} /> : null
      })}
    </span>
  )
}

function Fiabilidad({ titulo, tramos }: { titulo: string; tramos: Tramo[] }) {
  return (
    <figure className="fiabilidad">
      <figcaption>{titulo}</figcaption>
      <svg viewBox="0 0 100 100" role="img" aria-label={titulo}>
        <line x1="0" y1="100" x2="100" y2="0" className="diagonal" />
        {tramos.map((t, i) => (
          <circle key={i} cx={t.predicho * 100} cy={100 - t.observado * 100} r={Math.min(6, 2 + Math.sqrt(t.n))} />
        ))}
      </svg>
      <small className="nota">{tramos.map((t) => `creías ${pct(t.predicho)}, acertaste ${pct(t.observado)} (${t.n})`).join(' · ')}</small>
    </figure>
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

  const elegirPlan = (p: ResumenPlan) => {
    setNombre(p.tema)
    verPlan(p.tema_id).then(setPlan)
    pedir<Record<string, EstadoMaterial>>(`/api/planes/${p.plan_id}/materiales`).then(setMateriales)
  }

  useEffect(() => {
    listarPlanes().then((ps) => {
      setPlanes(ps)
      if (ps[0]) elegirPlan(ps[0])
    })
    pedir<Resumen>('/api/progreso/resumen').then(setResumen)
    pedir<Concepto[]>('/api/progreso/conceptos').then(setConceptos)
    pedir<typeof carga>('/api/progreso/carga?dias=14').then(setCarga)
    pedir<Tramo[]>('/api/progreso/calibracion?fuente=usuario').then(setTuya)
    pedir<Tramo[]>('/api/progreso/calibracion?fuente=modelo').then(setModelo)
    pedir<Hoy>('/api/hoy').then(setHoy)
  }, [])

  const delPlan = useMemo(() => conceptos.filter((c) => !plan || c.plan_id === plan.plan_id), [conceptos, plan])

  if (planes == null) return <p className="vacio">Cargando…</p>

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
                  title={`${l.clave} · ${l.titulo}: ${horas(l.horas_hechas)} de ${horas(l.horas)}`}
                  onClick={() => setAbierta(l.clave)}
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
                    <BarraDominio conceptos={suyos} />
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
              <div className="pg-barras" role="img" aria-label="Repasos previstos por día">
                {carga.map((c) => (
                  <div
                    key={c.fecha}
                    className={`pg-barra-dia ${c.fecha === hoyIso ? 'hoy' : ''}`}
                    title={`${fechaCorta(c.fecha)}: ${plural(c.repasos, 'repaso', 'repasos')}, ${c.minutos} min`}
                  >
                    {c.repasos > 0 && <b>{c.repasos}</b>}
                    <span style={{ height: `${(c.repasos / maxCarga) * 100}%` }} />
                    <small>{c.fecha === hoyIso ? 'hoy' : new Date(c.fecha + 'T12:00:00').getDate()}</small>
                  </div>
                ))}
              </div>
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
                <Fiabilidad titulo="Tu seguridad" tramos={tuya} />
                <Fiabilidad titulo="La apuesta del tutor" tramos={modelo} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
