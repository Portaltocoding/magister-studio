import { useCallback, useEffect, useState } from 'react'
import { idiomaActual, t, type Clave } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import { masReciente, olvidarPlan, planActivo, recordarPlan } from '../componentes/planActivo.ts'
import { colorDeTema } from '../componentes/colorTema.ts'
import { BotonLibro, guardarIndice, TituloEditable, tituloSencillo, usarIndice, type IndicePlan } from '../componentes/indice.tsx'
import Horario from '../componentes/Horario.tsx'
import VideosDelPlan from '../componentes/VideosDelPlan.tsx'
import Cargando, { mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import BarraCuota from '../componentes/BarraCuota.tsx'
import { localeActual, pluralT } from '../componentes/formato.ts'
import { NIVELES_FUENTES, etiquetaFuentes } from '../PropuestaPlan.tsx'
import {
  algunaBuscando,
  avisoIncompleta,
  chipNecesidad,
  enTusFuentes,
  lineaFuente,
  resumenBiblioteca,
  textoApuntes,
  textoResearch,
  textoSinFuente,
} from '../componentes/bibliotecaLeccion.ts'
import {
  EVENTO_CAMBIO_APLICADO,
  type CambioAplicado,
  enviarJson,
  hoyIso,
  pedir,
  rutaExamen,
  lanzarResearch,
  listarPlanes,
  marcarSesion,
  recalcularPlan,
  verPlan,
  type LeccionVista,
  type NecesitaFuentes,
  type ResumenPlan,
  type SesionPlan,
  type VistaPlan,
} from '../api.ts'

const MAX_A_LA_VISTA = 4 // fuentes que se ven al desplegar; las demás, con «Ver N más»

// Las ideas de proyecto que el plan deja al final de su razonamiento, una por línea («Proyecto: …»).
const ideasDeProyecto = (razonamiento: string) =>
  razonamiento
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => /^proyecto:/i.test(x))
    .map((x) => x.replace(/^proyecto:\s*/i, ''))
    .filter(Boolean)
    .slice(0, 3)

// El chip de la lección es también su control: tres opciones, con el porqué en el title.
function ChipFuentes({ leccion, alCambiar }: { leccion: LeccionVista; alCambiar: (v: NecesitaFuentes) => Promise<void> }) {
  const [guardando, setGuardando] = useState(false)
  // El select enseña la etiqueta guardada; si tu material la cambia, la nota dice la que se usa.
  const { valor, nota } = chipNecesidad(leccion)
  return (
    <>
    <select
      className="chip chip-fuentes"
      value={valor}
      disabled={guardando}
      title={leccion.fuentes_por_que || t('plan.fuentesTitulo')}
      aria-label={t('plan.fuentesAria', { clave: leccion.clave })}
      onChange={async (e) => {
        setGuardando(true)
        try {
          await alCambiar(e.target.value as NecesitaFuentes)
        } finally {
          setGuardando(false)
        }
      }}
    >
      {NIVELES_FUENTES.map((k) => (
        <option key={k} value={k}>
          {etiquetaFuentes(k)}
        </option>
      ))}
    </select>
    {nota && (
      <span className="nota" title={leccion.fuentes_por_que}>
        {' '}
        ({nota})
      </span>
    )}
    </>
  )
}

