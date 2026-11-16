import { useCallback, useEffect, useRef, useState } from 'react'
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
import LectorLibro, { TextoLibro } from '../componentes/LectorLibro.tsx'
import Tarjetas, { type Ficha } from '../componentes/Tarjetas.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'

// Lo que sale si no eliges nada: lo de casi siempre.
const RECOMENDADO: Respuestas = {
  tipos: ['apuntes', 'preguntas', 'diapositivas'],
  profundidad: 'estandar',
  preguntas: 'mezcla',
  cantidad: 'normal',
}

const AVANCE = [
  { titulo: 'Apuntes', texto: 'Para leer aquí como un libro o bajar en PDF' },
  { titulo: 'Fichas', texto: 'Preguntas de memoria, de una en una' },
  { titulo: 'Diapositivas', texto: 'Unas doce, para repasar de un vistazo' },
  { titulo: 'Repaso', texto: 'Sus conceptos entran en tu repaso diario' },
]
const AVANCE_VIDEO = [
  { titulo: 'Apuntes', texto: 'La base de la que sale todo' },
  { titulo: 'Guion', texto: 'Para grabarlo en vídeo, por partes' },
]

interface MaterialInfo {
  id: number
  tipo: 'apuntes' | 'diapositivas' | 'guion'
  estado: 'generando' | 'listo' | 'revisar' | 'bloqueado'
  motivo: string | null
  ficheros: string[]
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
  preguntas: Ficha[]
  ultimo_trabajo: Trabajo | null
}

interface EstadoLeccion {
  tipos: Record<string, string>
  fichas: number
  en_marcha: boolean
}

type EventoTrabajo =
  | { tipo: 'fase'; nodo: string; paso: number; total: number; estado: string }
  | { tipo: 'aviso'; regla: string; detalle: string }
  | { tipo: 'fin'; materiales: number[] }
  | { tipo: 'error'; detalle: string }

type Pestana = 'apuntes' | 'fichas' | 'diapositivas' | 'guion'

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

function estadoLeccion(e: EstadoLeccion | undefined): { clase: string; texto: string } {
  if (!e) return { clase: 'sin', texto: 'Sin material' }
  if (e.en_marcha) return { clase: 'marcha', texto: 'Generando' }
  if (e.tipos.apuntes === 'listo') return { clase: 'listo', texto: `Listo · ${e.fichas} fichas` }
  if (e.tipos.apuntes) return { clase: 'revisar', texto: `Por revisar · ${e.fichas} fichas` }
  return { clase: 'sin', texto: 'Sin material' }
}

