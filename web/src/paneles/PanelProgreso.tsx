import { useEffect, useState } from 'react'
import { pedir } from '../api.ts'

interface Concepto {
  plan_id: number
  concepto_id: string
  nombre: string
  leccion_clave: string
  p: number
  estado: 'nuevo' | 'flojo' | 'aprendiendo' | 'dominado'
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
}

type Tramo = { predicho: number; observado: number; n: number }

const pct = (x: number) => `${Math.round(x * 100)} %`

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
      <small className="nota">{tramos.length ? tramos.map((t) => `${pct(t.predicho)}→${pct(t.observado)} (${t.n})`).join(' · ') : 'Sin datos todavía'}</small>
    </figure>
  )
}

// Progreso: el camino, el dominio por concepto, la carga de los próximos días y tu calibración.
export default function PanelProgreso() {
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [conceptos, setConceptos] = useState<Concepto[]>([])
  const [carga, setCarga] = useState<{ fecha: string; repasos: number; minutos: number }[]>([])
  const [tuya, setTuya] = useState<Tramo[]>([])
  const [modelo, setModelo] = useState<Tramo[]>([])
  const [elegido, setElegido] = useState<Concepto | null>(null)

  useEffect(() => {
    pedir<Resumen>('/api/progreso/resumen').then(setResumen)
    pedir<Concepto[]>('/api/progreso/conceptos').then(setConceptos)
    pedir<typeof carga>('/api/progreso/carga?dias=14').then(setCarga)
    pedir<Tramo[]>('/api/progreso/calibracion?fuente=usuario').then(setTuya)
    pedir<Tramo[]>('/api/progreso/calibracion?fuente=modelo').then(setModelo)
  }, [])

  const maxCarga = Math.max(1, ...carga.map((c) => c.repasos))
  const lecciones = [...new Set(conceptos.map((c) => `${c.plan_id}:${c.leccion_clave}`))]

  return (
    <div className="panel">
      <h1>Progreso</h1>
      {resumen && (
        <div className="tarjetas">
          <div className="tarjeta">
            <strong>{pct(resumen.camino)}</strong>
            <span className="nota">
              del camino ({resumen.horas_hechas} de {resumen.horas_plan} h)
            </span>
          </div>
          <div className="tarjeta">
            <strong>
              {resumen.dominados} de {resumen.conceptos}
            </strong>
            <span className="nota">conceptos dominados</span>
          </div>
          <div className="tarjeta">
            <strong>{resumen.racha} días</strong>
            <span className="nota">de racha · {resumen.dias_estudiados} días estudiados</span>
          </div>
          <div className="tarjeta">
            <strong>{resumen.minutos_practica} min</strong>
            <span className="nota">de repaso</span>
          </div>
        </div>
      )}
      <h2>Conceptos</h2>
      {conceptos.length === 0 && <p className="vacio">Aún no hay conceptos: acepta un plan en Roadmap.</p>}
      {lecciones.map((l) => (
        <div key={l} className="fila-lecciones">
          <span className="nota-linea">{l.split(':')[1]}</span>
          {conceptos
            .filter((c) => `${c.plan_id}:${c.leccion_clave}` === l)
            .map((c) => (
              <button
                key={c.concepto_id}
                className={`chip concepto-${c.estado}`}
                title={`${c.estado} · p ${pct(c.p)}`}
                onClick={() => setElegido(c)}
              >
                {c.nombre}
              </button>
            ))}
        </div>
      ))}
      {elegido && (
        <section className="propuesta">
          <h2>{elegido.nombre}</h2>
          <p className="nota">
            {elegido.estado} · probabilidad de recordarlo ahora {pct(elegido.p)} · {elegido.aciertos} aciertos,{' '}
            {elegido.fallos} fallos
            {elegido.proxima ? ` · próximo repaso ${new Date(elegido.proxima).toLocaleDateString('es-ES')}` : ''}
          </p>
          <ul className="nota">
            {elegido.repasos.map((r) => (
              <li key={r.momento}>
                {new Date(r.momento).toLocaleDateString('es-ES')}: {r.nota}
              </li>
            ))}
          </ul>
        </section>
      )}
      <h2>Carga de los próximos 14 días</h2>
      <div className="barras" role="img" aria-label="Repasos previstos por día">
        {carga.map((c) => (
          <div key={c.fecha} className="barra-dia" title={`${c.fecha}: ${c.repasos} repasos, ${c.minutos} min`}>
            <span style={{ height: `${(c.repasos / maxCarga) * 100}%` }} />
            <small>{new Date(c.fecha + 'T12:00:00').getDate()}</small>
          </div>
        ))}
      </div>
      <h2>Calibración</h2>
      <div className="dos-columnas">
        <Fiabilidad titulo="Tu confianza frente a tus aciertos" tramos={tuya} />
        <Fiabilidad titulo="La apuesta del tutor frente a tus aciertos" tramos={modelo} />
      </div>
    </div>
  )
}
