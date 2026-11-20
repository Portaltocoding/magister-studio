import { useCallback, useEffect, useRef, useState } from 'react'
import { t, type Clave } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
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
import { preguntasMaterial } from '../componentes/cuestionarios.ts'
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
import {
  estadoLeccion,
  leerRutaLeccion,
  porcentaje,
  rutaLeccion,
  textoCola,
  type Cola,
  type EstadoLeccion,
  type Pestana,
} from '../componentes/leccionMaterial.ts'

// Lo que sale si no eliges nada: lo de casi siempre.
const RECOMENDADO: Respuestas = {
  tipos: ['apuntes', 'preguntas'],
  profundidad: 'estandar',
  preguntas: 'mezcla',
  cantidad: 'normal',
}

const AVANCE = ['apuntes', 'fichas', 'repaso'] as const

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
  cola?: Cola | null
}

interface MaterialLeccion {
  materiales: Record<string, MaterialInfo>
  preguntas: Ficha[]
  ultimo_trabajo: Trabajo | null
}

type EventoTrabajo =
  | { tipo: 'fase'; nodo: string; paso: number; total: number; estado: string; cola?: Cola | null }
  | { tipo: 'aviso'; regla: string; detalle: string }
  | { tipo: 'fin'; materiales: number[] }
  | { tipo: 'error'; detalle: string }

// Un motivo guardado antes de que dijera el título («bloques por revisar: b2»): se dice con los títulos.
function motivoLegible(motivo: string, titulos: Record<string, string>): string {
  const viejo = motivo.match(/^bloques por revisar: (.+)$/)
  if (!viejo) return motivo
  const nombres = viejo[1].split(/,\s*/).map((c) => t('material.comillas', { x: titulos[c] ?? c }))
  const lista = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')}${t('material.y')}${nombres[nombres.length - 1]}`
  return t(nombres.length === 1 ? 'material.motivo.uno' : 'material.motivo.varios', { lista })
}

const NODOS = ['pendiente', 'en_curso', 'entrada', 'contrato', 'escribir', 'lint', 'juez', 'refinar', 'aceptar', 'montar', 'completitud', 'ampliar', 'preguntas', 'pintar', 'diapositivas', 'guion']
const nombreNodo = (nodo: string | null): string =>
  nodo && NODOS.includes(nodo) ? t(`material.nodo.${nodo}` as Clave) : (nodo ?? t('material.nodo.en_curso'))

const fichero = (m: MaterialInfo, nombre: string) => `/api/materiales/${m.id}/fichero/${nombre}`


