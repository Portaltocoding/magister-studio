import { useCallback, useEffect, useState } from 'react'
import { planActivo, recordarPlan } from '../componentes/planActivo.ts'
import { colorDeTema } from '../componentes/colorTema.ts'
import { BotonLibro, guardarIndice, TituloEditable, tituloSencillo, usarIndice, type IndicePlan } from '../componentes/indice.tsx'
import Horario from '../componentes/Horario.tsx'
import VideosDelPlan from '../componentes/VideosDelPlan.tsx'
import Cargando, { mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import BarraCuota from '../componentes/BarraCuota.tsx'
import { plural } from '../componentes/formato.ts'
import { ETIQUETA_FUENTES } from '../PropuestaPlan.tsx'
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
      title={leccion.fuentes_por_que || 'Si hace falta buscar fuentes para esta lección'}
      aria-label={`${leccion.clave}: ¿hace falta buscar fuentes?`}
      onChange={async (e) => {
        setGuardando(true)
        try {
          await alCambiar(e.target.value as NecesitaFuentes)
        } finally {
          setGuardando(false)
        }
      }}
    >
      {(Object.keys(ETIQUETA_FUENTES) as NecesitaFuentes[]).map((k) => (
        <option key={k} value={k}>
          {ETIQUETA_FUENTES[k]}
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
        <span className="biblioteca-leccion-titulo">Fuentes de esta lección</span>{' '}
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
                      Subir el PDF
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
          {!todas && b.fuentes.length > MAX_A_LA_VISTA && (
            <li>
              <button className="enlace" onClick={() => setTodas(true)}>
                Ver {b.fuentes.length - MAX_A_LA_VISTA} más
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
                Buscar esto
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
              Reintentar
            </button>
          )}
        </p>
      )}
      {abierta && cuesta && b.research !== 'buscando' && <BarraCuota accion={{ accion: 'research' }} compacta />}
      {!b.fuentes.length && !b.sin_fuente.length && !research && (
        <p className="nota-linea">Aún no se han buscado fuentes para esta lección.</p>
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
        Rehacerlos con ellas
      </button>
      <BarraCuota accion={{ accion: 'material' }} compacta />
    </div>
  )
}

// Lo mismo que en Progreso: «estudiada» es que hiciste sus sesiones; dominarla es otra cosa (eso lo dice Progreso).
const ESTADO_LECCION: Record<string, string> = { hecha: 'estudiada', en_curso: 'empezada', pendiente: 'pendiente' }

// Números a la española: coma decimal.
const num = (n: number | null | undefined) => (n == null ? '0' : String(n).replace('.', ','))

interface Props {
  alNuevoPlan: () => void
  temaInicial?: number | null
}

export const fechaCorta = (iso: string | null) =>
  iso
    ? new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
    : '·'

const pct = (x: number) => `${Math.round(x * 100)} %`
// Para el ancho de una barra: CSS no admite «0 %» (con espacio) y la barra salía llena.
const anchoPct = (x: number) => `${Math.max(0, Math.min(100, Math.round(x * 100)))}%`

// Roadmap: tus planes aceptados, sus lecciones con ideas clave y el calendario por semanas.
export default function PanelPlan({ alNuevoPlan, temaInicial }: Props) {
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
    const t = window.setInterval(cargar, 5000)
    return () => window.clearInterval(t)
  }, [buscando, cargar])

  // «Buscar fuentes» (toda la lección) o «Buscar esto» (un objetivo): dos llamadas al modelo, con su BarraCuota.
  const buscarPara = async (clave: string, objetivos?: number[]) => {
    if (!vista) return
    // Pedido en su fila: busca aunque la lección esté marcada «no» («buscar igualmente»).
    await lanzarResearch(vista.plan_id, [clave], objetivos ? { objetivos, forzar: true } : { forzar: true })
    setAviso(`Buscando fuentes para ${clave}. Entran solas; las verás en su lección.`)
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
      setAviso(`Rehaciendo los apuntes de ${clave} con tus fuentes. Lo ves en Lecciones.`)
      cargarMaterial()
    } catch (e) {
      setAviso(mensajeDe(e))
    }
  }

  const borrarPlan = async () => {
    if (tema == null || !vista) return
    const nombre = planes?.find((x) => x.tema_id === tema)?.tema ?? 'este plan'
    const ok = confirm(
      `¿Borrar el plan «${nombre}»?\n\nSe borran sus ${vista.lecciones.length} lecciones, el calendario, los apuntes, las fichas, ` +
        'tus repasos de esos conceptos y sus exámenes. Las conversaciones se quedan. No se puede deshacer.',
    )
    if (!ok) return
    try {
      await pedir(`/api/temas/${tema}/plan`, { method: 'DELETE' })
      setVista(null)
      setTema(null)
      const ps = await listarPlanes()
      setPlanes(ps)
      if (ps.length) {
        recordarPlan(ps[0].tema_id)
        setTema(ps[0].tema_id)
      }
      setAviso(`Plan «${nombre}» borrado.`)
    } catch (e) {
      setAviso(String((e as Error).message))
    }
  }

  const atrasado = async () => {
    if (tema == null) return
    try {
      setVista(await recalcularPlan(tema, hoyIso()))
      setAviso('Calendario recalculado desde hoy. Lo hecho no se toca.')
      recargarPlanes()
    } catch (e) {
      setAviso(String((e as Error).message))
    }
  }

  if (planes == null) return <Cargando error={falloCarga} reintentar={reintentar} />

  if (!planes.length)
    return (
      <div className="panel">
        <h1>Roadmap</h1>
        <Vacio
          etiqueta="Sin plan todavía"
          titulo="Tu camino, lección a lección"
          texto="Un plan convierte «quiero aprender X» en lecciones ordenadas, con horas y fechas en tu calendario. Lo puedes cambiar cuando quieras."
          pasos={[
            { titulo: 'Cuatro preguntas', texto: 'Qué, para qué, qué sabes ya y cuánto tiempo tienes.' },
            { titulo: 'El tutor propone', texto: 'Lecciones, objetivos y calendario. Lo aceptas o lo cambias.' },
            { titulo: 'A estudiar', texto: 'Cada día, el tutor te dice qué toca.' },
          ]}
          acciones={[{ texto: 'Crear mi plan', principal: true, alPulsar: alNuevoPlan }]}
        />
      </div>
    )

  return (
    <div className="panel">
      <div className="cabecera-panel">
        <h1>Roadmap</h1>
        <button className="boton" onClick={alNuevoPlan}>
          Nuevo plan
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
              {plural(p.lecciones, 'lección', 'lecciones')} · {num(p.total_horas)} h · acaba {fechaCorta(p.fin)}
            </span>
            <span className="barra" aria-label={`Progreso ${pct(p.progreso)}`}>
              <span style={{ width: anchoPct(p.progreso) }} />
            </span>
          </button>
        ))}
      </div>
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}
      {reajuste && (
        <section className="propuesta">
          <h2>Reajuste propuesto</h2>
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
                  setAviso('Reajuste aplicado.')
                  recargarPlanes()
                } catch (e) {
                  setAviso(`No he podido aplicar el reajuste. ${mensajeDe(e)}`)
                }
              }}
            >
              Aceptar
            </button>
            <button className="boton" onClick={() => setReajuste(null)}>
              Rechazar
            </button>
          </div>
        </section>
      )}
      {vista && (
        <>
          <p className="nota">
            Versión {vista.version} · {num(vista.horas_hechas)} de {num(vista.total_horas)} h hechas ({pct(vista.progreso)}) ·
            fin previsto {fechaCorta(vista.fin)}{' '}
            <button className="boton-mini" onClick={() => setHorario(!horario)}>
              Mi horario
            </button>{' '}
            <button className="boton-mini peligro" onClick={borrarPlan}>
              Borrar el plan
            </button>{' '}
            <button className="boton-mini" onClick={atrasado}>
              Me he atrasado
            </button>{' '}
            <button
              className="boton-mini"
              onClick={async () => {
                if (tema == null) return
                setAviso('Calculando el reajuste…')
                const r = await pedir<NonNullable<typeof reajuste>>(`/api/temas/${tema}/plan/reajuste`, { method: 'POST' })
                setAviso(r.cambios.length ? null : 'Tu calendario ya cuadra con tus repasos.')
                setReajuste(r.cambios.length ? r : null)
              }}
            >
              Reajustar con mis repasos
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
                setAviso(`Horario guardado. Ahora acabas el ${fechaCorta(v.fin)}.`)
                recargarPlanes()
              }}
            />
          )}
          <section className="indice-plan">
            <h2>De qué va</h2>
            {indice ? (
              <div className="indice-temas">
                {indice.temas.map((t) => (
                  <div key={t.nombre} className="indice-tema">
                    <strong>{t.nombre}</strong>
                    <small>{t.lecciones.map((c) => tituloSencillo(indice, c, c)).join(' · ')}</small>
                    <ul>
                      {t.trata.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="nota">
                Un índice con pocos temas de nombre sencillo y de qué trata cada uno.{' '}
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
                  {haciendoIndice ? 'Haciéndolo…' : 'Hacer el índice'}
                </button>
              </p>
            )}
            <BotonLibro planId={vista.plan_id} />
          </section>
          <div className="dos-columnas">
            <section>
              <h2>Lecciones</h2>
              <ol className="lecciones">
                {vista.lecciones.map((l) => (
                  <li key={l.clave} className={`leccion-${l.estado}`}>
                    <strong title={l.titulo}>
                      {l.clave} · <TituloEditable planId={vista.plan_id} clave={l.clave} largo={l.titulo} indice={indice} />
                    </strong>{' '}
                    <span className="nota-linea">
                      {num(l.horas_hechas)}/{num(l.horas)} h · {ESTADO_LECCION[l.estado] ?? l.estado}
                      {l.depende_de.length ? ` · después de ${l.depende_de.join(', ')}` : ''} ·{' '}
                      {['listo', 'revisar'].includes(material[l.clave]?.tipos?.apuntes ?? '') ? (
                        <a href={`#/fichas/${vista.tema_id}/${l.clave}`}>apuntes listos</a>
                      ) : (
                        'sin preparar'
                      )}
                      {' · '}
                      {l.sin_material ? 'sin fuentes tuyas' : `${l.fuentes} fragmentos de tus fuentes`}
                    </span>{' '}
                    <ChipFuentes leccion={l} alCambiar={(v) => cambiarNecesidad(l.clave, v)} />{' '}
                    {l.sin_material && l.biblioteca?.research !== 'buscando' && (
                      // En las que no necesitan fuentes, buscar sigue a mano, pero no como acción principal.
                      <button
                        className={l.necesita_fuentes === 'no' ? 'enlace' : 'boton-mini'}
                        onClick={() => buscarPara(l.clave).catch((e) => setAviso(mensajeDe(e)))}
                      >
                        {l.necesita_fuentes === 'no' ? 'buscar igualmente' : 'Buscar fuentes'}
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
                  <h3>Ideas de proyecto</h3>
                  <ul className="ideas-proyecto">
                    {ideasDeProyecto(vista.razonamiento ?? '').map((idea) => (
                      <li key={idea}>
                        {idea}{' '}
                        <button
                          className="boton-mini"
                          title="Abre un proyecto nuevo con esta idea ya escrita: solo te falta ponerle nombre"
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
                          Llevar a Proyectos
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
                preparadas={new Set(Object.keys(material).filter((c) => ['listo', 'revisar'].includes(material[c]?.tipos?.apuntes ?? '')))}
                enMarcha={new Set(Object.keys(material).filter((c) => material[c]?.en_marcha))}
                alAcabar={cargarMaterial}
              />
              {vista.examenes?.length > 0 && (
                <>
                  <h2>Exámenes</h2>
                  <ul className="hitos-examen">
                    {vista.examenes.map((h) => (
                      <li key={h.id} className={`${h.hecho ? 'hecho' : ''} ${h.final ? 'final' : ''}`}>
                        <span className="hito-fecha">{fechaCorta(h.fecha)}</span>
                        <span className="hito-titulo">
                          <strong>{h.titulo}</strong>
                          <small>
                            {h.preguntas} preguntas · {h.minutos} min
                            {h.nota != null ? ` · ${h.hecho ? 'aprobado con' : 'mejor nota'} ${h.nota.toFixed(1).replace('.', ',')}` : ''}
                          </small>
                        </span>
                        <button className="boton-mini" onClick={() => irARuta(rutaExamen(vista.plan_id, h))}>
                          {h.hecho ? 'Repetir' : 'Hacerlo'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h2>Calendario</h2>
              {vista.semanas.map((s) => (
                <div key={s.lunes} className="semana">
                  <h3>Semana del {fechaCorta(s.lunes)}</h3>
                  {s.dias.map((d) => (
                    <div key={d.fecha} className={d.hoy ? 'dia dia-hoy' : 'dia'}>
                      <span className="dia-fecha">{fechaCorta(d.fecha)}</span>
                      <ul>
                        {d.sesiones.map((x) => (
                          <li key={x.id} className={`sesion-${x.estado}`}>
                            {x.inicio ?? ''} {x.clave} {x.titulo} · {num(x.horas)} h
                            <select
                              aria-label={`Estado de ${x.clave} el ${d.fecha}`}
                              value={x.estado}
                              onChange={async (e) => {
                                await marcarSesion(x.id, e.target.value as typeof x.estado)
                                cargar()
                                recargarPlanes() // el progreso de la tarjeta
                              }}
                            >
                              <option value="pendiente">pendiente</option>
                              <option value="hecha">hecha</option>
                              <option value="saltada">saltada</option>
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
