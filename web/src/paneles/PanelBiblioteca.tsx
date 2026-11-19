import { useCallback, useEffect, useState } from 'react'
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

// La Biblioteca, más allá de tus fuentes: rastrear la web en busca de buenas fuentes y guardar páginas o PDF
// desde un enlace (se descargan, se limpian y se indexan para que el tutor las cite).

const ESTADOS: Record<string, string> = {
  recibida: 'recibida, en cola',
  pendiente: 'texto listo, indexando',
  lista: 'guardada',
  cuarentena: 'en cuarentena',
  retirada: 'retirada',
}

const NOMBRE_WEB = 'Webs guardadas'

// La fuente donde van las webs: la que elijas o, si no, la de tipo web (se crea la primera vez).
async function fuenteWeb(fuentes: Fuente[], elegida: number | null): Promise<number> {
  if (elegida != null) return elegida
  const web = fuentes.find((f) => f.tipo === 'web')
  if (web) return web.id
  return (await crearFuente(NOMBRE_WEB, 'web', 1)).id
}

const QUE_HACER = 'Vuelve a lanzarla o sube tú un PDF o una URL.'

// Cómo terminó la búsqueda de una lección, con qué hacer si no salió nada.
function comoAcabo(clave: string, estado: string, motivo: string | null, solas = false): string {
  if (estado === 'cortada') return `La búsqueda para ${clave} se cortó (${motivo ?? 'sin motivo'}). ${QUE_HACER}`
  const n = /^(\d+) propuestas/.exec(motivo ?? '')
  if (n && Number(n[1]) > 0)
    return `Búsqueda para ${clave} acabada: ${n[1]} ${n[1] === '1' ? 'propuesta' : 'propuestas'}${solas ? ', que entran solas en tus fuentes.' : ', abajo.'}`
  if (n) return `La búsqueda para ${clave} acabó sin propuestas. ${QUE_HACER}`
  return `La búsqueda para ${clave} no salió bien (${motivo ?? 'sin motivo'}). ${QUE_HACER}`
}

interface Encontrada {
  url: string
  titulo: string
  motivo: string
}

