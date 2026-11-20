import { useCallback, useEffect, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import { pluralT } from '../componentes/formato.ts'
import {
  cancelarTrabajo,
  crearFuente,
  decidirPropuesta,
  enviarJson,
  incorporarPropuestas,
  lanzarResearch,
  listarDocumentos,
  listarFuentes,
  listarPlanes,
  listarPropuestas,
  listarTemas,
  pedir,
  reintentarVersion,
  resumenFuentes,
  subirUrl,
  ultimaIncorporacion,
  verIncorporacion,
  verPlan,
  verResearch,
  type DocumentoInfo,
  type DocumentoResumen,
  type Fuente,
  type Incorporacion,
  type PropuestaInfo,
  type ResumenFuentes,
  type Tema,
} from '../api.ts'
import Pensando from '../componentes/Pensando.tsx'
import Cargando, { DetalleTecnico, mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import { agruparPorTema, colorDeTema } from '../componentes/colorTema.ts'
import { avisoIncompleta } from '../componentes/bibliotecaLeccion.ts'
import { irARuta } from '../componentes/Vacio.tsx'

// Lo que entró a medias (un muro de pago, solo el resumen): el aviso y el camino para subir el PDF a esa fuente.
function AvisoIncompleta({ motivo, fuenteId }: { motivo: string | null | undefined; fuenteId: number | null | undefined }) {
  if (!motivo) return null
  return (
    <span className="aviso-incompleta" role="note">
      {avisoIncompleta(motivo)}{' '}
      {fuenteId != null && (
        <button className="boton-mini" onClick={() => irARuta(`#/temas/${fuenteId}`)}>
          {t('biblioteca.subirPdf')}
        </button>
      )}
    </span>
  )
}

// Cada grupo de lo que entró, con el punto de color de su tema y su nombre (el color nunca va solo).
function NombreTema({ temaId, nombre, temas }: { temaId: number | null; nombre: string | null | undefined; temas: readonly number[] }) {
  if (temaId == null) return <span className="tema-etiqueta">{t('biblioteca.sinTema')}</span>
  return (
    <span className="tema-etiqueta">
      <span className="punto-tema" style={colorDeTema(temaId, temas)?.estilo} aria-hidden="true" />
      {nombre ?? t('biblioteca.temaN', { id: temaId })}
    </span>
  )
}

// Los temas de tus planes, en el orden de /api/planes: así cada tema sale con el mismo color que en el resto de la app.
function usarTemasDePlanes(): number[] {
  const [temas, setTemas] = useState<number[]>([])
  useEffect(() => {
    listarPlanes()
      .then((ps) => setTemas(ps.map((p) => p.tema_id)))
      .catch(() => undefined)
  }, [])
  return temas
}

// La Biblioteca, más allá de tus fuentes: rastrear la web en busca de buenas fuentes y guardar páginas o PDF
// desde un enlace (se descargan, se limpian y se indexan para que el tutor las cite).

const textoEstado = (e: string, corto = false): string =>
  e === 'lista' && corto
    ? t('biblioteca.estado.listaCitar')
    : ['recibida', 'pendiente', 'lista', 'cuarentena', 'retirada'].includes(e)
      ? t(`biblioteca.estado.${e}` as 'biblioteca.estado.lista')
      : e

// La fuente donde van las webs: la que elijas o, si no, la de tipo web (se crea la primera vez).
async function fuenteWeb(fuentes: Fuente[], elegida: number | null): Promise<number> {
  if (elegida != null) return elegida
  const web = fuentes.find((f) => f.tipo === 'web')
  if (web) return web.id
  return (await crearFuente(t('biblioteca.nombreWeb'), 'web', 1)).id
}

// Cómo terminó la búsqueda de una lección, con qué hacer si no salió nada.
function comoAcabo(clave: string, estado: string, motivo: string | null, solas = false): string {
  const sinMotivo = t('biblioteca.sinMotivo')
  const hacer = t('biblioteca.queHacer')
  if (estado === 'cortada') return t('biblioteca.cortada', { clave, motivo: motivo ?? sinMotivo, hacer })
  const n = /^(\d+) propuestas/.exec(motivo ?? '')
  if (n && Number(n[1]) > 0)
    return t(solas ? 'biblioteca.acabadaSolas' : 'biblioteca.acabada', { clave, n: pluralT(Number(n[1]), 'biblioteca.propuesta', 'biblioteca.propuestas') })
  if (n) return t('biblioteca.sinPropuestas', { clave, hacer })
  return t('biblioteca.noSalio', { clave, motivo: motivo ?? sinMotivo, hacer })
}

interface Encontrada {
  url: string
  titulo: string
  motivo: string
}

function Buscar() {
  usarIdioma() // los textos siguen al idioma
  const [consulta, setConsulta] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [encontradas, setEncontradas] = useState<Encontrada[] | null>(null)
  const [guardadas, setGuardadas] = useState<Set<string>>(new Set())
  const [propuestas, setPropuestas] = useState<PropuestaInfo[]>([])
  const [lecciones, setLecciones] = useState<{ plan_id: number; clave: string; titulo: string }[]>([])
  const [leccion, setLeccion] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [fuentes, setFuentes] = useState<Fuente[]>([])
  // Sube cuando algo nuevo entra en tus fuentes: el resumen de arriba y el último trabajo de incorporar se recargan.
  const [senal, setSenal] = useState(0)

  const cargarPropuestas = useCallback(() => listarPropuestas().then(setPropuestas).catch(() => undefined), [])
  useEffect(() => {
    cargarPropuestas()
    listarFuentes()
      .then(setFuentes)
      .catch(() => undefined)
    // Las lecciones de todos los planes, pedidas a la vez. Si fallan, la búsqueda libre sigue funcionando.
    listarPlanes()
      .then((ps) => Promise.all(ps.map((p) => verPlan(p.tema_id).then((v) => ({ p, v })))))
      .then((vs) => setLecciones(vs.flatMap(({ p, v }) => v.lecciones.map((l) => ({ plan_id: p.plan_id, clave: l.clave, titulo: l.titulo })))))
      .catch((e) => setAviso(t('biblioteca.noLecciones', { motivo: mensajeDe(e) })))
  }, [cargarPropuestas])

  // Mientras busca para una lección, las propuestas van llegando y se mira cada tarea hasta que acaba.
  const [enMarcha, setEnMarcha] = useState<{ id: number; clave: string }[]>([])
  useEffect(() => {
    if (!enMarcha.length) return
    let vivo = true
    const mirar = async () => {
      cargarPropuestas()
      const estados = await Promise.all(
        enMarcha.map((tarea) =>
          verResearch(tarea.id).then(
            (r) => ({ tarea, r }),
            () => ({ tarea, r: null }),
          ),
        ),
      )
      if (!vivo) return
      const acabadas = estados.flatMap(({ tarea, r }) => (r && r.estado !== 'en_curso' ? [{ tarea, r }] : []))
      if (!acabadas.length) return
      setAviso(acabadas.map(({ tarea, r }) => comoAcabo(tarea.clave, r.estado, r.motivo_fin, r.incorporar)).join(' '))
      const ids = new Set(acabadas.map(({ tarea }) => tarea.id))
      setEnMarcha((ts) => ts.filter((x) => !ids.has(x.id)))
      if (acabadas.some(({ r }) => r.incorporar)) setSenal((n) => n + 1)
    }
    const intervalo = window.setInterval(mirar, 5000)
    // Tope de seguridad: si en 15 minutos no ha acabado, deja de mirar.
    const tope = window.setTimeout(() => {
      setEnMarcha([])
      setAviso(t('biblioteca.sigueSinAcabar'))
    }, 15 * 60 * 1000)
    return () => {
      vivo = false
      window.clearInterval(intervalo)
      window.clearTimeout(tope)
    }
  }, [enMarcha, cargarPropuestas])

  const buscar = async () => {
    if (consulta.trim().length < 3) return
    setBuscando(true)
    setEncontradas(null)
    setAviso(null)
    try {
      const r = await pedir<{ propuestas: Encontrada[]; motivo_fin: string | null }>('/api/research/libre', enviarJson({ consulta: consulta.trim() }))
      setEncontradas(r.propuestas)
    } catch (e) {
      setAviso(t('biblioteca.noBusca', { motivo: (e as Error).message }))
    } finally {
      setBuscando(false)
    }
  }

  const guardar = async (url: string) => {
    try {
      const fid = await fuenteWeb(fuentes, null)
      await subirUrl(fid, url, null)
      setGuardadas((g) => new Set(g).add(url))
      listarFuentes()
        .then(setFuentes)
        .catch(() => undefined)
    } catch (e) {
      setAviso(t('biblioteca.noGuarda', { motivo: (e as Error).message }))
    }
  }

  const decidir = async (id: number, accion: 'aprobar' | 'rechazar') => {
    try {
      await decidirPropuesta(id, accion)
      setAviso(accion === 'aprobar' ? t('biblioteca.guardadaIndexa') : t('biblioteca.descartada'))
      if (accion === 'aprobar') setSenal((n) => n + 1)
    } catch (e) {
      setAviso(String((e as Error).message))
    }
    cargarPropuestas()
  }

  const elegida = lecciones.find((x) => `${x.plan_id}:${x.clave}` === leccion) ?? null
  const alAcabarIncorporar = useCallback(() => {
    cargarPropuestas()
    setSenal((n) => n + 1)
  }, [cargarPropuestas])

  return (
    <div className="panel biblioteca">
      <h1>{t('biblioteca.buscarTitulo')}</h1>
      <p className="nota">{t('biblioteca.buscarIntro')}</p>
      <EstadoFuentes senal={senal} />
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}

      <section>
        <h2>{t('biblioteca.sobreTema')}</h2>
        <form
          className="biblioteca-buscar"
          onSubmit={(e) => {
            e.preventDefault()
            buscar()
          }}
        >
          <input value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder={t('biblioteca.ejemplo')} aria-label={t('biblioteca.queBuscar')} />
          <button className="boton boton-principal" disabled={buscando || consulta.trim().length < 3}>
            {t('biblioteca.buscar')}
          </button>
        </form>
        {buscando && <Pensando texto={t('biblioteca.rastreando')} />}
        {encontradas && encontradas.length === 0 && <p className="vacio">{t('biblioteca.nadaValido')}</p>}
        {encontradas && encontradas.length > 0 && (
          <ul className="biblioteca-lista">
            {encontradas.map((p) => (
              <li key={p.url}>
                <div>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.titulo || p.url}
                  </a>
                  <small>{p.motivo}</small>
                </div>
                {guardadas.has(p.url) ? (
                  <span className="nota">{t('biblioteca.guardada')}</span>
                ) : (
                  <button className="boton-mini" onClick={() => guardar(p.url)}>
                    {t('biblioteca.guardar')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>{t('biblioteca.paraLeccion')}</h2>
        <p className="nota">{t('biblioteca.paraLeccionIntro')}</p>
        <form
          className="biblioteca-buscar"
          onSubmit={async (e) => {
            e.preventDefault()
            const l = lecciones.find((x) => `${x.plan_id}:${x.clave}` === leccion)
            if (!l) return
            try {
              const r = await lanzarResearch(l.plan_id, [l.clave], { forzar: true })
              setAviso(t('biblioteca.buscandoPara', { clave: l.clave }))
              setEnMarcha((ts) => [...ts, ...r.tareas.map((id) => ({ id, clave: l.clave }))])
            } catch (err) {
              setAviso(String((err as Error).message))
            }
          }}
        >
          <select value={leccion} onChange={(e) => setLeccion(e.target.value)} aria-label={t('biblioteca.leccion')}>
            <option value="">{t('biblioteca.eligeLeccion')}</option>
            {lecciones.map((l) => (
              <option key={`${l.plan_id}:${l.clave}`} value={`${l.plan_id}:${l.clave}`}>
                {l.clave} · {l.titulo}
              </option>
            ))}
          </select>
          <button className="boton" disabled={!leccion}>
            {t('biblioteca.buscarParaLeccion')}
          </button>
        </form>
        {enMarcha.length > 0 && <Pensando texto={t('biblioteca.buscandoEspera')} />}
      </section>

      <section>
        <h2>{t('biblioteca.porRevisar')} {propuestas.length ? `(${propuestas.length})` : ''}</h2>
        <Incorporar propuestas={propuestas} leccion={elegida} senal={senal} alAcabar={alAcabarIncorporar} />
        {propuestas.length === 0 ? (
          <p className="vacio">{t('biblioteca.sinPendientes')}</p>
        ) : (
          <ul className="biblioteca-lista">
            {propuestas.map((p) => (
              <li key={p.id}>
                <div>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.titulo || p.url}
                  </a>
                  <small>
                    {p.leccion_clave} · {p.motivo}
                  </small>
                </div>
                <span className="biblioteca-botones">
                  <button className="boton-mini" onClick={() => decidir(p.id, 'aprobar')}>
                    {t('biblioteca.guardar')}
                  </button>
                  <button className="boton-mini" onClick={() => decidir(p.id, 'rechazar')}>
                    {t('biblioteca.descartar')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

const vivo = (x: Incorporacion | null) => !!x && (x.estado === 'pendiente' || x.estado === 'en_curso')

// «Incorporar todas»: las propuestas pendientes entran en tus fuentes de una vez, por la cola y sin gastar cuota.
// Si una no se puede (no existe, no es una página, está vacía), se dice por qué y se sigue con las demás.
function Incorporar({
  propuestas,
  leccion,
  senal,
  alAcabar,
}: {
  propuestas: PropuestaInfo[]
  leccion: { plan_id: number; clave: string } | null
  senal: number
  alAcabar: () => void
}) {
  const [inc, setInc] = useState<Incorporacion | null>(null)
  const [solas, setSolas] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    ultimaIncorporacion()
      .then((r) => {
        setInc((previo) => (vivo(previo) ? previo : r.ultimo))
        setSolas(r.solas)
      })
      .catch(() => undefined)
  }, [senal])

  const id = inc?.trabajo_id
  const enMarcha = vivo(inc)
  useEffect(() => {
    if (id == null || !enMarcha) return
    const intervalo = window.setInterval(() => {
      verIncorporacion(id)
        .then((n) => {
          setInc(n)
          if (!vivo(n)) alAcabar()
        })
        .catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(intervalo)
  }, [id, enMarcha, alAcabar])

  const lanzar = async (filtro: { plan_id?: number; leccion_clave?: string }) => {
    setAviso(null)
    try {
      const r = await incorporarPropuestas(filtro)
      if (r.trabajo_id == null) {
        setAviso(t('biblioteca.sinPendientes'))
        return
      }
      setInc(await verIncorporacion(r.trabajo_id))
    } catch (e) {
      setAviso(t('biblioteca.noEmpieza', { motivo: mensajeDe(e) }))
    }
  }

  const deLeccion = leccion ? propuestas.filter((p) => p.plan_id === leccion.plan_id && p.leccion_clave === leccion.clave).length : 0
  const fallos = inc?.fallidas.length ?? 0

  return (
    <div className="biblioteca-incorporar">
      {solas && <p className="nota">{t('biblioteca.entraSolo')}</p>}
      {propuestas.length > 0 && (
        <span className="biblioteca-botones">
          <button className="boton boton-principal" disabled={enMarcha} onClick={() => lanzar({})}>
            {t('biblioteca.incorporarTodas', { n: propuestas.length })}
          </button>
          {leccion && deLeccion > 0 && (
            <button className="boton" disabled={enMarcha} onClick={() => lanzar({ plan_id: leccion.plan_id, leccion_clave: leccion.clave })}>
              {t('biblioteca.soloDe', { clave: leccion.clave, n: deLeccion })}
            </button>
          )}
        </span>
      )}
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}
      {inc && enMarcha && (
        <div role="status">
          <Pensando texto={t('biblioteca.incorporando', { van: inc.van, total: inc.total, entradas: inc.entradas, noEntran: fallos ? t('biblioteca.yNo', { n: fallos }) : '' })} />
          <button
            className="boton-mini"
            onClick={() => cancelarTrabajo(inc.trabajo_id).catch((e) => setAviso(t('biblioteca.noCancela', { motivo: mensajeDe(e) })))}
          >
            {t('biblioteca.cancelar')}
          </button>
        </div>
      )}
      {inc && !enMarcha && inc.total > 0 && (
        <div role="status">
          <p className="nota">
            {t(inc.automatica ? 'biblioteca.entraronAuto' : 'biblioteca.entraron', { entradas: inc.entradas, total: inc.total })}
            {fallos ? t(fallos === 1 ? 'biblioteca.noPudo1' : 'biblioteca.noPudoN', { n: fallos }) : '.'}
            {inc.entradas > 0 ? t('biblioteca.seIndexan') : ''}
            {inc.estado === 'cancelado' ? t('biblioteca.loCancelaste') : ''}
          </p>
          {inc.estado === 'fallido' && <TextoError texto={inc.error} antes={t('biblioteca.seParo')} className="nota" />}
          {fallos > 0 && (
            <details>
              <summary>{t('biblioteca.porQueNo')}</summary>
              <ul className="biblioteca-lista">
                {inc.fallidas.map((f) => (
                  <li key={f.propuesta_id}>
                    <div>
                      <a href={f.url} target="_blank" rel="noreferrer">
                        {f.titulo || f.url}
                      </a>
                      <small>{f.leccion_clave}</small>
                      <TextoError texto={f.motivo} rol="status" className="nota" />
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// Arriba de la Biblioteca: cuántos documentos hay listos, indexándose y con problema; qué pasó con los que fallan, con
// «Reintentar»; y lo que vino del research (lo que entró solo se ve aquí y se puede quitar).
function EstadoFuentes({ senal }: { senal: number }) {
  usarIdioma()
  const temas = usarTemasDePlanes()
  const [r, setR] = useState<ResumenFuentes | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const cargar = useCallback(() => {
    resumenFuentes()
      .then(setR)
      .catch(() => undefined)
  }, [])
  useEffect(cargar, [cargar, senal])
  const indexando = r?.indexando ?? 0
  useEffect(() => {
    if (!indexando) return
    const i = window.setInterval(cargar, 4000)
    return () => window.clearInterval(i)
  }, [indexando, cargar])

  if (!r || r.listos + r.indexando + r.con_problema === 0) return null

  const reintentar = async (d: DocumentoResumen) => {
    try {
      await reintentarVersion(d.version_id)
      setAviso(t('biblioteca.vuelveIndexar', { titulo: d.titulo }))
    } catch (e) {
      setAviso(t('biblioteca.noReintenta', { motivo: mensajeDe(e) }))
    }
    cargar()
  }
  const quitar = async (d: DocumentoResumen) => {
    if (!confirm(t('biblioteca.confirmarQuitar', { titulo: d.titulo }))) return
    try {
      await pedir(`/api/fuentes/${d.fuente_id}/documentos/${d.documento_id}`, { method: 'DELETE' })
    } catch (e) {
      setAviso(t('biblioteca.noQuita', { motivo: mensajeDe(e) }))
    }
    cargar()
  }
  const solos = r.del_research.filter((d) => d.automatica).length
  // Lo que entró a medias y no se ve ya en los problemas ni en lo del research (esas filas lo dicen ellas mismas).
  const enOtraLista = new Set([...r.problemas, ...r.del_research].map((d) => d.documento_id))
  const incompletas = (r.incompletas ?? []).filter((d) => !enOtraLista.has(d.documento_id))
  const porTema = agruparPorTema(r.del_research, temas)

  return (
    <section className="biblioteca-estado">
      <p className="nota" role="status">
        {t('biblioteca.tusFuentes', {
          listos: pluralT(r.listos, 'biblioteca.docListo', 'biblioteca.docsListos'),
          indexando: r.indexando,
          problema: r.con_problema,
        })}
        {r.incompletas?.length ? t('biblioteca.soloEnParte', { n: r.incompletas.length }) : ''}
      </p>
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}
      {r.problemas.length > 0 && (
        <ul className="biblioteca-lista">
          {r.problemas.map((d) => (
            <li key={d.documento_id}>
              <div>
                <a href={d.uri} target="_blank" rel="noreferrer">
                  {d.titulo}
                </a>
                <small>
                  {d.fuente} · {d.que_paso}
                </small>
                <AvisoIncompleta motivo={d.incompleta} fuenteId={d.fuente_id} />
                <DetalleTecnico detalle={d.motivo} />
              </div>
              {d.reintentable && (
                <button className="boton-mini" onClick={() => reintentar(d)}>
                  {t('biblioteca.reintentar')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {incompletas.length > 0 && (
        <ul className="biblioteca-lista">
          {incompletas.map((d) => (
            <li key={d.documento_id}>
              <div>
                <a href={d.uri} target="_blank" rel="noreferrer">
                  {d.titulo}
                </a>
                <small>
                  {d.tema ? `${d.tema} · ` : ''}
                  {d.fuente}
                </small>
                <AvisoIncompleta motivo={d.incompleta} fuenteId={d.fuente_id} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {r.del_research.length > 0 && (
        <details>
          <summary>
            {t('biblioteca.delResearch', { n: pluralT(r.del_research.length, 'biblioteca.documento', 'biblioteca.documentos') })}
            {solos ? ` (${pluralT(solos, 'biblioteca.entroSolo', 'biblioteca.entraronSolos')})` : ''}
          </summary>
          {porTema.map((g) => (
            <div key={g.temaId ?? 'sin'} className="biblioteca-grupo-tema">
              <h3 className="dia-tema-nombre">
                <NombreTema temaId={g.temaId} nombre={g.cosas[0]?.tema} temas={temas} />
              </h3>
              <ul className="biblioteca-lista">
                {g.cosas.map((d) => (
                  <li key={d.documento_id}>
                    <div>
                      <a href={d.uri} target="_blank" rel="noreferrer">
                        {d.titulo}
                      </a>
                      <small>
                        {d.automatica ? t('biblioteca.entroSoloUno') : t('biblioteca.loGuardasteTu')}
                        {d.leccion_clave ? t('biblioteca.para', { clave: d.leccion_clave }) : ''} · {textoEstado(d.estado, true)}
                        {d.fragmentos ? t('biblioteca.fragmentos', { n: d.fragmentos }) : ''}
                      </small>
                      <AvisoIncompleta motivo={d.incompleta} fuenteId={d.fuente_id} />
                    </div>
                    <button className="borrar" aria-label={t('biblioteca.quitar', { titulo: d.titulo })} title={t('biblioteca.quitarTitulo')} onClick={() => quitar(d)}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

function GuardarWeb() {
  usarIdioma()
  const temasPlanes = usarTemasDePlanes()
  const [texto, setTexto] = useState('')
  const [fuentes, setFuentes] = useState<Fuente[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [destino, setDestino] = useState<number | null>(null)
  const [tema, setTema] = useState<number | null>(null)
  const [docs, setDocs] = useState<DocumentoInfo[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Sin la lista de fuentes no se puede guardar: se crearía otra «Webs guardadas» aunque ya existiera.
  const [fuentesListas, setFuentesListas] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const cargarFuentes = useCallback(() => {
    setFallo(null)
    listarFuentes()
      .then((fs) => {
        setFuentes(fs)
        setDestino((d) => d ?? fs.find((f) => f.tipo === 'web')?.id ?? null)
        setFuentesListas(true)
      })
      .catch((e) => setFallo(mensajeDe(e)))
    listarTemas()
      .then(setTemas)
      .catch(() => undefined)
  }, [])
  useEffect(cargarFuentes, [cargarFuentes])

  const cargarDocs = useCallback(() => {
    if (destino != null)
      listarDocumentos(destino)
        .then(setDocs)
        .catch(() => undefined)
    else setDocs([])
  }, [destino])
  useEffect(cargarDocs, [cargarDocs])
  useEffect(() => {
    if (!docs.some((d) => d.version && ['recibida', 'pendiente'].includes(d.version.estado))) return
    const i = window.setInterval(cargarDocs, 3000)
    return () => window.clearInterval(i)
  }, [docs, cargarDocs])

  const enlaces = texto
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\/\S+$/i.test(x))

  const guardar = async () => {
    if (!enlaces.length || !fuentesListas) return
    setGuardando(true)
    setAviso(null)
    try {
      const fid = await fuenteWeb(fuentes, destino)
      setDestino(fid)
      const r = await Promise.allSettled(enlaces.map((u) => subirUrl(fid, u, tema)))
      const mal = r.filter((x) => x.status === 'rejected').length
      setAviso(t('biblioteca.enlacesEnCola', { n: pluralT(enlaces.length - mal, 'biblioteca.enlaceCola', 'biblioteca.enlacesCola') }) + (mal ? t('biblioteca.noAnadidos', { n: mal }) : ''))
      setTexto('')
      listarFuentes()
        .then(setFuentes)
        .catch(() => undefined)
      cargarDocs()
    } catch (e) {
      setAviso(t('biblioteca.noGuarda', { motivo: (e as Error).message }))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="panel biblioteca">
      <h1>{t('biblioteca.webTitulo')}</h1>
      <p className="nota">
        {t('biblioteca.webIntro')}
      </p>
      <textarea
        className="biblioteca-enlaces"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={t('biblioteca.enlacesPh')}
        aria-label={t('biblioteca.enlaces')}
        rows={4}
      />
      <div className="fila biblioteca-opciones">
        <label>
          {t('biblioteca.guardarEn')}{' '}
          <select value={destino ?? ''} onChange={(e) => setDestino(e.target.value ? Number(e.target.value) : null)}>
            {!fuentes.some((f) => f.tipo === 'web') && <option value="">{t('biblioteca.nombreWebNueva')}</option>}
            {fuentes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('biblioteca.tema')}{' '}
          <select value={tema ?? ''} onChange={(e) => setTema(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('biblioteca.sinTemaMin')}</option>
            {temas.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.nombre}
              </option>
            ))}
          </select>
        </label>
        <button className="boton boton-principal" disabled={!enlaces.length || guardando || !fuentesListas} onClick={guardar}>
          {enlaces.length > 1 ? t('biblioteca.guardarN', { n: enlaces.length }) : t('biblioteca.guardar')}
        </button>
      </div>
      <EstadoFuentes senal={docs.length} />
      {fallo && <Cargando error={fallo} reintentar={cargarFuentes} />}
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}
      {destino != null && (
        <section>
          <h2>{t('biblioteca.guardadoEnFuente')}</h2>
          {docs.length === 0 ? (
            <p className="vacio">{t('biblioteca.todaviaNada')}</p>
          ) : (
            agruparPorTema(docs, temasPlanes).map((g) => (
              <div key={g.temaId ?? 'sin'} className="biblioteca-grupo-tema">
                <h3 className="dia-tema-nombre">
                  <NombreTema temaId={g.temaId} nombre={temas.find((tm) => tm.id === g.temaId)?.nombre} temas={temasPlanes} />
                </h3>
                <ul className="biblioteca-lista">
                  {g.cosas.map((d) => (
                    <li key={d.id}>
                      <div>
                        <a href={d.uri} target="_blank" rel="noreferrer">
                          {d.titulo}
                        </a>
                        <small>
                          {d.version ? textoEstado(d.version.estado) : '·'}
                          {d.version?.motivo ? ` · ${d.version.motivo}` : ''}
                          {d.fragmentos ? t('biblioteca.fragmentos', { n: d.fragmentos }) : ''}
                        </small>
                        <AvisoIncompleta motivo={d.incompleta ?? d.version?.incompleta} fuenteId={destino} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  )
}

export default function PanelBiblioteca({ vista }: { vista: 'buscar' | 'web' }) {
  usarIdioma()
  return vista === 'buscar' ? <Buscar /> : <GuardarWeb />
}
