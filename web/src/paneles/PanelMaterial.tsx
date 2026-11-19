import { useCallback, useEffect, useRef, useState } from 'react'
import { BotonLibro, TituloEditable, tituloSencillo, usarIndice } from '../componentes/indice.tsx'
import {
  enviarJson,
  leerSSE,
  listarPlanes,
  pedir,
  verPlan,
  type ResumenPlan,
  type VistaPlan,
} from '../api.ts'
import { planActivo, recordarPlan } from '../componentes/planActivo.ts'
import { colorDeTema } from '../componentes/colorTema.ts'
import Cuestionario, { type Respuestas } from '../componentes/Cuestionario.tsx'
import { PREGUNTAS_MATERIAL } from '../componentes/cuestionarios.ts'
import LectorLibro, { TextoLibro } from '../componentes/LectorLibro.tsx'
import { varianteFicha } from '../componentes/varianteFicha.ts'
import Tarjetas, { type Ficha } from '../componentes/Tarjetas.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import Colores from '../componentes/Colores.tsx'
import { acentoDe, usarColores, variables } from '../componentes/colores.ts'
import Pensando from '../componentes/Pensando.tsx'
import Cargando, { mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import { errorLegible } from '../componentes/errores.ts'
import BarraCuota from '../componentes/BarraCuota.tsx'

// Lo que sale si no eliges nada: lo de casi siempre.
const RECOMENDADO: Respuestas = {
  tipos: ['apuntes', 'preguntas'],
  profundidad: 'estandar',
  preguntas: 'mezcla',
  cantidad: 'normal',
}

const AVANCE = [
  { titulo: 'Apuntes', texto: 'Para leer aquí como un libro o bajar en PDF' },
  { titulo: 'Fichas', texto: 'Preguntas de memoria, de una en una' },
  { titulo: 'Repaso', texto: 'Sus conceptos entran en tu repaso diario' },
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
  // null mientras carga: así un fallo o una espera no se confunden con «no tienes plan».
  const [planes, setPlanes] = useState<ResumenPlan[] | null>(null)
  const [fallo, setFallo] = useState(false)
  const [intento, setIntento] = useState(0)
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
  const [colores] = usarColores()
  const indice = usarIndice(plan?.plan_id)
  const raiz = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const [, temaRuta, claveRuta, pestanaRuta] = window.location.hash.replace(/^#\/?/, '').split('/')
    if (['apuntes', 'fichas', 'diapositivas', 'guion'].includes(pestanaRuta)) setPestana(pestanaRuta as Pestana)
    setFallo(false)
    listarPlanes()
      .then((ps) => {
        setPlanes(ps)
        const elegido = planActivo(ps, temaRuta ? Number(temaRuta) : null)
        if (temaRuta) window.history.replaceState(null, '', `#/${modoVista === 'video' ? 'video' : 'fichas'}`)
        if (!elegido) return setPlanes(ps)
        // La lista se enseña cuando también ha llegado el plan: si este falla, sale «Reintentar» y no una lista vacía.
        return Promise.all([verPlan(elegido.tema_id), pedir<{ leccion_clave?: string }>('/api/hoy').catch(() => null)]).then(([v, hoy]) => {
          setPlanes(ps)
          setPlan(v)
          // Sin lección en la URL, abre la que toca hoy (no siempre la primera).
          const existe = (c?: string | null) => !!c && v.lecciones.some((l) => l.clave === c)
          setClave(existe(claveRuta) ? claveRuta : existe(hoy?.leccion_clave) ? hoy!.leccion_clave! : (v.lecciones[0]?.clave ?? null))
        })
      })
      .catch(() => setFallo(true))
  }, [modoVista, intento])

  // Un enlace a otra lección (#/fichas/1/L4) con el panel ya abierto: se cambia de lección sin recargar.
  useEffect(() => {
    const alCambiar = () => {
      const [modoRuta, , claveRuta, pestanaRuta] = window.location.hash.replace(/^#\/?/, '').split('/')
      if (modoRuta !== 'fichas' || !claveRuta) return
      setClave(claveRuta)
      if (['apuntes', 'fichas', 'diapositivas', 'guion'].includes(pestanaRuta)) setPestana(pestanaRuta as Pestana)
      window.history.replaceState(null, '', '#/fichas')
    }
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])

  const cargarEstados = useCallback(() => {
    // Los estados de la lista son un adorno (listo, sin material): si fallan, se quedan como estaban.
    if (plan)
      pedir<Record<string, EstadoLeccion>>(`/api/planes/${plan.plan_id}/materiales`)
        .then(setEstados)
        .catch(() => undefined)
  }, [plan])
  useEffect(cargarEstados, [cargarEstados])

  const [falloMaterial, setFalloMaterial] = useState<string | null>(null)
  const cargar = useCallback(() => {
    if (!plan || !clave) return
    // Al cambiar de lección (o recargar) se deja de seguir el trabajo anterior; si sigue en marcha, se vuelve a seguir.
    control.current?.abort()
    setTextos({})
    setFalloMaterial(null)
    const fallo = (e: unknown) => setFalloMaterial(mensajeDe(e))
    pedir<MaterialLeccion>(`/api/planes/${plan.plan_id}/lecciones/${clave}/material`)
      .then((d) => {
        setDatos(d)
        const t = d.ultimo_trabajo
        if (t && ['pendiente', 'en_curso'].includes(t.estado)) seguir(t.id)
        else setTrabajo(t)
        if (d.materiales.apuntes)
          pedir<{ texto: string; estilo?: string; contrato?: { bloques?: { clave: string; titulo: string }[] } }>(
            `/api/materiales/${d.materiales.apuntes.id}`,
          )
            .then((m) => {
              setTextos((x) => ({ ...x, apuntes: m.texto }))
              setEstilo(m.estilo ?? 'libro')
              setContrato(Object.fromEntries((m.contrato?.bloques ?? []).map((b) => [b.clave, b.titulo])))
            })
            .catch(fallo)
        if (d.materiales.guion)
          pedir<{ texto: string }>(`/api/materiales/${d.materiales.guion.id}`)
            .then((m) => setTextos((x) => ({ ...x, guion: m.texto })))
            .catch(fallo)
      })
      .catch((e) => {
        // Sin el material de esta lección no se enseña el de otra ni un progreso que ya no se sigue.
        setDatos(null)
        setTrabajo(null)
        fallo(e)
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
    let acabado = false
    try {
      const r = await fetch(`/api/trabajos/${id}/eventos`, { signal: c.signal })
      for await (const ev of leerSSE<EventoTrabajo>(r)) {
        if (ev.tipo === 'fase')
          setTrabajo((t) => t && { ...t, estado: ev.estado, nodo: ev.nodo, paso: ev.paso, total: ev.total })
        else if (ev.tipo === 'aviso')
          setTrabajo((t) => t && { ...t, avisos: [...t.avisos, { regla: ev.regla, detalle: ev.detalle }] })
        else if (ev.tipo === 'error') {
          acabado = true
          // Si lo has parado tú, no es un fallo: se queda cancelado y no se pinta como error.
          if (ev.detalle === 'cancelado') setTrabajo((t) => t && { ...t, estado: 'cancelado', error: null })
          else setTrabajo((t) => t && { ...t, estado: 'fallido', error: ev.detalle })
        } else if (ev.tipo === 'fin') {
          acabado = true
          setTrabajo((t) => t && { ...t, estado: 'hecho' })
          cargar()
          cargarEstados()
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
    // Se cortó sin terminar (el servidor se reinició, la red): en unos segundos se vuelve a leer cómo va y, si sigue
    // en marcha, se vuelve a seguir. Así el progreso nunca se queda congelado.
    if (!acabado && !c.signal.aborted)
      window.setTimeout(() => {
        if (!c.signal.aborted) cargar()
      }, 4000)
  }

  const generar = async (forzar: boolean, r: Respuestas) => {
    if (!plan || !clave) return
    setError(null)
    setPreguntando(null)
    // Preparar = apuntes y fichas; diapositivas y guion se piden aparte, con su botón.
    const tipos = Array.from(new Set(['apuntes', ...((r.tipos as string[]) ?? ['preguntas'])]))
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

  // Diapositivas y guion, a mano: salen de los apuntes que ya tienes.
  const pedirExtra = async (tipo: 'diapositivas' | 'guion') => {
    if (!plan || !clave) return
    setError(null)
    try {
      const res = await pedir<{ trabajo_id: number }>(
        `/api/planes/${plan.plan_id}/lecciones/${clave}/material`,
        enviarJson({ forzar: true, tipos: [tipo], preferencias: { estilo } }),
      )
      seguir(res.trabajo_id)
      cargarEstados()
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const borrar = async (tipo: 'diapositivas' | 'guion' | 'todo') => {
    if (!plan || !clave) return
    const que = {
      diapositivas: 'las diapositivas de esta lección',
      guion: 'el guion de esta lección',
      todo: 'todo el material de esta lección (apuntes, fichas, diapositivas y guion). Tus repasos se quedan',
    }[tipo]
    if (!confirm(`¿Borrar ${que}? No se puede deshacer.`)) return
    try {
      await pedir(`/api/planes/${plan.plan_id}/lecciones/${clave}/material?tipo=${tipo}`, { method: 'DELETE' })
      setAviso(tipo === 'todo' ? 'Material borrado: la lección queda sin preparar.' : 'Borrado.')
      if (tipo !== 'todo') setPestana('apuntes')
      cargar()
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
  const temaNombre = (planes ?? []).find((p) => p.plan_id === plan?.plan_id)?.tema ?? ''
  const pestanas: { id: Pestana; nombre: string; hay: boolean }[] = [
    { id: 'apuntes', nombre: 'Apuntes', hay: !!textos.apuntes },
    { id: 'fichas', nombre: `Fichas${datos?.preguntas.length ? ` (${datos.preguntas.length})` : ''}`, hay: !!datos?.preguntas.length },
    { id: 'diapositivas', nombre: 'Diapositivas', hay: !!diapos?.ficheros.includes('html') },
    { id: 'guion', nombre: 'Guion', hay: !!textos.guion },
  ]

  if (planes === null)
    return fallo ? (
      <div className="panel">
        <h1>Lecciones</h1>
        <p role="alert" className="nota">No he podido cargar tus lecciones. Comprueba que Magister sigue en marcha.</p>
        <button className="boton" onClick={() => setIntento((x) => x + 1)}>
          Reintentar
        </button>
      </div>
    ) : (
      <Pensando texto="Cargando tus lecciones…" />
    )
  if (!planes.length)
    return (
      <div className="panel">
        <h1>{modoVista === 'video' ? 'Vídeo' : 'Lecciones'}</h1>
        <Vacio
          etiqueta="Sin plan todavía"
          titulo="Aquí estará cada lección de tu plan"
          texto="Cada lección es un bloque: apuntes que se leen como un libro, fichas para repasar de memoria, diapositivas y guion de vídeo. Primero hace falta un plan que diga qué lecciones hay."
          acciones={[{ texto: 'Crear un plan', principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  return (
    <div className="bloques" ref={raiz} style={variables(acentoDe(colores, clave))}>
      <aside className="bloques-lista" aria-label="Lecciones">
        {planes.length > 1 ? (
          <div className="selector-tema">
            <span className="punto-tema" style={colorDeTema(plan?.tema_id, planes)?.estilo} aria-hidden="true" />
            <select
              aria-label="Plan"
              value={plan?.tema_id ?? ''}
              onChange={(e) =>
                verPlan(Number(e.target.value))
                  .then((v) => {
                    recordarPlan(v.tema_id)
                    setPlan(v)
                    setClave(v.lecciones[0]?.clave ?? null)
                  })
                  .catch((err) => setError(`No he podido abrir ese plan: ${mensajeDe(err)}`))
              }
            >
              {planes.map((p) => (
                <option key={p.plan_id} value={p.tema_id}>
                  {p.tema}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="bloques-plan con-punto-tema">
            <span className="punto-tema" style={colorDeTema(plan?.tema_id, planes)?.estilo} aria-hidden="true" />
            {temaNombre}
          </p>
        )}
        {(indice?.temas ?? [{ nombre: '', lecciones: plan?.lecciones.map((l) => l.clave) ?? [], trata: [] }]).map((t) => (
          <div key={t.nombre || 'todas'} className="bloques-tema">
            {t.nombre && <p className="bloques-tema-nombre">{t.nombre}</p>}
            <ol>
              {plan?.lecciones
                .filter((l) => t.lecciones.includes(l.clave))
                .map((l) => {
                  const e = estadoLeccion(estados[l.clave])
                  return (
                    <li key={l.clave}>
                      <button className={l.clave === clave ? 'activa' : ''} onClick={() => setClave(l.clave)} title={l.titulo}>
                        <span className="bloques-clave">{l.clave}</span>
                        <span className="bloques-titulo">
                          {tituloSencillo(indice, l.clave, l.titulo)}
                          <small className={`estado-leccion ${e.clase}`}>{e.texto}</small>
                        </span>
                      </button>
                    </li>
                  )
                })}
            </ol>
          </div>
        ))}
        {plan && <BotonLibro planId={plan.plan_id} />}
      </aside>

      <section className="bloque-vista">
        {leccion && (
          <header className="bloque-cabecera">
            <span className="bloque-num">{leccion.clave.replace(/\D/g, '') || leccion.clave}</span>
            <div className="bloque-datos">
              <span className="lb-etq">
                {leccion.clave} · {temaNombre}
              </span>
              <h1>{plan ? <TituloEditable planId={plan.plan_id} clave={leccion.clave} largo={leccion.titulo} indice={indice} /> : leccion.titulo}</h1>
              {indice?.titulos[leccion.clave] && <p className="bloque-titulo-largo">{leccion.titulo}</p>}
              {leccion.objetivos.length > 0 && (
                <p className="bloque-objetivos">Con qué saldrás: {leccion.objetivos.join('; ')}</p>
              )}
              <div className="bloque-acciones">
                {apuntes && (
                  <button className="boton boton-principal" onClick={() => irARuta(`#/foco/${apuntes.id}`)}>
                    Estudiar
                  </button>
                )}
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
                {/* Lo que se usa poco (y lo que no tiene vuelta atrás), recogido: a la vista, solo lo de estudiar. */}
                <details className="bloque-mas">
                  <summary className="boton">Más</summary>
                  <div className="bloque-mas-menu">
                    <Colores leccion={clave} />
                    {apuntes && (
                      <button className="boton peligro" disabled={!!enCurso} onClick={() => borrar('todo')}>
                        Borrar el material
                      </button>
                    )}
                  </div>
                </details>
              </div>
              {apuntes && apuntes.estado !== 'listo' && apuntes.motivo && (
                <p className="nota">Por revisar: {apuntes.motivo}</p>
              )}
            </div>
          </header>
        )}

        {error && <TextoError texto={error} />}
        {falloMaterial && <Cargando error={falloMaterial} reintentar={cargar} />}
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
        {preguntando && clave && <BarraCuota accion={{ accion: 'material' }} />}

        {trabajo && (enCurso || trabajo.estado === 'fallido') && (
          <div className="progreso" role="status">
            {trabajo.estado === 'fallido' ? (
              <TextoError texto={trabajo.error} antes="No se ha podido preparar. " rol="status" />
            ) : (
              <Pensando
                texto={`${NODOS[trabajo.nodo ?? ''] ?? trabajo.nodo ?? 'En cola'}${trabajo.total > 1 ? ` · bloque ${trabajo.paso + 1} de ${trabajo.total}` : ''}`}
              />
            )}
            {enCurso && (
              <>
                <span className="barra">
                  <span style={{ width: `${trabajo.total ? ((trabajo.paso + 1) / trabajo.total) * 100 : 5}%` }} />
                </span>
                <button
                  className="boton-mini"
                  onClick={() =>
                    pedir(`/api/trabajos/${trabajo.id}/cancelar`, { method: 'POST' }).catch((e) => setError(`No he podido cancelar: ${mensajeDe(e)}`))
                  }
                >
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
                  onClick={() => setPestana(p.id)}
                >
                  {p.nombre}
                </button>
              ))}
            </nav>
            {pestana === 'apuntes' && textos.apuntes && (
              <LectorLibro
                markdown={textos.apuntes}
                variante={clave ? varianteFicha(clave, plan?.plan_id) : undefined}
                raiz={raiz.current?.closest('.central')}
                rehacer={
                  datos?.materiales.apuntes
                    ? {
                        bloques: Object.fromEntries(Object.entries(contrato).map(([k, t]) => [t, k])),
                        alRehacer: async (claveBloque, como) => {
                          try {
                            const r = await pedir<{ texto: string }>(
                              `/api/materiales/${datos.materiales.apuntes!.id}/bloques/${claveBloque}/rehacer`,
                              enviarJson({ como }),
                            )
                            setTextos((x) => ({ ...x, apuntes: r.texto }))
                          } catch (e) {
                            alert(`No se pudo rehacer. ${errorLegible(mensajeDe(e)).mensaje}`)
                          }
                        },
                      }
                    : undefined
                }
              />
            )}
            {pestana === 'fichas' && <Tarjetas key={clave} fichas={datos.preguntas} bloques={contrato} />}
            {pestana === 'diapositivas' && diapos?.ficheros.includes('html') && (
              <div className="visor-diapositivas">
                <iframe title="Diapositivas" src={fichero(diapos, 'html')} />
                <p className="nota">
                  Pulsa dentro y usa las flechas para pasar. F abre en pantalla completa.{' '}
                  <button className="boton-mini peligro" onClick={() => borrar('diapositivas')}>
                    Borrar las diapositivas
                  </button>
                </p>
              </div>
            )}
            {pestana === 'guion' && textos.guion && (
              <>
                <TextoLibro markdown={textos.guion} className="guion" />
                <p className="nota">
                  <button className="boton-mini peligro" onClick={() => borrar('guion')}>
                    Borrar el guion
                  </button>
                </p>
              </>
            )}
            {pestana === 'diapositivas' && !diapos && !enCurso && (
              <Vacio
                etiqueta="Sin diapositivas"
                titulo="Las diapositivas se hacen cuando las pides"
                texto="Unas doce, con los colores del libro, a partir de los apuntes de esta lección. Tarda un par de minutos."
                acciones={[{ texto: 'Hacer las diapositivas', principal: true, alPulsar: () => pedirExtra('diapositivas') }]}
              >
                <BarraCuota accion={{ accion: 'diapositivas' }} />
              </Vacio>
            )}
            {pestana === 'guion' && !guion && !enCurso && (
              <Vacio
                etiqueta="Sin guion"
                titulo="El guion del vídeo se escribe cuando lo pides"
                texto="Por escenas, para verlo narrado en Vídeo. Sale de los apuntes de esta lección y tarda un par de minutos."
                acciones={[{ texto: 'Escribir el guion', principal: true, alPulsar: () => pedirExtra('guion') }]}
              >
                <BarraCuota accion={{ accion: 'video', minutos: 6 }} />
              </Vacio>
            )}
          </>
        )}
        {datos && !apuntes && !enCurso && !preguntando && (
          <Vacio
            etiqueta="Lección sin preparar"
            titulo="Prepárala y tendrás todo esto"
            texto="El tutor escribe la lección bloque a bloque con tus fuentes, revisa el tono y comprueba que no falte nada. Tarda unos minutos y puedes seguir usando la app mientras tanto."
            acciones={[
              { texto: 'Prepararla con lo recomendado', principal: true, alPulsar: () => generar(false, RECOMENDADO) },
              { texto: 'Elegir yo las opciones', alPulsar: () => setPreguntando({ forzar: false }) },
            ]}
          >
            <ul className="vacio-avance">
              {AVANCE.map((a) => (
                <li key={a.titulo}>
                  <strong>{a.titulo}</strong>
                  <span>{a.texto}</span>
                </li>
              ))}
            </ul>
            <BarraCuota accion={{ accion: 'material' }} />
          </Vacio>
        )}
        {guion && !textos.guion && pestana === 'guion' && <p className="nota">Cargando el guion…</p>}
      </section>
    </div>
  )
}
