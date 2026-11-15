import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  enviarJson,
  leerSSE,
  listarPlanes,
  pedir,
  verPlan,
  type ResumenPlan,
  type VistaPlan,
} from '../api.ts'
import Cuestionario, { type Respuestas } from '../componentes/Cuestionario.tsx'
import { PREGUNTAS_MATERIAL } from '../componentes/cuestionarios.ts'

interface MaterialInfo {
  id: number
  tipo: 'apuntes' | 'diapositivas' | 'guion'
  estado: 'generando' | 'listo' | 'revisar' | 'bloqueado'
  motivo: string | null
  ficheros: string[]
}

interface PreguntaInfo {
  id: string
  tipo: string
  enunciado: string
  fantasma: string
  donde: string | null
}

interface Trabajo {
  id: number
  estado: string
  nodo: string | null
  paso: number
  total: number
  avisos: { regla: string; detalle: string }[]
  error: string | null
}

interface MaterialLeccion {
  materiales: Record<string, MaterialInfo>
  preguntas: PreguntaInfo[]
  ultimo_trabajo: Trabajo | null
}

type EventoTrabajo =
  | { tipo: 'fase'; nodo: string; paso: number; total: number; estado: string }
  | { tipo: 'aviso'; regla: string; detalle: string }
  | { tipo: 'fin'; materiales: number[] }
  | { tipo: 'error'; detalle: string }

const NODOS: Record<string, string> = {
  pendiente: 'En cola',
  en_curso: 'Empezando',
  entrada: 'Preparando la lección',
  contrato: 'Decidiendo los bloques',
  escribir: 'Escribiendo',
  lint: 'Revisando el tono',
  juez: 'Juzgando el tono',
  refinar: 'Reescribiendo',
  aceptar: 'Guardando el bloque',
  montar: 'Montando los apuntes',
  completitud: 'Comprobando que no falte nada',
  ampliar: 'Ampliando lo que falta',
  preguntas: 'Escribiendo las preguntas',
  pintar: 'Pintando el PDF',
  diapositivas: 'Haciendo las diapositivas',
  guion: 'Escribiendo el guion',
}

const fichero = (m: MaterialInfo, nombre: string) => `/api/materiales/${m.id}/fichero/${nombre}`