// Fichas y Vídeo: cada lección como un bloque de aprendizaje (apuntes, fichas, diapositivas y guion).
export default function PanelMaterial({ vista: modoVista }: { vista: 'fichas' | 'video' }) {
  const [planes, setPlanes] = useState<ResumenPlan[]>([])
  const [plan, setPlan] = useState<VistaPlan | null>(null)
  const [estados, setEstados] = useState<Record<string, EstadoLeccion>>({})
  const [clave, setClave] = useState<string | null>(null)
  const [datos, setDatos] = useState<MaterialLeccion | null>(null)
  const [trabajo, setTrabajo] = useState<Trabajo | null>(null)
  const [textos, setTextos] = useState<Partial<Record<'apuntes' | 'guion', string>>>({})
  const [estilo, setEstilo] = useState<string>('libro')
  const [contrato, setContrato] = useState<Record<string, string>>({})
  const [pestana, setPestana] = useState<Pestana>(modoVista === 'video' ? 'guion' : 'apuntes')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [preguntando, setPreguntando] = useState<null | { forzar: boolean }>(null)
  const control = useRef<AbortController | null>(null)
  const raiz = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const [, temaRuta, claveRuta, pestanaRuta] = window.location.hash.replace(/^#\/?/, '').split('/')
    if (['apuntes', 'fichas', 'diapositivas', 'guion'].includes(pestanaRuta)) setPestana(pestanaRuta as Pestana)
    listarPlanes().then((ps) => {
      setPlanes(ps)
      const elegido = ps.find((p) => p.tema_id === Number(temaRuta)) ?? ps[0]
      if (elegido)
        verPlan(elegido.tema_id).then((v) => {
          setPlan(v)
          const valida = claveRuta && v.lecciones.some((l) => l.clave === claveRuta)
          setClave(valida ? claveRuta : (v.lecciones[0]?.clave ?? null))
        })
      if (temaRuta) window.history.replaceState(null, '', `#/${modoVista === 'video' ? 'video' : 'fichas'}`)
    })
  }, [modoVista])

  const cargarEstados = useCallback(() => {
    if (plan) pedir<Record<string, EstadoLeccion>>(`/api/planes/${plan.plan_id}/materiales`).then(setEstados)
  }, [plan])
  useEffect(cargarEstados, [cargarEstados])

  const cargar = useCallback(() => {
    if (!plan || !clave) return
    setTextos({})
    pedir<MaterialLeccion>(`/api/planes/${plan.plan_id}/lecciones/${clave}/material`).then((d) => {
      setDatos(d)
      const t = d.ultimo_trabajo
      if (t && ['pendiente', 'en_curso'].includes(t.estado)) seguir(t.id)
      else setTrabajo(t)
      if (d.materiales.apuntes)
        pedir<{ texto: string; estilo?: string; contrato?: { bloques?: { clave: string; titulo: string }[] } }>(
          `/api/materiales/${d.materiales.apuntes.id}`,
        ).then((m) => {
          setTextos((x) => ({ ...x, apuntes: m.texto }))
          setEstilo(m.estilo ?? 'libro')
          setContrato(Object.fromEntries((m.contrato?.bloques ?? []).map((b) => [b.clave, b.titulo])))
        })
      if (d.materiales.guion)
        pedir<{ texto: string }>(`/api/materiales/${d.materiales.guion.id}`).then((m) =>
          setTextos((x) => ({ ...x, guion: m.texto })),
        )
    })
    // seguir se define abajo; se vuelve a suscribir si recargas con un trabajo en curso
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, clave])

  useEffect(cargar, [cargar])
  useEffect(() => () => control.current?.abort(), [])
  useEffect(() => {
    raiz.current?.closest('.central')?.scrollTo({ top: 0 })
  }, [clave, pestana])

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
          cargarEstados()
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
      profundidad: r.profundidad,
      preguntas: r.preguntas,
      cantidad: r.cantidad,
      estilo: r.estilo ?? estilo,
      enfoque: (r.enfoque as string | undefined)?.trim() || null,
    }
    try {
      const res = await pedir<{ trabajo_id: number }>(
        `/api/planes/${plan.plan_id}/lecciones/${clave}/material`,
        enviarJson({ forzar, tipos, preferencias }),
      )
      seguir(res.trabajo_id)
      cargarEstados()
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const cambiarEstilo = async (nuevo: string) => {
    if (!datos?.materiales.apuntes) return
    setAviso('Volviendo a pintar el PDF…')
    try {
      await pedir(`/api/materiales/${datos.materiales.apuntes.id}/estilo`, enviarJson({ estilo: nuevo }))
      setEstilo(nuevo)
      setAviso(`PDF en estilo ${nuevo === 'libro' ? 'Libro' : 'Ficha general'}.`)
      cargar()
    } catch (e) {
      setAviso(null)
      setError(String((e as Error).message))
    }
  }

  const enCurso = trabajo && ['pendiente', 'en_curso'].includes(trabajo.estado)
  const apuntes = datos?.materiales.apuntes
  const diapos = datos?.materiales.diapositivas
  const guion = datos?.materiales.guion
  const leccion = plan?.lecciones.find((l) => l.clave === clave)
  const temaNombre = planes.find((p) => p.plan_id === plan?.plan_id)?.tema ?? ''
  const pestanas: { id: Pestana; nombre: string; hay: boolean }[] = [
    { id: 'apuntes', nombre: 'Apuntes', hay: !!textos.apuntes },
    { id: 'fichas', nombre: `Fichas${datos?.preguntas.length ? ` (${datos.preguntas.length})` : ''}`, hay: !!datos?.preguntas.length },
    { id: 'diapositivas', nombre: 'Diapositivas', hay: !!diapos?.ficheros.includes('html') },
    { id: 'guion', nombre: 'Guion', hay: !!textos.guion },
  ]

  if (!planes.length)
    return (
      <div className="panel">
        <h1>{modoVista === 'video' ? 'Vídeo' : 'Fichas'}</h1>
        <Vacio
          etiqueta="Sin plan todavía"
          titulo="Aquí estará cada lección de tu plan"
          texto="Cada lección es un bloque: apuntes que se leen como un libro, fichas para repasar de memoria, diapositivas y guion de vídeo. Primero hace falta un plan que diga qué lecciones hay."
          acciones={[{ texto: 'Crear un plan', principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  return (
    <div className="bloques" ref={raiz}>
      <aside className="bloques-lista" aria-label="Lecciones">
        {planes.length > 1 ? (
          <select
            aria-label="Plan"
            value={plan?.tema_id ?? ''}
            onChange={(e) =>
              verPlan(Number(e.target.value)).then((v) => {
                setPlan(v)
                setClave(v.lecciones[0]?.clave ?? null)
              })
            }
          >
            {planes.map((p) => (
              <option key={p.plan_id} value={p.tema_id}>
                {p.tema}
              </option>
            ))}
          </select>
        ) : (
          <p className="bloques-plan">{temaNombre}</p>
        )}
        <ol>
          {plan?.lecciones.map((l) => {
            const e = estadoLeccion(estados[l.clave])
            return (
              <li key={l.clave}>
                <button className={l.clave === clave ? 'activa' : ''} onClick={() => setClave(l.clave)}>
                  <span className="bloques-clave">{l.clave}</span>
                  <span className="bloques-titulo">
                    {l.titulo}
                    <small className={`estado-leccion ${e.clase}`}>{e.texto}</small>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </aside>

      <section className="bloque-vista">
        {leccion && (
          <header className="bloque-cabecera">
            <span className="bloque-num">{leccion.clave.replace(/\D/g, '') || leccion.clave}</span>
            <div className="bloque-datos">
              <span className="lb-etq">
                {leccion.clave} · {temaNombre}
              </span>
              <h1>{leccion.titulo}</h1>
              {leccion.objetivos.length > 0 && (
                <p className="bloque-objetivos">Con qué saldrás: {leccion.objetivos.join('; ')}</p>
              )}
              <div className="bloque-acciones">
                {apuntes && (
                  <button className="boton" disabled={!!enCurso} onClick={() => setPreguntando({ forzar: true })}>
                    Rehacer el material
                  </button>
                )}
                {apuntes?.ficheros.includes('pdf') && (
                  <a className="boton" href={fichero(apuntes, 'pdf')} target="_blank" rel="noreferrer">
                    Apuntes en PDF
                  </a>
                )}
                {diapos?.ficheros.includes('diapositivas_pdf') && (
                  <a className="boton" href={fichero(diapos, 'diapositivas_pdf')} target="_blank" rel="noreferrer">
                    Diapositivas en PDF
                  </a>
                )}
                {apuntes && (
                  <label className="estilo-pdf">
                    Estilo del PDF
                    <select value={estilo} onChange={(e) => cambiarEstilo(e.target.value)} disabled={!!enCurso}>
                      <option value="libro">Libro</option>
                      <option value="ficha">Ficha general</option>
                    </select>
                  </label>
                )}
              </div>
              {apuntes && apuntes.estado !== 'listo' && apuntes.motivo && (
                <p className="nota">Por revisar: {apuntes.motivo}</p>
              )}
            </div>
          </header>
        )}

        {error && <p role="alert">{error}</p>}
        {aviso && (
          <p className="nota" role="status">
            {aviso}
          </p>
        )}
        {preguntando && clave && (
          <Cuestionario
            key={`${clave}-${preguntando.forzar}`}
            titulo={`Material de ${clave}`}
            preguntas={
              modoVista === 'video'
                ? PREGUNTAS_MATERIAL.map((q) => (q.id === 'tipos' ? { ...q, porDefecto: ['apuntes', 'guion'] } : q))
                : PREGUNTAS_MATERIAL
            }
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

        {datos && apuntes && (
          <>
            <nav className="pestanas" role="tablist">
              {pestanas.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={pestana === p.id}
                  className={pestana === p.id ? 'activa' : ''}
                  disabled={!p.hay}
                  onClick={() => setPestana(p.id)}
                >
                  {p.nombre}
                </button>
              ))}
            </nav>
            {pestana === 'apuntes' && textos.apuntes && (
              <LectorLibro markdown={textos.apuntes} raiz={raiz.current?.closest('.central')} />
            )}
            {pestana === 'fichas' && <Tarjetas key={clave} fichas={datos.preguntas} bloques={contrato} />}
            {pestana === 'diapositivas' && diapos?.ficheros.includes('html') && (
              <div className="visor-diapositivas">
                <iframe title="Diapositivas" src={fichero(diapos, 'html')} />
                <p className="nota">Pulsa dentro y usa las flechas para pasar. F abre en pantalla completa.</p>
              </div>
            )}
            {pestana === 'guion' && textos.guion && <TextoLibro markdown={textos.guion} className="guion" />}
          </>
        )}
        {datos && !apuntes && !enCurso && !preguntando && (
          <Vacio
            etiqueta="Lección sin preparar"
            titulo="Prepárala y tendrás todo esto"
            texto="El tutor escribe la lección bloque a bloque con tus fuentes, revisa el tono y comprueba que no falte nada. Tarda unos minutos y puedes seguir usando la app mientras tanto."
            acciones={[
              { texto: 'Prepararla con lo recomendado', principal: true, alPulsar: () => generar(false, modoVista === 'video' ? { ...RECOMENDADO, tipos: ['apuntes', 'guion'] } : RECOMENDADO) },
              { texto: 'Elegir yo las opciones', alPulsar: () => setPreguntando({ forzar: false }) },
            ]}
          >
            <ul className="vacio-avance">
              {(modoVista === 'video' ? AVANCE_VIDEO : AVANCE).map((a) => (
                <li key={a.titulo}>
                  <strong>{a.titulo}</strong>
                  <span>{a.texto}</span>
                </li>
              ))}
            </ul>
          </Vacio>
        )}
        {guion && !textos.guion && pestana === 'guion' && <p className="nota">Cargando el guion…</p>}
      </section>
    </div>
  )
}