// La pequeña biblioteca de una lección: plegada, una línea («3 fuentes · cubre 3 de 4 objetivos»); al desplegar, una
// línea por fuente, los objetivos sin fuente con «Buscar esto» y cómo va la búsqueda.
function BibliotecaDeLeccion({
  leccion,
  alBuscar,
  alAvisar,
}: {
  leccion: LeccionVista
  alBuscar: (objetivos?: number[]) => Promise<void>
  alAvisar: (texto: string) => void
}) {
  const [todas, setTodas] = useState(false)
  const [abierta, setAbierta] = useState(false)
  const b = leccion.biblioteca
  if (!b) return null
  const visibles = todas ? b.fuentes : b.fuentes.slice(0, MAX_A_LA_VISTA)
  const research = textoResearch(b.research)
  const cuesta = b.sin_fuente.length > 0 || b.research === 'cortada'
  return (
    <details className="biblioteca-leccion" onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary>
        <span className="biblioteca-leccion-titulo">{t('plan.fuentesDeLeccion')}</span>{' '}
        <span className="nota-linea">{resumenBiblioteca(b, leccion.objetivos.length)}</span>
      </summary>
      {b.fuentes.length > 0 && (
        <ul>
          {visibles.map((f) => (
            <li key={f.propuesta_id} className={`fuente-${f.estado}`}>
              <a href={f.url} target="_blank" rel="noreferrer" title={f.resumen ?? undefined}>
                {lineaFuente(f)}
              </a>
              {f.incompleta && (
                <span className="aviso-incompleta">
                  {avisoIncompleta(f.incompleta)}{' '}
                  {f.fuente_id != null && (
                    <button className="boton-mini" onClick={() => irARuta(`#/temas/${f.fuente_id}`)}>
                      {t('biblioteca.subirPdf')}
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
          {!todas && b.fuentes.length > MAX_A_LA_VISTA && (
            <li>
              <button className="enlace" onClick={() => setTodas(true)}>
                {t('plan.verMas', { n: b.fuentes.length - MAX_A_LA_VISTA })}
              </button>
            </li>
          )}
        </ul>
      )}
      {b.sin_fuente.length > 0 && (
        <ul className="biblioteca-leccion-huecos">
          {b.sin_fuente.map((i) => (
            <li key={i}>
              {textoSinFuente([i], leccion.objetivos)}{' '}
              <button
                className="boton-mini"
                disabled={b.research === 'buscando'}
                onClick={() => alBuscar([i]).catch((e) => alAvisar(mensajeDe(e)))}
              >
                {t('plan.buscarEsto')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {research && (
        <p className="nota-linea" role="status">
          {research}{' '}
          {b.research === 'cortada' && (
            <button className="boton-mini" onClick={() => alBuscar().catch((e) => alAvisar(mensajeDe(e)))}>
              {t('plan.reintentar')}
            </button>
          )}
        </p>
      )}
      {abierta && cuesta && b.research !== 'buscando' && <BarraCuota accion={{ accion: 'research' }} compacta />}
      {!b.fuentes.length && !b.sin_fuente.length && !research && (
        <p className="nota-linea">{t('plan.sinBuscar')}</p>
      )}
    </details>
  )
}

// Los apuntes se hicieron sin las fuentes que hay ahora: un aviso con botón, nunca se rehacen solos.
function AvisoApuntes({ leccion, alRehacer }: { leccion: LeccionVista; alRehacer: () => Promise<void> }) {
  const [enviando, setEnviando] = useState(false)
  const n = leccion.biblioteca ? enTusFuentes(leccion.biblioteca).filter((f) => f.estado === 'lista').length : 0
  const texto = n
    ? textoApuntes(leccion.apuntes_fuentes, n)
    : textoApuntes(leccion.apuntes_fuentes, leccion.sin_material ? 0 : leccion.fuentes, 'fragmento')
  if (!texto) return null
  return (
    <div className="aviso-apuntes nota-linea">
      {texto}{' '}
      <button
        className="boton-mini"
        disabled={enviando}
        onClick={async () => {
          setEnviando(true)
          try {
            await alRehacer()
          } finally {
            setEnviando(false)
          }
        }}
      >
        {t('plan.rehacerConEllas')}
      </button>
      <BarraCuota accion={{ accion: 'material' }} compacta />
    </div>
  )
}

// Lo mismo que en Progreso: «estudiada» es que hiciste sus sesiones; dominarla es otra cosa (eso lo dice Progreso).
const estadoLeccion = (e: string): string => (['hecha', 'en_curso', 'pendiente'].includes(e) ? t(`plan.leccion.${e}` as Clave) : e)

// Números según el idioma: coma decimal en español.
const num = (n: number | null | undefined) => (n == null ? '0' : idiomaActual() === 'en' ? String(n) : String(n).replace('.', ','))

interface Props {
  alNuevoPlan: () => void
  temaInicial?: number | null
}

export const fechaCorta = (iso: string | null) =>
  iso
    ? new Date(iso + 'T12:00:00').toLocaleDateString(localeActual(), { weekday: 'short', day: 'numeric', month: 'short' })
    : '·'

const pct = (x: number) => `${Math.round(x * 100)}${idiomaActual() === 'en' ? '%' : ' %'}`
// Para el ancho de una barra: CSS no admite «0 %» (con espacio) y la barra salía llena.
const anchoPct = (x: number) => `${Math.max(0, Math.min(100, Math.round(x * 100)))}%`

// Roadmap: tus planes aceptados, sus lecciones con ideas clave y el calendario por semanas.
export default function PanelPlan({ alNuevoPlan, temaInicial }: Props) {
  usarIdioma() // los textos siguen al idioma
  const [planes, setPlanes] = useState<ResumenPlan[] | null>(null)
  const [tema, setTema] = useState<number | null>(temaInicial ?? null)
  const [vista, setVista] = useState<VistaPlan | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [horario, setHorario] = useState(false)
  const indiceGuardado = usarIndice(vista?.plan_id)
  const [indiceNuevo, setIndiceNuevo] = useState<IndicePlan | null>(null)
  const [haciendoIndice, setHaciendoIndice] = useState(false)
  const indice = indiceNuevo ?? indiceGuardado
  // Qué material tiene ya cada lección (lo mismo que dice Lecciones).
  const [material, setMaterial] = useState<Record<string, { tipos: Record<string, string>; en_marcha?: boolean }>>({})
  const cargarMaterial = useCallback(() => {
    if (vista) pedir<Record<string, { tipos: Record<string, string>; en_marcha?: boolean }>>(`/api/planes/${vista.plan_id}/materiales`).then(setMaterial).catch(() => undefined)
  }, [vista])
  useEffect(cargarMaterial, [cargarMaterial])
  const [reajuste, setReajuste] = useState<{ cambios: string[]; avisos: string[]; texto: string; sesiones: unknown[] | null } | null>(null)

  const [falloCarga, setFalloCarga] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const reintentar = useCallback(() => {
    setFalloCarga(null)
    setIntento((x) => x + 1)
  }, [])
  useEffect(() => {
    listarPlanes()
      .then((ps) => {
        setPlanes(ps)
        if (ps.length && tema == null) setTema(planActivo(ps)!.tema_id)
      })
      .catch((e) => setFalloCarga(mensajeDe(e)))
  }, [tema, intento])

  // Las tarjetas de arriba (fecha de fin, progreso) salen de /api/planes: tras cambiar el calendario se vuelven a pedir.
  const recargarPlanes = useCallback(() => {
    listarPlanes()
      .then(setPlanes)
      .catch(() => undefined)
  }, [])

  const cargar = useCallback(() => {
    if (tema == null) return
    verPlan(tema)
      .then(setVista)
      .catch((e) => setAviso(String(e.message)))
  }, [tema])

  useEffect(cargar, [cargar])

  // El asesor ha movido, marcado o preparado algo de este plan: se recargan el plan y su material.
  useEffect(() => {
    const al = (e: Event) => {
      const id = (e as CustomEvent<CambioAplicado>).detail.plan_id
      if (id != null && id === vista?.plan_id) {
        cargar()
        cargarMaterial()
        recargarPlanes()
      }
    }
    window.addEventListener(EVENTO_CAMBIO_APLICADO, al)
    return () => window.removeEventListener(EVENTO_CAMBIO_APLICADO, al)
  }, [cargar, cargarMaterial, recargarPlanes, vista?.plan_id])

  // Mientras alguna lección busca fuentes, se refresca cada 5 s; cuando ninguna busca, para.
  const buscando = vista ? algunaBuscando(vista.lecciones) : false
  useEffect(() => {
    if (!buscando) return
    const i = window.setInterval(cargar, 5000)
    return () => window.clearInterval(i)
  }, [buscando, cargar])

  // «Buscar fuentes» (toda la lección) o «Buscar esto» (un objetivo): dos llamadas al modelo, con su BarraCuota.
  const buscarPara = async (clave: string, objetivos?: number[]) => {
    if (!vista) return
    // Pedido en su fila: busca aunque la lección esté marcada «no» («buscar igualmente»).
    await lanzarResearch(vista.plan_id, [clave], objetivos ? { objetivos, forzar: true } : { forzar: true })
    setAviso(t('plan.buscandoPara', { clave }))
    cargar()
  }

  // Si la lección necesita fuentes: lo cambias tú (con «no», ni el research automático ni el de todo el plan la buscan).
  const cambiarNecesidad = async (clave: string, valor: NecesitaFuentes) => {
    if (!vista) return
    try {
      await pedir(`/api/planes/${vista.plan_id}/lecciones/${clave}/fuentes`, enviarJson({ necesita_fuentes: valor }, 'PATCH'))
      cargar()
    } catch (e) {
      setAviso(mensajeDe(e))
    }
  }

  // Rehacer los apuntes con las fuentes que hay ahora: solo los apuntes, tus preguntas se quedan.
  const rehacerApuntes = async (clave: string) => {
    if (!vista) return
    try {
      await pedir(`/api/planes/${vista.plan_id}/lecciones/${clave}/material`, enviarJson({ tipos: ['apuntes'] }))
      setAviso(t('plan.rehaciendo', { clave }))
      cargarMaterial()
    } catch (e) {
      setAviso(mensajeDe(e))
    }
  }

  const borrarPlan = async () => {
    if (tema == null || !vista) return
    const nombre = planes?.find((x) => x.tema_id === tema)?.tema ?? t('plan.estePlan')
    const ok = confirm(t('plan.confirmarBorrar', { nombre, n: vista.lecciones.length }))
    if (!ok) return
    try {
      await pedir(`/api/temas/${tema}/plan`, { method: 'DELETE' })
      setVista(null)
      setTema(null)
      const ps = await listarPlanes()
      setPlanes(ps)
      // El más reciente de los que quedan (antes, el primero de la lista), o ninguno si no queda.
      const siguiente = masReciente(ps)
      if (siguiente) {
        recordarPlan(siguiente.tema_id)
        setTema(siguiente.tema_id)
      } else {
        olvidarPlan()
      }
      setAviso(t('plan.borrado', { nombre }))
    } catch (e) {
      setAviso(String((e as Error).message))
    }
  }

  const atrasado = async () => {
    if (tema == null) return
    try {
      setVista(await recalcularPlan(tema, hoyIso()))
      setAviso(t('plan.recalculado'))
      recargarPlanes()
    } catch (e) {
      setAviso(String((e as Error).message))
    }
  }

  if (planes == null) return <Cargando error={falloCarga} reintentar={reintentar} />

  if (!planes.length)
    return (
      <div className="panel">
        <h1>{t('plan.titulo')}</h1>
        <Vacio
          etiqueta={t('vacio.plan.etq')}
          titulo={t('vacio.plan.titulo')}
          texto={t('vacio.plan.texto')}
          pasos={[
            { titulo: t('vacio.plan.p1.t'), texto: t('vacio.plan.p1.x') },
            { titulo: t('vacio.plan.p2.t'), texto: t('vacio.plan.p2.x') },
            { titulo: t('vacio.plan.p3.t'), texto: t('vacio.plan.p3.x') },
          ]}
          acciones={[{ texto: t('vacio.crearPlan'), principal: true, alPulsar: alNuevoPlan }]}
        />
      </div>
    )

  return (
    <div className="panel">
      <div className="cabecera-panel">
        <h1>{t('plan.titulo')}</h1>
        <button className="boton" onClick={alNuevoPlan}>
          {t('plan.nuevo')}
        </button>
      </div>
      <div className="tarjetas">
        {planes.map((p) => (
          <button
            key={p.plan_id}
            className="tarjeta"
            aria-pressed={p.tema_id === tema}
            onClick={() => {
              recordarPlan(p.tema_id) // el plan con el que estás, para toda la app
              setTema(p.tema_id)
            }}
          >
            <strong className="con-punto-tema">
              <span className="punto-tema" style={colorDeTema(p.tema_id, planes)?.estilo} aria-hidden="true" />
              {p.tema}
            </strong>
            <span className="nota">
              {pluralT(p.lecciones, 'plan.leccion', 'plan.lecciones')} · {num(p.total_horas)} h · {t('plan.acaba', { fecha: fechaCorta(p.fin) })}
            </span>
            <span className="barra" aria-label={t('plan.progresoAria', { p: pct(p.progreso) })}>
              <span style={{ width: anchoPct(p.progreso) }} />
            </span>
          </button>
        ))}
      </div>
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}
      {reajuste && (
        <section className="propuesta">
          <h2>{t('plan.reajustePropuesto')}</h2>
          {reajuste.texto && <p>{reajuste.texto}</p>}
          <ul className="nota">
            {[...reajuste.cambios, ...reajuste.avisos].map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="botones">
            <button
              className="boton boton-principal"
              onClick={async () => {
                if (tema == null || !reajuste.sesiones) return
                // Solo los campos que admite el servidor (rechaza cualquier otro): clave, fecha, inicio y horas.
                const sesiones = (reajuste.sesiones as SesionPlan[]).map(({ clave, fecha, inicio, horas }) => ({ clave, fecha, inicio, horas }))
                try {
                  setVista(await pedir<VistaPlan>(`/api/temas/${tema}/plan/reajuste/aceptar`, enviarJson({ sesiones })))
                  setReajuste(null)
                  setAviso(t('plan.reajusteAplicado'))
                  recargarPlanes()
                } catch (e) {
                  setAviso(t('plan.noAplica', { motivo: mensajeDe(e) }))
                }
              }}
            >
              {t('plan.aceptar')}
            </button>
            <button className="boton" onClick={() => setReajuste(null)}>
              {t('plan.rechazar')}
            </button>
          </div>
        </section>
      )}
      {vista && (
        <>
          <p className="nota">
            {t('plan.resumen', { version: vista.version, hechas: num(vista.horas_hechas), total: num(vista.total_horas), p: pct(vista.progreso), fin: fechaCorta(vista.fin) })}{' '}
            <button className="boton-mini" onClick={() => setHorario(!horario)}>
              {t('plan.miHorario')}
            </button>{' '}
            <button className="boton-mini peligro" onClick={borrarPlan}>
              {t('plan.borrarPlan')}
            </button>{' '}
            <button className="boton-mini" onClick={atrasado}>
              {t('plan.atrasado')}
            </button>{' '}
            <button
              className="boton-mini"
              onClick={async () => {
                if (tema == null) return
                setAviso(t('plan.calculando'))
                const r = await pedir<NonNullable<typeof reajuste>>(`/api/temas/${tema}/plan/reajuste`, { method: 'POST' })
                setAviso(r.cambios.length ? null : t('plan.yaCuadra'))
                setReajuste(r.cambios.length ? r : null)
              }}
            >
              {t('plan.reajustar')}
            </button>
          </p>
          {horario && tema != null && (
            <Horario
              temaId={tema}
              perfil={vista.perfil}
              alCerrar={() => setHorario(false)}
              alGuardar={(v) => {
                setVista(v)
                setHorario(false)
                setAviso(t('plan.horarioGuardado', { fecha: fechaCorta(v.fin) }))
                recargarPlanes()
              }}
            />
          )}
          <section className="indice-plan">
            <h2>{t('plan.deQueVa')}</h2>
            {indice ? (
              <div className="indice-temas">
                {indice.temas.map((tm) => (
                  <div key={tm.nombre} className="indice-tema">
                    <strong>{tm.nombre}</strong>
                    <small>{tm.lecciones.map((c) => tituloSencillo(indice, c, c)).join(' · ')}</small>
                    <ul>
                      {tm.trata.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="nota">
                {t('plan.indiceIntro')}{' '}
                <button
                  className="boton-mini"
                  disabled={haciendoIndice}
                  onClick={async () => {
                    setHaciendoIndice(true)
                    try {
                      const ix = await pedir<IndicePlan>(`/api/planes/${vista.plan_id}/indice`, { method: 'POST' })
                      guardarIndice(vista.plan_id, ix)
                      setIndiceNuevo(ix)
                    } finally {
                      setHaciendoIndice(false)
                    }
                  }}
                >
                  {haciendoIndice ? t('plan.haciendo') : t('plan.hacerIndice')}
                </button>
              </p>
            )}
            <BotonLibro planId={vista.plan_id} />
          </section>
          <div className="dos-columnas">
            <section>
              <h2>{t('plan.lecciones.titulo')}</h2>
              <ol className="lecciones">
                {vista.lecciones.map((l) => (
                  <li key={l.clave} className={`leccion-${l.estado}`}>
                    <strong title={l.titulo}>
                      {l.clave} · <TituloEditable planId={vista.plan_id} clave={l.clave} largo={l.titulo} indice={indice} />
                    </strong>{' '}
                    <span className="nota-linea">
                      {num(l.horas_hechas)}/{num(l.horas)} h · {estadoLeccion(l.estado)}
                      {l.depende_de.length ? t('plan.despuesDe', { lista: l.depende_de.join(', ') }) : ''} ·{' '}
                      {['listo', 'revisar'].includes(material[l.clave]?.tipos?.apuntes ?? '') ? (
                        <a href={`#/fichas/${vista.tema_id}/${l.clave}`}>{t('plan.apuntesListos')}</a>
                      ) : (
                        t('plan.sinPreparar')
                      )}
                      {' · '}
                      {l.sin_material ? t('plan.sinFuentesTuyas') : t('plan.fragmentosDeFuentes', { n: l.fuentes })}
                    </span>{' '}
                    <ChipFuentes leccion={l} alCambiar={(v) => cambiarNecesidad(l.clave, v)} />{' '}
                    {l.sin_material && l.biblioteca?.research !== 'buscando' && (
                      // En las que no necesitan fuentes, buscar sigue a mano, pero no como acción principal.
                      <button
                        className={l.necesita_fuentes === 'no' ? 'enlace' : 'boton-mini'}
                        onClick={() => buscarPara(l.clave).catch((e) => setAviso(mensajeDe(e)))}
                      >
                        {l.necesita_fuentes === 'no' ? t('plan.buscarIgualmente') : t('plan.buscarFuentes')}
                      </button>
                    )}
                    {l.research_auto && l.biblioteca?.research !== 'buscando' && (
                      // Por qué no se ha investigado sola (o cuándo lo hará): el botón de al lado la busca ya.
                      <span className="nota"> {l.research_auto.texto}</span>
                    )}
                    <ul>
                      {l.objetivos.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                    <AvisoApuntes leccion={l} alRehacer={() => rehacerApuntes(l.clave)} />
                    <BibliotecaDeLeccion
                      leccion={l}
                      alBuscar={(objetivos) => buscarPara(l.clave, objetivos)}
                      alAvisar={setAviso}
                    />
                    <div className="chips">
                      {l.conceptos.map((c) => (
                        <span key={c.id} className="chip">
                          {c.nombre}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
              {ideasDeProyecto(vista.razonamiento ?? '').length > 0 && (
                <>
                  <h3>{t('plan.ideasProyecto')}</h3>
                  <ul className="ideas-proyecto">
                    {ideasDeProyecto(vista.razonamiento ?? '').map((idea) => (
                      <li key={idea}>
                        {idea}{' '}
                        <button
                          className="boton-mini"
                          title={t('plan.llevarTitulo')}
                          onClick={async () => {
                            try {
                              sessionStorage.setItem('magister-idea-proyecto', idea) // PanelProyectos rellena con ella el proyecto nuevo
                              await navigator.clipboard.writeText(idea)
                            } catch {
                              // sin portapapeles, se abre Proyectos igual
                            }
                            irARuta('#/proyectos')
                          }}
                        >
                          {t('plan.llevar')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            <section>
              <VideosDelPlan
                planId={vista.plan_id}
                temaId={tema}
                preparadas={new Set(Object.keys(material).filter((c) => ['listo', 'revisar'].includes(material[c]?.tipos?.apuntes ?? '')))}
                enMarcha={new Set(Object.keys(material).filter((c) => material[c]?.en_marcha))}
                alAcabar={cargarMaterial}
              />
              {vista.examenes?.length > 0 && (
                <>
                  <h2>{t('plan.examenes')}</h2>
                  <ul className="hitos-examen">
                    {vista.examenes.map((h) => (
                      <li key={h.id} className={`${h.hecho ? 'hecho' : ''} ${h.final ? 'final' : ''}`}>
                        <span className="hito-fecha">{fechaCorta(h.fecha)}</span>
                        <span className="hito-titulo">
                          <strong>{h.titulo}</strong>
                          <small>
                            {t('plan.examenInfo', { n: h.preguntas, min: h.minutos })}
                            {h.nota != null ? t(h.hecho ? 'plan.aprobadoCon' : 'plan.mejorNota', { nota: idiomaActual() === 'en' ? h.nota.toFixed(1) : h.nota.toFixed(1).replace('.', ',') }) : ''}
                          </small>
                        </span>
                        <button className="boton-mini" onClick={() => irARuta(rutaExamen(vista.plan_id, h))}>
                          {h.hecho ? t('plan.repetir') : t('plan.hacerlo')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h2>{t('plan.calendario')}</h2>
              {vista.semanas.map((s) => (
                <div key={s.lunes} className="semana">
                  <h3>{t('plan.semanaDel', { fecha: fechaCorta(s.lunes) })}</h3>
                  {s.dias.map((d) => (
                    <div key={d.fecha} className={d.hoy ? 'dia dia-hoy' : 'dia'}>
                      <span className="dia-fecha">{fechaCorta(d.fecha)}</span>
                      <ul>
                        {d.sesiones.map((x) => (
                          <li key={x.id} className={`sesion-${x.estado}`}>
                            {x.inicio ?? ''} {x.clave} {x.titulo} · {num(x.horas)} h
                            <select
                              aria-label={t('plan.estadoDe', { clave: x.clave, fecha: d.fecha })}
                              value={x.estado}
                              onChange={async (e) => {
                                await marcarSesion(x.id, e.target.value as typeof x.estado)
                                cargar()
                                recargarPlanes() // el progreso de la tarjeta
                              }}
                            >
                              <option value="pendiente">{t('plan.sesion.pendiente')}</option>
                              <option value="hecha">{t('plan.sesion.hecha')}</option>
                              <option value="saltada">{t('plan.sesion.saltada')}</option>
                            </select>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