// Fichas y Vídeo: cada lección como un bloque de aprendizaje (apuntes, fichas, diapositivas y guion).
export default function PanelMaterial({ vista: modoVista }: { vista: 'fichas' | 'video' }) {
  usarIdioma() // los textos siguen al idioma
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
    const ruta = leerRutaLeccion(window.location.hash)
    if (ruta.pestana) setPestana(ruta.pestana)
    setFallo(false)
    listarPlanes()
      .then((ps) => {
        setPlanes(ps)
        const elegido = planActivo(ps, ruta.tema)
        if (!elegido) return setPlanes(ps)
        // Un enlace a un plan que no existe (#/fichas/9999/L1) no abre otro en silencio: se dice cuál se abre.
        const sinPlan = ruta.tema != null && elegido.tema_id !== ruta.tema
        // La lista se enseña cuando también ha llegado el plan: si este falla, sale «Reintentar» y no una lista vacía.
        return Promise.all([verPlan(elegido.tema_id), pedir<{ leccion_clave?: string }>('/api/hoy').catch(() => null)]).then(([v, hoy]) => {
          setPlanes(ps)
          setPlan(v)
          // Sin lección en la URL, abre la que toca hoy (no siempre la primera).
          const existe = (c?: string | null) => !!c && v.lecciones.some((l) => l.clave === c)
          const abierta = !sinPlan && existe(ruta.clave) ? ruta.clave : existe(hoy?.leccion_clave) ? hoy!.leccion_clave! : (v.lecciones[0]?.clave ?? null)
          setClave(abierta)
          if (sinPlan)
            setAviso(t('material.sinPlan', { id: ruta.tema!, tema: elegido.tema }))
          else if (ruta.clave && !existe(ruta.clave))
            setAviso(t('material.sinLeccion', { clave: ruta.clave, abierta: abierta ?? t('material.laLista') }))
        })
      })
      .catch(() => setFallo(true))
  }, [modoVista, intento])

  // Un enlace a otra lección (#/fichas/1/L4) con el panel ya abierto: se cambia de lección sin recargar; si es de otro
  // plan, se vuelve a cargar todo desde la ruta.
  const temaAbierto = useRef<number | null>(null)
  temaAbierto.current = plan?.tema_id ?? null
  useEffect(() => {
    const alCambiar = () => {
      const r = leerRutaLeccion(window.location.hash)
      if (r.modo !== (modoVista === 'video' ? 'video' : 'fichas') || !r.tema) return
      if (r.tema !== temaAbierto.current) return setIntento((x) => x + 1)
      if (r.clave) setClave(r.clave)
      if (r.pestana) setPestana(r.pestana)
    }
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [modoVista])

  // La URL dice dónde estás (plan, lección y pestaña) sin apilar historial: recargar te deja ahí mismo.
  useEffect(() => {
    if (!plan) return
    const ruta = rutaLeccion(modoVista === 'video' ? 'video' : 'fichas', plan.tema_id, clave, pestana)
    if (window.location.hash !== ruta) window.history.replaceState(window.history.state, '', ruta)
  }, [plan, clave, pestana, modoVista])

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
          setTrabajo((t) => t && { ...t, estado: ev.estado, nodo: ev.nodo, paso: ev.paso, total: ev.total, cola: ev.cola ?? null })
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
    if (!confirm(t(`material.borrar.${tipo}` as Clave))) return
    try {
      await pedir(`/api/planes/${plan.plan_id}/lecciones/${clave}/material?tipo=${tipo}`, { method: 'DELETE' })
      setAviso(tipo === 'todo' ? t('material.borrado.todo') : t('material.borrado'))
      if (tipo !== 'todo') setPestana('apuntes')
      cargar()
      cargarEstados()
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const cambiarEstilo = async (nuevo: string) => {
    if (!datos?.materiales.apuntes) return
    setAviso(t('material.repintando'))
    try {
      await pedir(`/api/materiales/${datos.materiales.apuntes.id}/estilo`, enviarJson({ estilo: nuevo }))
      setEstilo(nuevo)
      setAviso(t('material.pdfEstilo', { estilo: nuevo === 'libro' ? t('material.estilo.libro') : t('material.estilo.ficha') }))
      cargar()
    } catch (e) {
      setAviso(null)
      setError(String((e as Error).message))
    }
  }

  const enCurso = trabajo && ['pendiente', 'en_curso'].includes(trabajo.estado)
  // La barra nunca retrocede dentro del mismo trabajo (las fases traen cada una su «paso de total»).
  const maximo = useRef<{ id: number; valor: number }>({ id: 0, valor: 0 })
  const avance = (() => {
    if (!trabajo) return 0
    const valor = porcentaje(trabajo.estado === 'pendiente' ? 'pendiente' : trabajo.nodo, trabajo.paso, trabajo.total)
    if (maximo.current.id !== trabajo.id) maximo.current = { id: trabajo.id, valor }
    else maximo.current.valor = Math.max(maximo.current.valor, valor)
    return maximo.current.valor
  })()
  const apuntes = datos?.materiales.apuntes
  const diapos = datos?.materiales.diapositivas
  const guion = datos?.materiales.guion
  const leccion = plan?.lecciones.find((l) => l.clave === clave)
  const temaNombre = (planes ?? []).find((p) => p.plan_id === plan?.plan_id)?.tema ?? ''
  const pestanas: { id: Pestana; nombre: string; hay: boolean }[] = [
    { id: 'apuntes', nombre: t('material.pest.apuntes'), hay: !!textos.apuntes },
    { id: 'fichas', nombre: `${t('material.pest.fichas')}${datos?.preguntas.length ? ` (${datos.preguntas.length})` : ''}`, hay: !!datos?.preguntas.length },
    { id: 'diapositivas', nombre: t('material.pest.diapositivas'), hay: !!diapos?.ficheros.includes('html') },
    { id: 'guion', nombre: t('material.pest.guion'), hay: !!textos.guion },
  ]

  if (planes === null)
    return fallo ? (
      <div className="panel">
        <h1>{t('material.lecciones')}</h1>
        <p role="alert" className="nota">{t('material.noCarga')}</p>
        <button className="boton" onClick={() => setIntento((x) => x + 1)}>
          {t('material.reintentar')}
        </button>
      </div>
    ) : (
      <Pensando texto={t('material.cargando')} />
    )
  if (!planes.length)
    return (
      <div className="panel">
        <h1>{modoVista === 'video' ? t('material.video') : t('material.lecciones')}</h1>
        <Vacio
          etiqueta={t('material.vacio.etq')}
          titulo={t('material.vacio.titulo')}
          texto={t('material.vacio.texto')}
          acciones={[{ texto: t('material.vacio.crear'), principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  return (
    <div className="bloques" ref={raiz} style={variables(acentoDe(colores, clave))}>
      <aside className="bloques-lista" aria-label={t('material.lecciones')}>
        {planes.length > 1 ? (
          <div className="selector-tema">
            <span className="punto-tema" style={colorDeTema(plan?.tema_id, planes)?.estilo} aria-hidden="true" />
            <select
              aria-label={t('material.plan')}
              value={plan?.tema_id ?? ''}
              onChange={(e) =>
                verPlan(Number(e.target.value))
                  .then((v) => {
                    recordarPlan(v.tema_id)
                    setPlan(v)
                    setClave(v.lecciones[0]?.clave ?? null)
                  })
                  .catch((err) => setError(t('material.noAbrePlan', { motivo: mensajeDe(err) })))
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
        {(indice?.temas ?? [{ nombre: '', lecciones: plan?.lecciones.map((l) => l.clave) ?? [], trata: [] }]).map((tm) => (
          <div key={tm.nombre || 'todas'} className="bloques-tema">
            {tm.nombre && <p className="bloques-tema-nombre">{tm.nombre}</p>}
            <ol>
              {plan?.lecciones
                .filter((l) => tm.lecciones.includes(l.clave))
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
              {/* El título largo, solo si dice algo más que el sencillo (si son iguales, salía repetido bajo el h1). */}
              {indice?.titulos[leccion.clave] &&
                indice.titulos[leccion.clave].trim().toLowerCase() !== leccion.titulo.trim().toLowerCase() && (
                  <p className="bloque-titulo-largo">{leccion.titulo}</p>
                )}
              {leccion.objetivos.length > 0 && (
                <p className="bloque-objetivos">{t('material.objetivos', { lista: leccion.objetivos.join('; ') })}</p>
              )}
              <div className="bloque-acciones">
                {apuntes && (
                  <button className="boton boton-principal" onClick={() => irARuta(`#/foco/${apuntes.id}`)}>
                    {t('material.estudiar')}
                  </button>
                )}
                {apuntes && (
                  <button className="boton" disabled={!!enCurso} onClick={() => setPreguntando({ forzar: true })}>
                    {t('material.rehacer')}
                  </button>
                )}
                {apuntes?.ficheros.includes('pdf') && (
                  <a className="boton" href={fichero(apuntes, 'pdf')} target="_blank" rel="noreferrer">
                    {t('material.apuntesPdf')}
                  </a>
                )}
                {diapos?.ficheros.includes('diapositivas_pdf') && (
                  <a className="boton" href={fichero(diapos, 'diapositivas_pdf')} target="_blank" rel="noreferrer">
                    {t('material.diapositivasPdf')}
                  </a>
                )}
                {apuntes && (
                  <label className="estilo-pdf">
                    {t('material.estiloPdf')}
                    <select value={estilo} onChange={(e) => cambiarEstilo(e.target.value)} disabled={!!enCurso}>
                      <option value="libro">{t('material.estilo.libro')}</option>
                      <option value="ficha">{t('material.estilo.ficha')}</option>
                    </select>
                  </label>
                )}
                {/* Lo que se usa poco (y lo que no tiene vuelta atrás), recogido: a la vista, solo lo de estudiar. */}
                <details className="bloque-mas">
                  <summary className="boton">{t('material.mas')}</summary>
                  <div className="bloque-mas-menu">
                    <Colores leccion={clave} />
                    {apuntes && (
                      <button className="boton peligro" disabled={!!enCurso} onClick={() => borrar('todo')}>
                        {t('material.borrarMaterial')}
                      </button>
                    )}
                  </div>
                </details>
              </div>
              {apuntes && apuntes.estado !== 'listo' && apuntes.motivo && (
                <p className="nota">{motivoLegible(apuntes.motivo, contrato)}</p>
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
            titulo={t('material.materialDe', { clave })}
            preguntas={
              modoVista === 'video'
                ? preguntasMaterial().map((q) => (q.id === 'tipos' ? { ...q, porDefecto: ['apuntes', 'guion'] } : q))
                : preguntasMaterial()
            }
            boton={preguntando.forzar ? t('material.rehacer') : t('material.generar')}
            alTerminar={(r) => generar(preguntando.forzar, r)}
            alSaltar={() => setPreguntando(null)}
            textoSaltar={t('material.cancelar')}
          />
        )}
        {preguntando && clave && <BarraCuota accion={{ accion: 'material' }} />}

        {trabajo && (enCurso || trabajo.estado === 'fallido') && (
          <div className="progreso" role="status">
            {trabajo.estado === 'fallido' ? (
              <TextoError texto={trabajo.error} antes={t('material.noPrepara')} rol="status" />
            ) : (
              <Pensando
                texto={
                  trabajo.estado === 'pendiente'
                    ? textoCola(trabajo.cola)
                    : `${nombreNodo(trabajo.nodo)}${trabajo.total > 1 ? t('material.bloqueDe', { n: trabajo.paso + 1, total: trabajo.total }) : ''}`
                }
              />
            )}
            {enCurso && (
              <>
                <span className="barra">
                  <span style={{ width: `${Math.max(2, avance)}%` }} />
                </span>
                <button
                  className="boton-mini"
                  onClick={() =>
                    pedir(`/api/trabajos/${trabajo.id}/cancelar`, { method: 'POST' }).catch((e) => setError(t('material.noCancela', { motivo: mensajeDe(e) })))
                  }
                >
                  {t('material.cancelar')}
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
                        bloques: Object.fromEntries(Object.entries(contrato).map(([k, ti]) => [ti, k])),
                        alRehacer: async (claveBloque, como) => {
                          try {
                            const r = await pedir<{ texto: string }>(
                              `/api/materiales/${datos.materiales.apuntes!.id}/bloques/${claveBloque}/rehacer`,
                              enviarJson({ como }),
                            )
                            setTextos((x) => ({ ...x, apuntes: r.texto }))
                          } catch (e) {
                            alert(t('material.noRehace', { motivo: errorLegible(mensajeDe(e)).mensaje }))
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
                <iframe title={t('material.pest.diapositivas')} src={fichero(diapos, 'html')} />
                <p className="nota">
                  {t('material.visorAyuda')}{' '}
                  <button className="boton-mini peligro" onClick={() => borrar('diapositivas')}>
                    {t('material.borrarDiapos')}
                  </button>
                </p>
              </div>
            )}
            {pestana === 'guion' && textos.guion && (
              <>
                <TextoLibro markdown={textos.guion} className="guion" />
                <p className="nota">
                  <button className="boton-mini peligro" onClick={() => borrar('guion')}>
                    {t('material.borrarGuion')}
                  </button>
                </p>
              </>
            )}
            {pestana === 'diapositivas' && !diapos && !enCurso && (
              <Vacio
                etiqueta={t('material.sinDiapos.etq')}
                titulo={t('material.sinDiapos.titulo')}
                texto={t('material.sinDiapos.texto')}
                acciones={[{ texto: t('material.sinDiapos.hacer'), principal: true, alPulsar: () => pedirExtra('diapositivas') }]}
              >
                <BarraCuota accion={{ accion: 'diapositivas' }} />
              </Vacio>
            )}
            {pestana === 'guion' && !guion && !enCurso && (
              <Vacio
                etiqueta={t('material.sinGuion.etq')}
                titulo={t('material.sinGuion.titulo')}
                texto={t('material.sinGuion.texto')}
                acciones={[{ texto: t('material.sinGuion.hacer'), principal: true, alPulsar: () => pedirExtra('guion') }]}
              >
                <BarraCuota accion={{ accion: 'video', minutos: 6 }} />
              </Vacio>
            )}
          </>
        )}
        {datos && !apuntes && !enCurso && !preguntando && (
          <Vacio
            etiqueta={t('material.sinPreparar.etq')}
            titulo={t('material.sinPreparar.titulo')}
            texto={t('material.sinPreparar.texto')}
            acciones={[
              { texto: t('material.sinPreparar.recomendado'), principal: true, alPulsar: () => generar(false, RECOMENDADO) },
              { texto: t('material.sinPreparar.elegir'), alPulsar: () => setPreguntando({ forzar: false }) },
            ]}
          >
            <ul className="vacio-avance">
              {AVANCE.map((a) => (
                <li key={a}>
                  <strong>{t(`material.avance.${a}` as Clave)}</strong>
                  <span>{t(`material.avance.${a}.x` as Clave)}</span>
                </li>
              ))}
            </ul>
            <BarraCuota accion={{ accion: 'material' }} />
          </Vacio>
        )}
        {guion && !textos.guion && pestana === 'guion' && <p className="nota">{t('material.cargandoGuion')}</p>}
      </section>
    </div>
  )
}