function Buscar() {
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
      .catch((e) => setAviso(`No he podido cargar tus lecciones: ${mensajeDe(e)}`))
  }, [cargarPropuestas])

  // Mientras busca para una lección, las propuestas van llegando y se mira cada tarea hasta que acaba.
  const [enMarcha, setEnMarcha] = useState<{ id: number; clave: string }[]>([])
  useEffect(() => {
    if (!enMarcha.length) return
    let vivo = true
    const mirar = async () => {
      cargarPropuestas()
      const estados = await Promise.all(
        enMarcha.map((t) =>
          verResearch(t.id).then(
            (r) => ({ t, r }),
            () => ({ t, r: null }),
          ),
        ),
      )
      if (!vivo) return
      const acabadas = estados.flatMap(({ t, r }) => (r && r.estado !== 'en_curso' ? [{ t, r }] : []))
      if (!acabadas.length) return
      setAviso(acabadas.map(({ t, r }) => comoAcabo(t.clave, r.estado, r.motivo_fin, r.incorporar)).join(' '))
      const ids = new Set(acabadas.map(({ t }) => t.id))
      setEnMarcha((ts) => ts.filter((x) => !ids.has(x.id)))
      if (acabadas.some(({ r }) => r.incorporar)) setSenal((n) => n + 1)
    }
    const intervalo = window.setInterval(mirar, 5000)
    // Tope de seguridad: si en 15 minutos no ha acabado, deja de mirar.
    const tope = window.setTimeout(() => {
      setEnMarcha([])
      setAviso('La búsqueda sigue sin acabar. Vuelve en un rato: las propuestas aparecerán abajo.')
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
      setAviso(`No he podido buscar: ${(e as Error).message}`)
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
      setAviso(`No se pudo guardar: ${(e as Error).message}`)
    }
  }

  const decidir = async (id: number, accion: 'aprobar' | 'rechazar') => {
    try {
      await decidirPropuesta(id, accion)
      setAviso(accion === 'aprobar' ? 'Guardada en tus fuentes: se está indexando.' : 'Descartada.')
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
      <h1>Buscar fuentes</h1>
      <p className="nota">Magister rastrea la web, lee las páginas y te propone las mejores, con el porqué.</p>
      <EstadoFuentes senal={senal} />
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}

      <section>
        <h2>Sobre un tema</h2>
        <form
          className="biblioteca-buscar"
          onSubmit={(e) => {
            e.preventDefault()
            buscar()
          }}
        >
          <input value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Por ejemplo: niveles de aislamiento en Postgres" aria-label="Qué buscar" />
          <button className="boton boton-principal" disabled={buscando || consulta.trim().length < 3}>
            Buscar
          </button>
        </form>
        {buscando && <Pensando texto="Rastreando la web y leyendo páginas… (un minuto o dos)" />}
        {encontradas && encontradas.length === 0 && <p className="vacio">No he encontrado nada que valga la pena. Prueba con otras palabras.</p>}
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
                  <span className="nota">Guardada</span>
                ) : (
                  <button className="boton-mini" onClick={() => guardar(p.url)}>
                    Guardar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Para una lección de tu plan</h2>
        <p className="nota">Busca fuentes que cubran lo que pide la lección. Las propuestas llegan abajo, para que las apruebes.</p>
        <form
          className="biblioteca-buscar"
          onSubmit={async (e) => {
            e.preventDefault()
            const l = lecciones.find((x) => `${x.plan_id}:${x.clave}` === leccion)
            if (!l) return
            try {
              const r = await lanzarResearch(l.plan_id, [l.clave])
              setAviso(`Buscando fuentes para ${l.clave}. Tarda unos minutos; las propuestas aparecerán abajo.`)
              setEnMarcha((ts) => [...ts, ...r.tareas.map((id) => ({ id, clave: l.clave }))])
            } catch (err) {
              setAviso(String((err as Error).message))
            }
          }}
        >
          <select value={leccion} onChange={(e) => setLeccion(e.target.value)} aria-label="Lección">
            <option value="">Elige una lección…</option>
            {lecciones.map((l) => (
              <option key={`${l.plan_id}:${l.clave}`} value={`${l.plan_id}:${l.clave}`}>
                {l.clave} · {l.titulo}
              </option>
            ))}
          </select>
          <button className="boton" disabled={!leccion}>
            Buscar para esta lección
          </button>
        </form>
        {enMarcha.length > 0 && <Pensando texto="Buscando… las propuestas irán apareciendo" />}
      </section>

      <section>
        <h2>Propuestas por revisar {propuestas.length ? `(${propuestas.length})` : ''}</h2>
        <Incorporar propuestas={propuestas} leccion={elegida} senal={senal} alAcabar={alAcabarIncorporar} />
        {propuestas.length === 0 ? (
          <p className="vacio">No hay propuestas pendientes.</p>
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
                    Guardar
                  </button>
                  <button className="boton-mini" onClick={() => decidir(p.id, 'rechazar')}>
                    Descartar
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

const vivo = (t: Incorporacion | null) => !!t && (t.estado === 'pendiente' || t.estado === 'en_curso')

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
  const [t, setT] = useState<Incorporacion | null>(null)
  const [solas, setSolas] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    ultimaIncorporacion()
      .then((r) => {
        setT((previo) => (vivo(previo) ? previo : r.ultimo))
        setSolas(r.solas)
      })
      .catch(() => undefined)
  }, [senal])

  const id = t?.trabajo_id
  const enMarcha = vivo(t)
  useEffect(() => {
    if (id == null || !enMarcha) return
    const intervalo = window.setInterval(() => {
      verIncorporacion(id)
        .then((n) => {
          setT(n)
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
        setAviso('No hay propuestas pendientes.')
        return
      }
      setT(await verIncorporacion(r.trabajo_id))
    } catch (e) {
      setAviso(`No he podido empezar: ${mensajeDe(e)}`)
    }
  }

  const deLeccion = leccion ? propuestas.filter((p) => p.plan_id === leccion.plan_id && p.leccion_clave === leccion.clave).length : 0
  const fallos = t?.fallidas.length ?? 0

  return (
    <div className="biblioteca-incorporar">
      {solas && <p className="nota">Lo que propone la búsqueda para una lección entra solo en tus fuentes, marcado como web. Puedes quitarlo arriba.</p>}
      {propuestas.length > 0 && (
        <span className="biblioteca-botones">
          <button className="boton boton-principal" disabled={enMarcha} onClick={() => lanzar({})}>
            Incorporar todas ({propuestas.length})
          </button>
          {leccion && deLeccion > 0 && (
            <button className="boton" disabled={enMarcha} onClick={() => lanzar({ plan_id: leccion.plan_id, leccion_clave: leccion.clave })}>
              Solo las de {leccion.clave} ({deLeccion})
            </button>
          )}
        </span>
      )}
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}
      {t && enMarcha && (
        <div role="status">
          <Pensando texto={`Incorporando: van ${t.van} de ${t.total} (han entrado ${t.entradas}${fallos ? `, ${fallos} no` : ''}). No gasta cuota.`} />
          <button
            className="boton-mini"
            onClick={() => cancelarTrabajo(t.trabajo_id).catch((e) => setAviso(`No he podido cancelar: ${mensajeDe(e)}`))}
          >
            Cancelar
          </button>
        </div>
      )}
      {t && !enMarcha && t.total > 0 && (
        <div role="status">
          <p className="nota">
            {t.automatica ? 'Lo último que entró solo del research: han' : 'Han'} entrado {t.entradas} de {t.total}
            {fallos ? `; ${fallos} no se ${fallos === 1 ? 'ha' : 'han'} podido.` : '.'}
            {t.entradas > 0 ? ' Se están indexando: el tutor podrá citarlas en unos minutos.' : ''}
            {t.estado === 'cancelado' ? ' Lo cancelaste: las que faltaban siguen pendientes.' : ''}
          </p>
          {t.estado === 'fallido' && <TextoError texto={t.error} antes="El trabajo se paró: " className="nota" />}
          {fallos > 0 && (
            <details>
              <summary>Por qué no han entrado</summary>
              <ul className="biblioteca-lista">
                {t.fallidas.map((f) => (
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

const ESTADO_CORTO: Record<string, string> = { ...ESTADOS, lista: 'lista para citar' }

// Arriba de la Biblioteca: cuántos documentos hay listos, indexándose y con problema; qué pasó con los que fallan, con
// «Reintentar»; y lo que vino del research (lo que entró solo se ve aquí y se puede quitar).
function EstadoFuentes({ senal }: { senal: number }) {
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
    const t = window.setInterval(cargar, 4000)
    return () => window.clearInterval(t)
  }, [indexando, cargar])

  if (!r || r.listos + r.indexando + r.con_problema === 0) return null

  const reintentar = async (d: DocumentoResumen) => {
    try {
      await reintentarVersion(d.version_id)
      setAviso(`«${d.titulo}» vuelve a indexarse.`)
    } catch (e) {
      setAviso(`No se pudo reintentar: ${mensajeDe(e)}`)
    }
    cargar()
  }
  const quitar = async (d: DocumentoResumen) => {
    if (!confirm(`¿Quitar «${d.titulo}» de tus fuentes? El tutor dejará de citarlo.`)) return
    try {
      await pedir(`/api/fuentes/${d.fuente_id}/documentos/${d.documento_id}`, { method: 'DELETE' })
    } catch (e) {
      setAviso(`No he podido quitarlo: ${mensajeDe(e)}`)
    }
    cargar()
  }
  const solos = r.del_research.filter((d) => d.automatica).length

  return (
    <section className="biblioteca-estado">
      <p className="nota" role="status">
        Tus fuentes: {r.listos} {r.listos === 1 ? 'documento listo' : 'documentos listos'} · {r.indexando} indexándose · {r.con_problema} con problema
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
                <DetalleTecnico detalle={d.motivo} />
              </div>
              {d.reintentable && (
                <button className="boton-mini" onClick={() => reintentar(d)}>
                  Reintentar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {r.del_research.length > 0 && (
        <details>
          <summary>
            Del research: {r.del_research.length} {r.del_research.length === 1 ? 'documento' : 'documentos'}
            {solos ? ` (${solos} ${solos === 1 ? 'entró solo' : 'entraron solos'})` : ''}
          </summary>
          <ul className="biblioteca-lista">
            {r.del_research.map((d) => (
              <li key={d.documento_id}>
                <div>
                  <a href={d.uri} target="_blank" rel="noreferrer">
                    {d.titulo}
                  </a>
                  <small>
                    {d.automatica ? 'entró solo' : 'lo guardaste tú'}
                    {d.leccion_clave ? ` · para ${d.leccion_clave}` : ''} · {ESTADO_CORTO[d.estado] ?? d.estado}
                    {d.fragmentos ? ` · ${d.fragmentos} fragmentos` : ''}
                  </small>
                </div>
                <button className="borrar" aria-label={`Quitar ${d.titulo}`} title="Quitar de tus fuentes" onClick={() => quitar(d)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function GuardarWeb() {
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
    const t = window.setInterval(cargarDocs, 3000)
    return () => window.clearInterval(t)
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
      setAviso(`${enlaces.length - mal} ${enlaces.length - mal === 1 ? 'enlace en cola' : 'enlaces en cola'}: se descargan, se limpian y se indexan solos.${mal ? ` ${mal} no se pudieron añadir.` : ''}`)
      setTexto('')
      listarFuentes()
        .then(setFuentes)
        .catch(() => undefined)
      cargarDocs()
    } catch (e) {
      setAviso(`No se pudo guardar: ${(e as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="panel biblioteca">
      <h1>Guardar de la web</h1>
      <p className="nota">
        Pega uno o varios enlaces: páginas web o PDF. Magister descarga el texto, quita menús y anuncios, lo trocea y lo guarda en tus fuentes para que el tutor lo cite.
      </p>
      <textarea
        className="biblioteca-enlaces"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={'https://...\nhttps://... (uno por línea)'}
        aria-label="Enlaces"
        rows={4}
      />
      <div className="fila biblioteca-opciones">
        <label>
          Guardar en{' '}
          <select value={destino ?? ''} onChange={(e) => setDestino(e.target.value ? Number(e.target.value) : null)}>
            {!fuentes.some((f) => f.tipo === 'web') && <option value="">{NOMBRE_WEB} (nueva)</option>}
            {fuentes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tema{' '}
          <select value={tema ?? ''} onChange={(e) => setTema(e.target.value ? Number(e.target.value) : null)}>
            <option value="">sin tema (vale para todos)</option>
            {temas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <button className="boton boton-principal" disabled={!enlaces.length || guardando || !fuentesListas} onClick={guardar}>
          {enlaces.length > 1 ? `Guardar ${enlaces.length} enlaces` : 'Guardar'}
        </button>
      </div>
      <EstadoFuentes senal={docs.length} />
      {fallo && <Cargando error={fallo} reintentar={cargarFuentes} />}
      {aviso && <TextoError texto={aviso} rol="status" className="nota" />}
      {destino != null && (
        <section>
          <h2>Guardado en esta fuente</h2>
          {docs.length === 0 ? (
            <p className="vacio">Todavía nada.</p>
          ) : (
            <ul className="biblioteca-lista">
              {docs.map((d) => (
                <li key={d.id}>
                  <div>
                    <a href={d.uri} target="_blank" rel="noreferrer">
                      {d.titulo}
                    </a>
                    <small>
                      {d.version ? ESTADOS[d.version.estado] ?? d.version.estado : '·'}
                      {d.version?.motivo ? ` · ${d.version.motivo}` : ''}
                      {d.fragmentos ? ` · ${d.fragmentos} fragmentos` : ''}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

export default function PanelBiblioteca({ vista }: { vista: 'buscar' | 'web' }) {
  return vista === 'buscar' ? <Buscar /> : <GuardarWeb />
}