// Fichas y Vídeo: material de una lección generado en segundo plano, con su progreso.
export default function PanelMaterial({ vista: modoVista }: { vista: 'fichas' | 'video' }) {
  const [planes, setPlanes] = useState<ResumenPlan[]>([])
  const [plan, setPlan] = useState<VistaPlan | null>(null)
  const [clave, setClave] = useState<string | null>(null)
  const [datos, setDatos] = useState<MaterialLeccion | null>(null)
  const [trabajo, setTrabajo] = useState<Trabajo | null>(null)
  const [vistas, setVistas] = useState<Set<string>>(new Set())
  const [texto, setTexto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preguntando, setPreguntando] = useState<null | { forzar: boolean }>(null)
  const control = useRef<AbortController | null>(null)

  useEffect(() => {
    const [, temaRuta, claveRuta] = window.location.hash.replace(/^#\/?/, '').split('/')
    listarPlanes().then((ps) => {
      setPlanes(ps)
      const elegido = ps.find((p) => p.tema_id === Number(temaRuta)) ?? ps[0]
      if (elegido)
        verPlan(elegido.tema_id).then((v) => {
          setPlan(v)
          if (claveRuta && v.lecciones.some((l) => l.clave === claveRuta)) setClave(claveRuta)
        })
      if (temaRuta) window.history.replaceState(null, '', `#/${modoVista === 'video' ? 'video' : 'fichas'}`)
    })
  }, [modoVista])

  const cargar = useCallback(() => {
    if (!plan || !clave) return
    pedir<MaterialLeccion>(`/api/planes/${plan.plan_id}/lecciones/${clave}/material`).then((d) => {
      setDatos(d)
      const t = d.ultimo_trabajo
      if (t && ['pendiente', 'en_curso'].includes(t.estado)) seguir(t.id)
      else setTrabajo(t)
      const objetivo = modoVista === 'video' ? d.materiales.guion : d.materiales.apuntes
      if (objetivo) pedir<{ texto: string }>(`/api/materiales/${objetivo.id}`).then((m) => setTexto(m.texto))
      else setTexto(null)
    })
    // seguir se define abajo; se vuelve a suscribir si recargas con un trabajo en curso
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, clave, modoVista])

  useEffect(cargar, [cargar])
  useEffect(() => () => control.current?.abort(), [])

  async function seguir(id: number) {
    control.current?.abort()
    const c = new AbortController()
    control.current = c
    setTrabajo({ id, estado: 'pendiente', nodo: null, paso: 0, total: 0, avisos: [], error: null })
    try {
      const r = await fetch(`/api/trabajos/${id}/eventos`, { signal: c.signal })
      for await (const ev of leerSSE<EventoTrabajo>(r)) {
        if (ev.tipo === 'fase')
          setTrabajo((t) => t && { ...t, estado: ev.estado, nodo: ev.nodo, paso: ev.paso, total: ev.total })
        else if (ev.tipo === 'aviso')
          setTrabajo((t) => t && { ...t, avisos: [...t.avisos, { regla: ev.regla, detalle: ev.detalle }] })
        else if (ev.tipo === 'error') setTrabajo((t) => t && { ...t, estado: 'fallido', error: ev.detalle })
        else if (ev.tipo === 'fin') {
          setTrabajo((t) => t && { ...t, estado: 'hecho' })
          cargar()
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(String(e))
    }
  }

  const generar = async (forzar: boolean, r: Respuestas) => {
    if (!plan || !clave) return
    setError(null)
    setPreguntando(null)
    const tipos = Array.from(new Set(['apuntes', ...((r.tipos as string[]) ?? [])]))
    const preferencias = {
      profundidad: r.profundidad, preguntas: r.preguntas, cantidad: r.cantidad,
      enfoque: (r.enfoque as string | undefined)?.trim() || null,
    }
    try {
      const r = await pedir<{ trabajo_id: number }>(
        `/api/planes/${plan.plan_id}/lecciones/${clave}/material`,
        enviarJson({ forzar, tipos, preferencias }),
      )
      seguir(r.trabajo_id)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const enCurso = trabajo && ['pendiente', 'en_curso'].includes(trabajo.estado)
  const apuntes = datos?.materiales.apuntes
  const diapos = datos?.materiales.diapositivas
  const guion = datos?.materiales.guion

  return (
    <div className="panel">
      <h1>{modoVista === 'video' ? 'Vídeo' : 'Fichas'}</h1>
      {!planes.length && <p className="vacio">Primero acepta un plan en Roadmap.</p>}
      <div className="fila">
        <select
          aria-label="Plan"
          value={plan?.tema_id ?? ''}
          onChange={(e) => {
            setClave(null)
            verPlan(Number(e.target.value)).then(setPlan)
          }}
        >
          {planes.map((p) => (
            <option key={p.plan_id} value={p.tema_id}>
              {p.tema}
            </option>
          ))}
        </select>
        <select aria-label="Lección" value={clave ?? ''} onChange={(e) => setClave(e.target.value || null)}>
          <option value="">Elige una lección</option>
          {plan?.lecciones.map((l) => (
            <option key={l.clave} value={l.clave}>
              {l.clave} · {l.titulo}
            </option>
          ))}
        </select>
        {clave && (
          <>
            <button className="boton boton-principal" disabled={!!enCurso} onClick={() => setPreguntando({ forzar: false })}>
              {apuntes ? 'Generar si ha cambiado' : 'Generar el material'}
            </button>
            {apuntes && (
              <button className="boton" disabled={!!enCurso} onClick={() => setPreguntando({ forzar: true })}>
                Rehacer
              </button>
            )}
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {preguntando && clave && (
        <Cuestionario
          key={`${clave}-${preguntando.forzar}`}
          titulo={`Material de ${clave}`}
          preguntas={modoVista === 'video'
            ? PREGUNTAS_MATERIAL.map((q) => (q.id === 'tipos' ? { ...q, porDefecto: ['apuntes', 'guion'] } : q))
            : PREGUNTAS_MATERIAL}
          boton={preguntando.forzar ? 'Rehacer el material' : 'Generar el material'}
          alTerminar={(r) => generar(preguntando.forzar, r)}
          alSaltar={() => setPreguntando(null)}
          textoSaltar="Cancelar"
        />
      )}

      {trabajo && (enCurso || trabajo.estado === 'fallido') && (
        <div className="progreso" role="status">
          <p>
            {trabajo.estado === 'fallido'
              ? `Falló: ${trabajo.error}`
              : `${NODOS[trabajo.nodo ?? ''] ?? trabajo.nodo ?? 'En cola'}${trabajo.total > 1 ? ` · bloque ${trabajo.paso + 1} de ${trabajo.total}` : ''}`}
          </p>
          {enCurso && (
            <>
              <span className="barra">
                <span style={{ width: `${trabajo.total ? ((trabajo.paso + 1) / trabajo.total) * 100 : 5}%` }} />
              </span>
              <button className="boton-mini" onClick={() => pedir(`/api/trabajos/${trabajo.id}/cancelar`, { method: 'POST' })}>
                Cancelar
              </button>
            </>
          )}
        </div>
      )}
      {trabajo?.avisos.length ? (
        <details>
          <summary className="nota">{trabajo.avisos.length} avisos</summary>
          <ul className="nota">
            {trabajo.avisos.map((a, i) => (
              <li key={i}>
                {a.regla}: {a.detalle}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {clave && datos && (
        <>
          <div className="fila">
            {apuntes && (
              <span className={`chip estado-${apuntes.estado}`}>
                Apuntes: {apuntes.estado}
                {apuntes.motivo ? ` · ${apuntes.motivo}` : ''}
              </span>
            )}
            {apuntes?.ficheros.includes('pdf') && (
              <a className="boton-mini" href={fichero(apuntes, 'pdf')} target="_blank" rel="noreferrer">
                Apuntes en PDF
              </a>
            )}
            {diapos?.ficheros.includes('html') && (
              <a className="boton-mini" href={fichero(diapos, 'html')} target="_blank" rel="noreferrer">
                Diapositivas
              </a>
            )}
            {diapos?.ficheros.includes('diapositivas_pdf') && (
              <a className="boton-mini" href={fichero(diapos, 'diapositivas_pdf')} target="_blank" rel="noreferrer">
                Diapositivas en PDF
              </a>
            )}
            {guion?.ficheros.includes('guion') && (
              <a className="boton-mini" href={fichero(guion, 'guion')} target="_blank" rel="noreferrer">
                Guion
              </a>
            )}
          </div>
          {modoVista === 'fichas' && datos.preguntas.length > 0 && (
            <section>
              <h2>Fichas de repaso ({datos.preguntas.length})</h2>
              <p className="nota">Intenta responder antes de mirar la respuesta fantasma.</p>
              <ol className="fichas">
                {datos.preguntas.map((p) => (
                  <li key={p.id}>
                    <p>
                      <span className="chip">{p.tipo}</span> {p.enunciado}
                    </p>
                    {vistas.has(p.id) ? (
                      <p className="fantasma">{p.fantasma}</p>
                    ) : (
                      <button className="boton-mini" onClick={() => setVistas(new Set([...vistas, p.id]))}>
                        Ver la respuesta
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {texto && (
            <section className="apuntes">
              <h2>{modoVista === 'video' ? 'Guion' : 'Apuntes'}</h2>
              <Markdown remarkPlugins={[remarkGfm]}>
                {texto
                  .replace(/^---\n[\s\S]*?\n---\n/, '')
                  .replace(/\{\.nb\}/g, '')
                  .replace(/\[Definiciones: ([\s\S]*?)\]\{\.cita\}/, '> **Definiciones.** $1')
                  .replace(/\n\s*::: fantasma\n[\s\S]*?:::\n/g, '\n')
                  .replace(/^\[\[(\w+)\]\]$/gm, '**[$1]**')}
              </Markdown>
            </section>
          )}
          {!apuntes && !enCurso && <p className="vacio">Esta lección aún no tiene material.</p>}
        </>
      )}
    </div>
  )
}
