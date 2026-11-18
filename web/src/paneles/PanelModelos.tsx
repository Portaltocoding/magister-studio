import { useEffect, useState } from 'react'
import { pedir } from '../api.ts'
import './modelos.css'

interface Calidad {
  tono_juez: number | null
  n_tono_juez: number
  feedback_usuario: number | null
  n_feedback_usuario: number
}

interface Grupo {
  llamadas: number
  modelo_configurado: string
  modelos_respondidos: Record<string, number>
  coste_total: number
  coste_medio: number
  tokens_entrada_medios: number
  tokens_salida_medios: number
  cache_leida: number
  ttft_p50_ms: number | null
  ttft_p95_ms: number | null
  total_p50_ms: number | null
  total_p95_ms: number | null
  tasa_error: number
  reintentos_medios: number
  calidad: Calidad
}

interface Tarea extends Grupo {
  tarea: string
  hace: string
  interactiva: boolean
}

interface Plantilla extends Grupo {
  plantilla: string
  tarea: string
}

interface Recomendacion {
  tipo: string
  objeto: string
  gravedad: 'alta' | 'media' | 'baja'
  texto: string
  numero: string
}

interface Mapa {
  dias: number
  tareas: Tarea[]
  plantillas: Plantilla[]
  recomendaciones: Recomendacion[]
}

const usd = (x: number) => (x < 0.1 ? `${x.toFixed(3)} $` : `${x.toFixed(2)} $`)
const seg = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`)
const pct = (x: number) => `${Math.round(x * 100)} %`
const miles = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n))

// Qué dicen los datos sobre la calidad: el juez de tono y el pulgar, con cuántas valoraciones hay detrás.
function calidad(c: Calidad) {
  const partes: string[] = []
  if (c.tono_juez != null) partes.push(`juez ${pct(c.tono_juez)} (${c.n_tono_juez})`)
  if (c.feedback_usuario != null) partes.push(`tu pulgar ${pct(c.feedback_usuario)} (${c.n_feedback_usuario})`)
  return partes.length ? partes.join(' · ') : 'sin datos'
}

function modelos(g: Grupo) {
  const lista = Object.entries(g.modelos_respondidos)
  if (!lista.length) return '—'
  const distinto = lista.some(([m]) => !m.toLowerCase().includes(g.modelo_configurado.toLowerCase()))
  return (
    <span title={lista.map(([m, n]) => `${m}: ${n}`).join('\n')}>
      {lista[0][0]}
      {lista.length > 1 && ` +${lista.length - 1}`}
      {distinto && <span className="aviso-dudosa"> ≠ configurado</span>}
    </span>
  )
}

// Modelos: quién hace qué, en qué modelo, cuánto cuesta y qué tal sale. Las recomendaciones salen de reglas, no de un modelo.
export default function PanelModelos() {
  const [dias, setDias] = useState(30)
  const [mapa, setMapa] = useState<Mapa | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    pedir<Mapa>(`/api/modelos/mapa?dias=${dias}`)
      .then(setMapa)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el mapa.'))
  }, [dias])

  const total = mapa?.tareas.reduce((a, t) => a + t.coste_total, 0) ?? 0

  return (
    <div className="panel panel-modelos">
      <div className="cabecera-panel">
        <h1>Modelos</h1>
        <label className="nota">
          Periodo{' '}
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={7}>7 días</option>
            <option value={30}>30 días</option>
            <option value={90}>90 días</option>
          </select>
        </label>
      </div>
      <p className="nota">
        Qué modelo hace cada tarea y cuánto cuesta, con los datos de tus últimos {dias} días. El coste es el
        equivalente en API: con la suscripción no pagas por llamada.
      </p>
      {error && <p className="aviso-dudosa">{error}</p>}
      {!mapa && !error && <p className="vacio">Cargando…</p>}
      {mapa && (
        <>
          <h2>Qué conviene mirar</h2>
          {mapa.recomendaciones.length === 0 && <p className="vacio">Nada llamativo con los datos de ahora.</p>}
          <ul className="recomendaciones">
            {mapa.recomendaciones.map((r, i) => (
              <li key={i} className={`recomendacion gravedad-${r.gravedad}`}>
                <span>{r.texto}</span>
                <span className="nota-linea"> Dato: {r.numero}.</span>
              </li>
            ))}
          </ul>

          <h2>Por tarea</h2>
          <div className="tabla-ancha">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Tarea</th>
                  <th>Modelo</th>
                  <th>Coste</th>
                  <th>Caché</th>
                  <th>Rapidez</th>
                  <th>Calidad</th>
                </tr>
              </thead>
              <tbody>
                {mapa.tareas.map((t) => (
                  <tr key={t.tarea}>
                    <td>
                      <strong>{t.tarea}</strong>
                      <div className="nota-linea">{t.hace}</div>
                    </td>
                    <td>
                      <div>{t.modelo_configurado}</div>
                      <div className="nota-linea">responde: {modelos(t)}</div>
                    </td>
                    <td>
                      {t.llamadas === 0 ? (
                        <span className="vacio">sin uso</span>
                      ) : (
                        <>
                          {usd(t.coste_total)}
                          <div className="nota-linea">
                            {t.llamadas} llamadas · {usd(t.coste_medio)} cada una
                            {total > 0 && ` · ${pct(t.coste_total / total)} del total`}
                          </div>
                          <div className="nota-linea">
                            {miles(t.tokens_entrada_medios)} entra · {miles(t.tokens_salida_medios)} sale
                          </div>
                        </>
                      )}
                    </td>
                    <td>{t.llamadas ? pct(t.cache_leida) : '—'}</td>
                    <td>
                      {t.llamadas ? (
                        <>
                          {seg(t.total_p50_ms)} <span className="nota-linea">(casi siempre ≤ {seg(t.total_p95_ms)})</span>
                          {t.ttft_p50_ms != null && (
                            <div className="nota-linea">
                              empieza en {seg(t.ttft_p50_ms)} (≤ {seg(t.ttft_p95_ms)})
                            </div>
                          )}
                          {(t.tasa_error > 0 || t.reintentos_medios > 0) && (
                            <div className="aviso-dudosa">
                              {pct(t.tasa_error)} con error · {t.reintentos_medios.toFixed(2)} reintentos
                            </div>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{t.llamadas ? calidad(t.calidad) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Por plantilla</h2>
          <p className="nota">Cada plantilla de prompt, de la que más gasta a la que menos.</p>
          <div className="tabla-ancha">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Plantilla</th>
                  <th>Tarea</th>
                  <th>Llamadas</th>
                  <th>Coste</th>
                  <th>Caché</th>
                  <th>Rapidez (mediana)</th>
                  <th>Calidad</th>
                </tr>
              </thead>
              <tbody>
                {mapa.plantillas.map((p) => (
                  <tr key={p.plantilla + p.tarea}>
                    <td>{p.plantilla}</td>
                    <td>{p.tarea}</td>
                    <td>{p.llamadas}</td>
                    <td>
                      {usd(p.coste_total)} <span className="nota-linea">({usd(p.coste_medio)} cada una)</span>
                    </td>
                    <td>{pct(p.cache_leida)}</td>
                    <td>{seg(p.total_p50_ms)}</td>
                    <td>{calidad(p.calidad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mapa.plantillas.length === 0 && <p className="vacio">Aún no hay llamadas en este periodo.</p>}
        </>
      )}
    </div>
  )
}
