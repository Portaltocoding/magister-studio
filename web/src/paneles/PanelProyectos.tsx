import { useCallback, useEffect, useState } from 'react'
import { EVENTO_CAMBIO_APLICADO, ErrorApi, crearConversacion, enviarJson, pedir, type CambioAplicado } from '../api.ts'
import Vacio from '../componentes/Vacio.tsx'
import Diagrama from '../componentes/Diagrama.tsx'
import Pensando from '../componentes/Pensando.tsx'
import Cargando, { mensajeDe } from '../componentes/Cargando.tsx'
import { celebrar } from '../componentes/animo.ts'
import BarraCuota from '../componentes/BarraCuota.tsx'
import { avisoRehacer, perdidosAlRehacer, porDetallar, queHace, resumenRehecho, textoEnCola, type HechoQueYaNoEsta, type TrabajoProyecto } from './rehacerProyecto.ts'
import { agruparReferencias, leerIdea, olvidarIdea, tituloDePaso, type Referencia } from './referenciasProyecto.ts'

// Proyectos: le cuentas lo que quieres construir y saca el roadmap de construcción. Arriba, la explicación del
// proyecto (qué es, por qué, arquitectura, glosario, riesgos); debajo, los niveles con sus bloques y pasos. Encima de
// todo y de cada nivel y bloque, un priming de 5 líneas. Cada paso: qué haces, lo mínimo que tienes que saber antes y
// cómo sabes que está hecho. El nivel 1 sale detallado; los demás se detallan al llegar. Y un diario de decisiones.

interface Paso {
  id: string
  titulo: string
  que_haces: string
  antes: string
  hecho_si: string
  minutos: number
  aviso?: string // un comando, identificador o fichero con tildes o eñes (lo detecta el servidor)
}
interface Bloque {
  id: string
  titulo: string
  priming: string
  pasos: Paso[]
}
interface Nivel {
  id: string
  numero: number
  titulo: string
  objetivo: string
  priming: string
  mvp: boolean
  detallado: boolean
  bloques: Bloque[]
}
interface Roadmap {
  software?: boolean // false: no es un programa (una novela): sin «Arquitectura» ni «seguridad»
  resumen: string
  que_es: string
  por_que: string
  glosario: { termino: string; definicion: string }[]
  arquitectura: string
  niveles: Nivel[]
  riesgos: { riesgo: string; mitigacion: string }[]
  fuera_de_alcance: string[]
  // Si viene de rehacer otro: cuántos pasos hechos siguen y lo hecho de los que ya no están.
  conservados?: number
  no_conservados?: string[] // los ids de los hechos que el último rehacer no conservó
  ya_no_estan?: HechoQueYaNoEsta[]
}
interface Progreso {
  pasos: number
  hechos: number
  nivel: number | null
  niveles: number
}
interface ProyectoResumen {
  id: number
  nombre: string
  // en_cola: su trabajo aún no ha empezado (el proyecto se sigue usando); generando: el modelo está en ello.
  estado: 'en_cola' | 'generando' | 'listo' | 'error'
  error: string | null
  progreso: Progreso
}
interface Proyecto extends ProyectoResumen {
  idea: string
  objetivo: string | null
  sabes: string | null
  ritmo: string | null
  roadmap: Roadmap | null
  referencias: Referencia[]
  arquitectura_svg: string | null
  hechos: string[]
  hechos_en?: Record<string, string>
  anterior?: boolean // hay un roadmap de antes del último «rehacer» al que volver
  trabajo?: TrabajoProyecto | null
}
interface Decision {
  id: number
  titulo: string
  contexto: string | null
  decision: string
  consecuencias: string | null
  paso_id: string | null
  creada_en: string
}

// ---- Retomar: por dónde íbamos y a qué vamos (sin modelo, de tus datos) ----

const normal = (t: string) =>
  ` ${t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')} `

export function haceCuanto(iso: string, ahora = new Date()): string {
  const dias = Math.floor((new Date(ahora.toDateString()).getTime() - new Date(new Date(iso).toDateString()).getTime()) / 86400000)
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 14) return `hace ${dias} días`
  return `hace ${Math.round(dias / 7)} semanas`
}

interface HojaDeRuta {
  ultimoEn: string | null
  ultimos: Paso[]
  siguiente: { paso: Paso; bloque: Bloque; nivel: Nivel } | null
  frescos: { termino: string; definicion: string }[]
  restoBloque: Paso[]
  siguienteNivel: Nivel | null
  sinDetallar: Nivel | null
}

// Todo sale del roadmap y de lo marcado: el siguiente paso es el primero sin hacer en orden; lo que conviene tener
// fresco, los términos del glosario que salen en los dos pasos siguientes (o en su bloque).
export function hojaDeRuta(r: Roadmap, hechos: string[], hechosEn: Record<string, string>): HojaDeRuta {
  const hechosSet = new Set(hechos)
  const todos = r.niveles.flatMap((n) => n.bloques.flatMap((b) => b.pasos.map((paso) => ({ paso, bloque: b, nivel: n }))))
  const siguiente = todos.find((x) => !hechosSet.has(x.paso.id)) ?? null
  // Lo último que marcaste primero; con la misma fecha, el que va después en el roadmap.
  const orden = new Map(todos.map((x, i) => [x.paso.id, i]))
  const fechas = Object.entries(hechosEn).sort((a, b) => b[1].localeCompare(a[1]) || (orden.get(b[0]) ?? 0) - (orden.get(a[0]) ?? 0))
  const porId = new Map(todos.map((x) => [x.paso.id, x.paso]))
  const ultimos = fechas.map(([id]) => porId.get(id)).filter((x): x is Paso => !!x).slice(0, 3)
  let frescos: HojaDeRuta['frescos'] = []
  if (siguiente) {
    const i = todos.indexOf(siguiente)
    const proximos = todos.slice(i, i + 2).filter((x) => x.bloque.id === siguiente.bloque.id)
    const texto = normal([siguiente.bloque.titulo, ...proximos.map((x) => `${x.paso.titulo} ${x.paso.que_haces} ${x.paso.antes} ${x.paso.hecho_si}`)].join(' '))
    frescos = r.glosario
      .filter((g) => {
        const t = normal(g.termino.replace(/\(.*?\)/g, '')).trim()
        return t.length > 1 && texto.includes(` ${t} `)
      })
      .slice(0, 4)
  }
  const restoBloque = siguiente ? siguiente.bloque.pasos.filter((x) => !hechosSet.has(x.id) && x.id !== siguiente.paso.id) : []
  const nivelActual = siguiente?.nivel ?? null
  const siguienteNivel = nivelActual ? (r.niveles.find((n) => n.numero === nivelActual.numero + 1) ?? null) : null
  const sinDetallar = siguiente ? null : (r.niveles.find(porDetallar) ?? null)
  return { ultimoEn: fechas[0]?.[1] ?? null, ultimos, siguiente, frescos, restoBloque, siguienteNivel, sinDetallar }
}

function Retomar({ p, ultimaDecision, alDetallar, ocupado }: { p: Proyecto; ultimaDecision: Decision | null; alDetallar: (n: number) => void; ocupado: boolean }) {
  const r = p.roadmap!
  const h = hojaDeRuta(r, p.hechos, p.hechos_en ?? {})
  const empezado = p.hechos.length > 0
  const ir = (id: string) => {
    const el = document.getElementById(`paso-${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('destacado')
    window.setTimeout(() => el.classList.remove('destacado'), 1800)
  }
  const tituloNivel = (n: Nivel) => n.titulo.replace(/^\s*nivel\s*\d+\s*[:·.\-–]\s*/i, '').replace(/^./, (c) => c.toUpperCase())
  return (
    <section className="proyecto-retomar" aria-label={empezado ? 'Por dónde íbamos' : 'Por dónde empezar'}>
      <h2>{empezado ? 'Por dónde íbamos' : 'Por dónde empezar'}</h2>
      {empezado && h.ultimoEn && (
        <p className="retomar-donde">
          Lo dejaste <strong>{haceCuanto(h.ultimoEn)}</strong>
          {h.ultimos[0] ? ` tras «${h.ultimos[0].titulo}»` : ''}
          {h.ultimos.length > 1 ? ` (antes, ${h.ultimos.slice(1).map((x) => `«${x.titulo}»`).join(' y ')})` : ''}.
          {ultimaDecision ? ` Última decisión: ${ultimaDecision.titulo}.` : ''}
        </p>
      )}
      {h.siguiente ? (
        <div className="retomar-ahora">
          <span className="retomar-etq">Ahora toca</span>
          <button type="button" className="retomar-paso" onClick={() => ir(h.siguiente!.paso.id)}>
            <strong>{h.siguiente.paso.titulo}</strong>
            <span className="nota">
              Nivel {h.siguiente.nivel.numero} · {h.siguiente.bloque.titulo} · {horas(h.siguiente.paso.minutos)} →
            </span>
          </button>
          <p className="retomar-antes">{h.siguiente.paso.antes.split(/(?<=[.!?])\s/)[0]}</p>
        </div>
      ) : h.sinDetallar ? (
        <div className="retomar-ahora">
          <span className="retomar-etq">Ahora toca</span>
          <p>
            {h.sinDetallar.detallado
              ? `Lo detallado está hecho. El nivel «${tituloNivel(h.sinDetallar)}» tiene bloques nuevos aún sin pasos.`
              : `Lo detallado está hecho. El siguiente nivel, «${tituloNivel(h.sinDetallar)}», aún está esbozado.`}
          </p>
          <button className="boton boton-principal" disabled={ocupado} onClick={() => alDetallar(h.sinDetallar!.numero)}>
            {h.sinDetallar.detallado ? `Detallar los bloques nuevos del nivel ${h.sinDetallar.numero}` : `Detallar el nivel ${h.sinDetallar.numero}`}
          </button>
        </div>
      ) : (
        <p>Todo hecho. Proyecto terminado.</p>
      )}
      {h.frescos.length > 0 && (
        <div className="retomar-frescos">
          <span className="retomar-etq">Ten fresco</span>
          <dl>
            {h.frescos.map((g) => (
              <div key={g.termino}>
                <dt>{g.termino}</dt>
                <dd>{g.definicion}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {h.siguiente && (
        <p className="retomar-vamos nota">
          <span className="retomar-etq">A dónde vamos</span>{' '}
          {h.restoBloque.length > 0
            ? `Después, ${h.restoBloque.length === 1 ? 'un paso más' : `${h.restoBloque.length} pasos más`} para cerrar «${h.siguiente.bloque.titulo}». `
            : `Con este cierras «${h.siguiente.bloque.titulo}». `}
          Al acabar el nivel {h.siguiente.nivel.numero}: {h.siguiente.nivel.objetivo}
          {h.siguienteNivel && ` Luego, el nivel ${h.siguienteNivel.numero}: «${tituloNivel(h.siguienteNivel)}».`}
        </p>
      )}
    </section>
  )
}

const horas = (min: number) => (min < 60 ? `${min} min` : `${String(Math.round((min / 60) * 10) / 10).replace('.', ',')} h`)

function idDeRuta(): number | null {
  const partes = window.location.hash.replace(/^#\/?/, '').split('/')
  return partes[0] === 'proyectos' && Number(partes[1]) ? Number(partes[1]) : null
}

export default function PanelProyectos() {
  const [abierto, setAbierto] = useState<number | null>(idDeRuta)
  useEffect(() => {
    const al = () => setAbierto(idDeRuta())
    window.addEventListener('hashchange', al)
    return () => window.removeEventListener('hashchange', al)
  }, [])
  const abrir = (id: number | null) => (window.location.hash = id ? `#/proyectos/${id}` : '#/proyectos')
  return abierto ? <VistaProyecto id={abierto} alVolver={() => abrir(null)} /> : <ListaProyectos alAbrir={abrir} />
}

function Barra({ p }: { p: Progreso }) {
  const pct = p.pasos ? Math.round((p.hechos / p.pasos) * 100) : 0
  return (
    <div className="proyecto-barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

function ListaProyectos({ alAbrir }: { alAbrir: (id: number) => void }) {
  const [lista, setLista] = useState<ProyectoResumen[] | null>(null)
  // Con una idea traída del plan, el formulario sale ya abierto.
  const [nuevo, setNuevo] = useState(() => leerIdea() !== '')
  const [fallo, setFallo] = useState<string | null>(null)
  const cargar = useCallback(() => {
    setFallo(null)
    pedir<ProyectoResumen[]>('/api/proyectos')
      .then((l) => {
        setLista(l)
        if (!l.length) setNuevo(true)
      })
      .catch((e) => setFallo(mensajeDe(e)))
  }, [])
  useEffect(cargar, [cargar])
  // Si alguno se está preparando, la lista se pone al día sola (si no, seguiría diciendo «Preparando…» hasta recargar).
  const generando = !!lista?.some((p) => p.estado === 'generando' || p.estado === 'en_cola')
  useEffect(() => {
    if (!generando) return
    const t = window.setInterval(() => {
      pedir<ProyectoResumen[]>('/api/proyectos')
        .then(setLista)
        .catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(t)
  }, [generando])
  return (
    <div className="panel proyectos">
      <h1>Proyectos</h1>
      <p className="nota">
        Cuéntale lo que quieres construir y te saca el camino: niveles que ya funcionan, bloques que se pueden probar y pasos con lo
        mínimo que tienes que saber para cada uno.
      </p>
      {lista == null && <Cargando error={fallo} reintentar={cargar} />}
      {lista && lista.length > 0 && (
        <ul className="proyectos-lista">
          {lista.map((p) => (
            <li key={p.id}>
              <button type="button" className="proyecto-tarjeta" onClick={() => alAbrir(p.id)}>
                <strong>{p.nombre}</strong>
                {(p.estado === 'generando' || p.estado === 'en_cola') && !p.progreso.niveles ? (
                  <span className="nota">{p.estado === 'en_cola' ? 'En cola para preparar el roadmap…' : 'Preparando el roadmap…'}</span>
                ) : p.estado === 'error' ? (
                  <span className="nota">No se pudo preparar: ábrelo para reintentar</span>
                ) : (
                  <>
                    <span className="nota">
                      Nivel {p.progreso.nivel ?? 1} de {p.progreso.niveles} · {p.progreso.hechos}/{p.progreso.pasos} pasos
                      {p.estado === 'en_cola' ? ' · en cola' : p.estado === 'generando' ? ' · trabajando en él' : ''}
                    </span>
                    <Barra p={p.progreso} />
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {nuevo ? (
        <NuevoProyecto alCrear={alAbrir} alCancelar={lista?.length ? () => setNuevo(false) : undefined} />
      ) : (
        <button className="boton boton-principal" onClick={() => setNuevo(true)}>
          Nuevo proyecto
        </button>
      )}
    </div>
  )
}

function NuevoProyecto({ alCrear, alCancelar }: { alCrear: (id: number) => void; alCancelar?: () => void }) {
  // Si vienes de «Llevar a Proyectos» en el plan, la idea ya está escrita; se toma una vez y se olvida.
  const [f, setF] = useState(() => ({ nombre: '', idea: leerIdea(), objetivo: '', sabes: '', ritmo: '', investigar: true }))
  useEffect(() => olvidarIdea(), [])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const listo = f.nombre.trim().length >= 2 && f.idea.trim().length >= 10
  return (
    <form
      className="proyecto-nuevo"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!listo) return
        setEnviando(true)
        setError(null)
        try {
          const p = await pedir<ProyectoResumen>('/api/proyectos', enviarJson(f))
          alCrear(p.id)
        } catch (err) {
          setError(String((err as Error).message))
          setEnviando(false)
        }
      }}
    >
      <h2>Nuevo proyecto</h2>
      <label>
        Nombre
        <input value={f.nombre} onChange={cambiar('nombre')} placeholder="Copiloto cloud agéntico" maxLength={200} autoFocus />
      </label>
      <label>
        ¿Qué quieres construir?
        <textarea value={f.idea} onChange={cambiar('idea')} rows={4} placeholder="Un agente que opera mi cuenta de AWS en lenguaje natural y nunca ejecuta nada sin que yo lo apruebe…" />
      </label>
      <label>
        ¿Para qué lo quieres?
        <input value={f.objetivo} onChange={cambiar('objetivo')} placeholder="Para mi portfolio de AI Engineer y aprender cloud" />
      </label>
      <label>
        ¿Qué sabes ya y qué no?
        <textarea value={f.sabes} onChange={cambiar('sabes')} rows={2} placeholder="Domino agentes y evals; de AWS no sé nada" />
      </label>
      <label>
        Tu ritmo
        <input value={f.ritmo} onChange={cambiar('ritmo')} placeholder="Unas 6 horas a la semana" maxLength={200} />
      </label>
      <label className="proyecto-check">
        <input type="checkbox" checked={f.investigar} onChange={(e) => setF({ ...f, investigar: e.target.checked })} /> Buscar antes en la web
        proyectos y documentación parecidos (unos céntimos)
      </label>
      <BarraCuota accion={{ accion: 'proyecto' }} />
      <div className="botones">
        <button className="boton boton-principal" disabled={!listo || enviando}>
          {enviando ? 'Creando…' : 'Hacer el roadmap'}
        </button>
        {alCancelar && (
          <button type="button" className="boton" onClick={alCancelar}>
            Cancelar
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

function VistaProyecto({ id, alVolver }: { id: number; alVolver: () => void }) {
  const [p, setP] = useState<Proyecto | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Un enlace a un proyecto borrado o que nunca existió: pantalla vacía, sin reintentar.
  const [noExiste, setNoExiste] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  // «Rehacer el roadmap» abierto: antes de gastar cuota, lo que va a pasar con lo hecho.
  const [rehaciendo, setRehaciendo] = useState(false)
  // Mientras se envía «Detallar» o «Rehacer», sus botones no se pueden pulsar otra vez (un doble clic).
  const [enviando, setEnviando] = useState(false)
  // Un fallo suelto mientras se mira cómo va la generación no tapa el proyecto: la siguiente vuelta lo reintenta.
  const cargar = useCallback(
    () =>
      pedir<Proyecto>(`/api/proyectos/${id}`)
        .then((x) => {
          setP(x)
          setError(null)
        })
        .catch((e) => {
          if (e instanceof ErrorApi && e.codigo === 404) setNoExiste(true)
          else setError(mensajeDe(e))
        }),
    [id],
  )
  useEffect(() => {
    void cargar()
  }, [cargar])
  // La última decisión del diario, para «por dónde íbamos».
  const [ultimaDecision, setUltimaDecision] = useState<Decision | null>(null)
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    pedir<Decision[]>(`/api/proyectos/${id}/decisiones`).then((l) => setUltimaDecision(l[0] ?? null)).catch(() => undefined)
  }, [id, vuelta])
  // El asesor ha aplicado (o deshecho) un cambio en este proyecto: se vuelve a leer.
  useEffect(() => {
    const al = (e: Event) => {
      const { proyecto_id, nuevos } = (e as CustomEvent<CambioAplicado>).detail
      if (proyecto_id !== id) return
      setVuelta((v) => v + 1)
      // Ya releído, te lleva a lo nuevo y lo resalta un momento.
      void cargar().then(() =>
        window.setTimeout(() => {
          const pasos = nuevos.map((x) => document.getElementById(`paso-${x}`)).filter((el): el is HTMLElement => !!el)
          pasos[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          pasos.forEach((el) => el.classList.add('destacado'))
          window.setTimeout(() => pasos.forEach((el) => el.classList.remove('destacado')), 2600)
        }, 80),
      )
    }
    window.addEventListener(EVENTO_CAMBIO_APLICADO, al)
    return () => window.removeEventListener(EVENTO_CAMBIO_APLICADO, al)
  }, [id, cargar])
  // Mientras se genera (o espera en la cola), se mira cada pocos segundos en qué va.
  useEffect(() => {
    if (p?.estado !== 'generando' && p?.estado !== 'en_cola') return
    const t = window.setInterval(() => void cargar(), p.estado === 'en_cola' ? 5000 : 3000)
    return () => window.clearInterval(t)
  }, [p?.estado, cargar])

  if (!p && noExiste)
    return (
      <div className="panel">
        <Vacio
          etiqueta="Proyectos"
          titulo="Este proyecto no existe"
          texto="Puede que lo borraras o que el enlace esté mal."
          acciones={[{ texto: 'Ver tus proyectos', principal: true, alPulsar: alVolver }]}
        />
      </div>
    )
  if (!p) return <div className="panel">{error ? <Cargando error={error} reintentar={() => void cargar()} /> : <Pensando />}</div>
  const r = p.roadmap
  const hechos = new Set(p.hechos)
  // Cualquier acción que falle lo dice aquí (antes fallaban en silencio).
  const accion = async (hacer: () => Promise<unknown>, que: string) => {
    setAviso(null)
    try {
      await hacer()
    } catch (e) {
      setAviso(`No he podido ${que}: ${mensajeDe(e)}`)
    }
  }
  const marcar = async (paso: string, hecho: boolean, donde?: Element | null) => {
    const antes = p
    const nuevos = hecho ? [...p.hechos, paso] : p.hechos.filter((x) => x !== paso)
    const fechas = { ...(p.hechos_en ?? {}) }
    if (hecho) fechas[paso] = new Date().toISOString()
    else delete fechas[paso]
    setP({ ...p, hechos: nuevos, hechos_en: fechas })
    if (hecho && r) {
      // Un paso, un estallido pequeño; si cierra su bloque (o su nivel), uno grande.
      const hechosSet = new Set(nuevos)
      const nivel = r.niveles.find((n) => n.bloques.some((b) => b.pasos.some((x) => x.id === paso)))
      const bloque = nivel?.bloques.find((b) => b.pasos.some((x) => x.id === paso))
      const cierra = !!bloque && bloque.pasos.every((x) => hechosSet.has(x.id))
      celebrar(donde ?? null, cierra)
    }
    try {
      const s = await pedir<ProyectoResumen>(`/api/proyectos/${id}/pasos/${paso}`, enviarJson({ hecho }, 'PUT'))
      setP((x) => (x ? { ...x, progreso: s.progreso } : x))
    } catch (e) {
      // No se guardó: la casilla vuelve a como estaba, para que lo que ves sea lo que hay.
      setP((x) => (x ? { ...x, hechos: antes.hechos, hechos_en: antes.hechos_en } : x))
      setAviso(`No he podido guardar el paso: ${mensajeDe(e)}`)
    }
  }
  // Detallar y rehacer: un envío cada vez (el servidor tampoco encola dos, pero así ni lo intenta).
  const enviar = async (hacer: () => Promise<unknown>, que: string) => {
    if (enviando) return
    setEnviando(true)
    try {
      await accion(hacer, que)
    } finally {
      setEnviando(false)
    }
  }
  const detallar = (numero: number) =>
    enviar(async () => {
      await pedir(`/api/proyectos/${id}/niveles/${numero}/detallar`, { method: 'POST' })
      await cargar()
    }, 'detallar el nivel')
  const rehacer = () =>
    enviar(async () => {
      await pedir(`/api/proyectos/${id}/rehacer`, enviarJson({ confirmado: true }))
      setRehaciendo(false)
      await cargar()
    }, 'rehacer el roadmap')
  // Con un trabajo en la cola o en marcha no se pide otro (el servidor diría 409): se cancela antes.
  const ocupado = enviando || p.estado === 'generando' || p.estado === 'en_cola'
  const cancelarTrabajo = () =>
    accion(async () => {
      await pedir(`/api/trabajos/${p.trabajo!.id}/cancelar`, { method: 'POST' })
      await cargar()
    }, 'cancelar')
  const volverAnterior = async () => {
    if (!window.confirm('¿Volver al roadmap anterior? El de ahora se guarda por si quieres regresar a él.')) return
    await accion(async () => {
      await pedir(`/api/proyectos/${id}/volver`, { method: 'POST' })
      await cargar()
    }, 'volver al roadmap anterior')
  }
  const rehecho = r ? resumenRehecho(r.conservados, r.ya_no_estan ?? [], r.no_conservados) : null
  const perdidos = r ? perdidosAlRehacer(r.no_conservados, r.ya_no_estan ?? []) : []
  const software = r?.software !== false

  return (
    <div className="panel proyecto">
      <button type="button" className="boton-mini" onClick={alVolver}>
        ← Proyectos
      </button>
      <header className="proyecto-cabeza">
        <h1>{p.nombre}</h1>
        {r && (
          <div className="proyecto-cifras">
            <span>
              Nivel {p.progreso.nivel ?? 1} de {p.progreso.niveles} · {p.progreso.hechos}/{p.progreso.pasos} pasos
            </span>
            <Barra p={p.progreso} />
          </div>
        )}
      </header>

      {aviso && (
        <p className="nota" role="alert">
          {aviso}
        </p>
      )}
      {p.estado === 'generando' && (
        <div className="proyecto-generando">
          <Pensando texto={queHace(p.trabajo, !!r)} />
          {p.trabajo?.trabajador_vivo === false ? (
            <p className="nota" role="alert">
              No hay ningún trabajador en marcha, así que esto no avanzará. Arranca Magister con los trabajos activados (o lanza
              «uv run magister-trabajador») y seguirá solo.
            </p>
          ) : (
            <p className="nota">
              {p.trabajo?.tipo === 'proyecto_nivel' ? 'Suele tardar menos de un minuto.' : 'Tarda unos minutos.'} Puedes irte: sigue en segundo plano.
              {r ? ' Mientras, puedes marcar pasos y apuntar decisiones.' : ''}
            </p>
          )}
          {error && <p className="nota">Sin conexión con el servidor; sigo intentándolo.</p>}
          {p.trabajo?.id != null && (
            <button type="button" className="boton-mini" onClick={() => void cancelarTrabajo()}>
              Cancelar
            </button>
          )}
        </div>
      )}
      {/* En cola: aún no ha empezado. El proyecto se usa igual; solo se espera para lo que choca con el trabajo. */}
      {p.estado === 'en_cola' && (
        <div className="proyecto-generando proyecto-en-cola" role="status">
          <p>{textoEnCola(p.trabajo, !!r)}</p>
          {p.trabajo?.trabajador_vivo === false && (
            <p className="nota" role="alert">
              No hay ningún trabajador en marcha, así que no empezará. Arranca Magister con los trabajos activados (o lanza
              «uv run magister-trabajador»).
            </p>
          )}
          {error && <p className="nota">Sin conexión con el servidor; sigo intentándolo.</p>}
          {p.trabajo?.id != null && (
            <button type="button" className="boton-mini" onClick={() => void cancelarTrabajo()}>
              Cancelar {p.trabajo.tipo === 'proyecto_nivel' ? 'el detalle' : r ? 'el rehacer' : ''}
            </button>
          )}
        </div>
      )}
      {p.estado === 'error' && (
        <div className="proyecto-error">
          <p role="alert">No se pudo preparar: {p.error}</p>
          <button
            className="boton"
            disabled={enviando}
            onClick={() =>
              void enviar(async () => {
                await pedir(`/api/proyectos/${id}/rehacer`, { method: 'POST' })
                await cargar()
              }, 'volver a intentarlo')
            }
          >
            Volver a intentarlo
          </button>
        </div>
      )}

      {r && (
        <>
          <Retomar p={p} ultimaDecision={ultimaDecision} alDetallar={(n) => void detallar(n)} ocupado={ocupado} />
          <section className="proyecto-priming">
            <h2>Antes de empezar</h2>
            <p>{r.resumen}</p>
          </section>

          <div className="proyecto-explicacion">
            <details>
              <summary>Qué es y por qué merece la pena</summary>
              <p>{r.que_es}</p>
              <p>{r.por_que}</p>
            </details>
            <details>
              <summary>{software ? 'Arquitectura' : 'Cómo se organiza'}</summary>
              {p.arquitectura_svg && <Diagrama svg={p.arquitectura_svg} completo />}
              <p>{r.arquitectura}</p>
            </details>
            <details>
              <summary>Glosario · {r.glosario.length}</summary>
              <dl className="proyecto-glosario">
                {r.glosario.map((g) => (
                  <div key={g.termino}>
                    <dt>{g.termino}</dt>
                    <dd>{g.definicion}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <details>
              <summary>
                {software ? 'Riesgos y seguridad' : 'Riesgos'} · {r.riesgos.length}
              </summary>
              <ul>
                {r.riesgos.map((x) => (
                  <li key={x.riesgo}>
                    <strong>{x.riesgo}.</strong> {x.mitigacion}
                  </li>
                ))}
              </ul>
            </details>
            {r.fuera_de_alcance.length > 0 && (
              <details>
                <summary>Fuera de alcance</summary>
                <ul>
                  {r.fuera_de_alcance.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </details>
            )}
            {p.referencias.length > 0 && (
              <details>
                <summary>Referencias · {p.referencias.length}</summary>
                {agruparReferencias(p.referencias, r.niveles[0]?.bloques ?? []).map((g, i) => (
                  <div key={i}>
                    {g.titulo && <h4>{g.titulo}</h4>}
                    <ul>
                      {g.referencias.map((x) => (
                        <li key={x.url}>
                          <a href={x.url} target="_blank" rel="noopener noreferrer">
                            {x.titulo}
                          </a>
                          {x.motivo && <span className="nota"> · {x.motivo}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </details>
            )}
          </div>

          {/* Un detallado que falla devuelve el proyecto a «listo» con el motivo: sin esto, el botón reaparece sin explicación. */}
          {p.estado === 'listo' && p.error && p.error !== 'cancelado' && (
            <p className="nota" role="alert">
              Lo último que pediste no salió: {p.error}
            </p>
          )}
          {rehecho && (
            <div className="proyecto-rehecho" role="status">
              <p className="nota">{rehecho}</p>
              {/* Lo que este rehacer no conservó, a la vista; y volver al de antes, sin bajar al pie. */}
              {perdidos.length > 0 && p.anterior && (
                <p className="nota">
                  Si lo prefieres como estaba, puedes{' '}
                  <button type="button" className="boton-mini" disabled={ocupado} onClick={() => void volverAnterior()}>
                    Volver al roadmap anterior
                  </button>
                </p>
              )}
              {(r.ya_no_estan ?? []).length > 0 && (
                <details>
                  <summary>Hechos que ya no están · {r.ya_no_estan!.length}</summary>
                  <ul>
                    {r.ya_no_estan!.map((x) => (
                      <li key={x.id}>
                        {x.titulo}
                        {x.hecho_en && <span className="nota"> · hecho el {new Date(x.hecho_en).toLocaleDateString('es-ES')}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {r.niveles.map((n) => (
            <NivelVista key={n.id} n={n} hechos={hechos} proyecto={p} alMarcar={marcar} alDetallar={() => void detallar(n.numero)} ocupado={ocupado} />
          ))}

          <Diario id={id} pasos={r.niveles.flatMap((n) => n.bloques.flatMap((b) => b.pasos))} yaNoEstan={r.ya_no_estan ?? []} alCambiar={setUltimaDecision} />
        </>
      )}

      {rehaciendo && r && p.estado === 'listo' && (
        <div className="proyecto-rehacer" role="group" aria-label="Rehacer el roadmap">
          <p>{avisoRehacer(p.progreso.hechos)}</p>
          <p className="nota">Gasta cuota, como hacerlo la primera vez:</p>
          <BarraCuota accion={{ accion: 'proyecto' }} />
          <div className="botones">
            <button className="boton boton-principal" disabled={enviando} onClick={() => void rehacer()}>
              {enviando ? 'Encolando…' : 'Rehacer el roadmap'}
            </button>
            <button type="button" className="boton" onClick={() => setRehaciendo(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      <p className="proyecto-pie">
        {r && p.estado === 'listo' && !rehaciendo && (
          <button type="button" className="boton-mini" onClick={() => setRehaciendo(true)}>
            Rehacer el roadmap
          </button>
        )}
        {p.anterior && p.estado === 'listo' && (
          <button type="button" className="boton-mini" onClick={() => void volverAnterior()}>
            Volver al roadmap anterior
          </button>
        )}
        <button
          className="boton-mini peligro"
          onClick={async () => {
            if (!window.confirm(`¿Borrar «${p.nombre}» con su roadmap y su diario?`)) return
            await accion(async () => {
              await pedir(`/api/proyectos/${id}`, { method: 'DELETE' })
              alVolver()
            }, 'borrar el proyecto')
          }}
        >
          Borrar el proyecto
        </button>
      </p>
    </div>
  )
}

function NivelVista({ n, hechos, proyecto, alMarcar, alDetallar, ocupado }: {
  n: Nivel
  hechos: Set<string>
  proyecto: Proyecto
  alMarcar: (paso: string, hecho: boolean, donde?: Element | null) => void
  alDetallar: () => void
  ocupado: boolean
}) {
  const pasos = n.bloques.flatMap((b) => b.pasos)
  const hechosAqui = pasos.filter((x) => hechos.has(x.id)).length
  return (
    // data-id y data-titulo: el asesor los lee para ver el roadmap entero y para cambiar ids por títulos en su texto.
    <section className={`proyecto-nivel ${n.detallado ? '' : 'esbozado'}`} data-id={n.id} data-titulo={`el nivel ${n.numero} «${n.titulo}»`}>
      <header>
        <span className="proyecto-nivel-num">Nivel {n.numero}</span>
        <h2>
          {n.titulo.replace(/^\s*nivel\s*\d+\s*[:·.\-–]\s*/i, '').replace(/^./, (c) => c.toUpperCase())} {n.mvp && <span className="proyecto-mvp">MVP</span>}
        </h2>
        {n.detallado && pasos.length > 0 && (
          <span className="nota">
            {hechosAqui}/{pasos.length} pasos · {horas(pasos.reduce((a, x) => a + x.minutos, 0))}
          </span>
        )}
      </header>
      <p className="proyecto-objetivo">{n.objetivo}</p>
      <p className="proyecto-priming-nivel">{n.priming}</p>
      {n.bloques.map((b) => (
        <div key={b.id} className="proyecto-bloque" data-id={b.id} data-titulo={`«${b.titulo}»`}>
          <h3>{b.titulo}</h3>
          <p className="proyecto-priming-bloque">{b.priming}</p>
          {b.pasos.length > 0 && (
            <ol className="proyecto-pasos">
              {b.pasos.map((x) => (
                <PasoVista key={x.id} x={x} hecho={hechos.has(x.id)} proyecto={proyecto} nivel={n} bloque={b} alMarcar={alMarcar} />
              ))}
            </ol>
          )}
        </div>
      ))}
      {porDetallar(n) && (
        <div className="proyecto-detallar">
          <p className="nota">
            {n.detallado
              ? 'Hay bloques nuevos sin pasos. Detallarlos prepara solo esos; los pasos que ya tienes, y lo hecho en ellos, no se tocan.'
              : 'Este nivel está esbozado. Sus pasos se preparan cuando llegues, con lo que hayas hecho y decidido hasta entonces.'}
          </p>
          <BarraCuota accion={{ accion: 'nivel' }} />
          <button className="boton" onClick={alDetallar} disabled={ocupado}>
            {n.detallado ? 'Detallar los bloques nuevos' : 'Detallar este nivel'}
          </button>
        </div>
      )}
    </section>
  )
}

function PasoVista({ x, hecho, proyecto, nivel, bloque, alMarcar }: {
  x: Paso
  hecho: boolean
  proyecto: Proyecto
  nivel: Nivel
  bloque: Bloque
  alMarcar: (paso: string, hecho: boolean, donde?: Element | null) => void
}) {
  const [atasco, setAtasco] = useState<string | null>(null)
  // Recién marcado: la fila da un pequeño salto (animo.css).
  const [recien, setRecien] = useState(false)
  const [abriendo, setAbriendo] = useState(false)
  const [falloAyuda, setFalloAyuda] = useState<string | null>(null)
  // «Me he atascado»: abre una conversación con el tutor que ya sabe en qué proyecto y en qué paso estás.
  const pedirAyuda = async () => {
    if (!atasco?.trim()) return
    setAbriendo(true)
    const texto =
      `Estoy construyendo «${proyecto.nombre}» (${proyecto.idea.slice(0, 300)}). Voy por el nivel ${nivel.numero} «${nivel.titulo}», ` +
      `bloque «${bloque.titulo}», paso «${x.titulo}».\n\nLo que dice el paso: ${x.que_haces}\nCómo sé que está hecho: ${x.hecho_si}\n\n` +
      `Me he atascado: ${atasco.trim()}`
    let c: { id: number }
    try {
      c = await crearConversacion(`${proyecto.nombre} · ${x.titulo}`.slice(0, 120))
    } catch (e) {
      // Sin esto el botón se quedaba en «Abriendo…» para siempre.
      setAbriendo(false)
      setFalloAyuda(mensajeDe(e))
      return
    }
    try {
      sessionStorage.setItem('magister-enviar-al-abrir', JSON.stringify({ cid: c.id, texto }))
    } catch {
      /* sin almacenamiento: se abre la conversación vacía */
    }
    window.location.hash = `#/conversacion/${c.id}`
  }
  return (
    <li id={`paso-${x.id}`} className={`proyecto-paso ${hecho ? 'hecho' : ''} ${recien ? 'recien' : ''}`}>
      <label className="proyecto-paso-titulo">
        <input
          type="checkbox"
          checked={hecho}
          onChange={(e) => {
            alMarcar(x.id, e.target.checked, e.target)
            if (e.target.checked) {
              setRecien(true)
              window.setTimeout(() => setRecien(false), 600)
            }
          }}
        />
        <strong>{x.titulo}</strong>
        <span className="nota">{horas(x.minutos)}</span>
      </label>
      <div className="proyecto-paso-cuerpo">
        <p>{x.que_haces}</p>
        <p>
          <span className="proyecto-etiqueta">Antes</span> {x.antes}
        </p>
        <p>
          <span className="proyecto-etiqueta">Hecho si</span> {x.hecho_si}
        </p>
        {x.aviso && (
          <p className="nota" role="note">
            {x.aviso}
          </p>
        )}
        {atasco === null ? (
          <button type="button" className="boton-mini" onClick={() => setAtasco('')}>
            Me he atascado
          </button>
        ) : (
          <div className="proyecto-atasco">
            <textarea value={atasco} onChange={(e) => setAtasco(e.target.value)} rows={2} placeholder="¿Qué te pasa? Pega el error si lo hay" autoFocus />
            <button type="button" className="boton-mini" disabled={!atasco.trim() || abriendo} onClick={pedirAyuda}>
              {abriendo ? 'Abriendo…' : 'Preguntar al tutor'}
            </button>
            <button type="button" className="boton-mini" onClick={() => setAtasco(null)}>
              Cancelar
            </button>
            {falloAyuda && (
              <p className="nota" role="alert">
                No he podido abrir la conversación: {falloAyuda}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function Diario({ id, pasos, yaNoEstan = [], alCambiar }: {
  id: number
  pasos: Paso[]
  // Los pasos hechos que ya no están tras rehacer el roadmap: una decisión puede seguir apuntando a uno de ellos.
  yaNoEstan?: HechoQueYaNoEsta[]
  alCambiar?: (ultima: Decision | null) => void
}) {
  const [lista, setLista] = useState<Decision[]>([])
  const [f, setF] = useState({ titulo: '', contexto: '', decision: '', consecuencias: '', paso_id: '' })
  const [abierto, setAbierto] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const cargar = useCallback(() => {
    setAviso(null)
    pedir<Decision[]>(`/api/proyectos/${id}/decisiones`)
      .then(setLista)
      .catch((e) => setAviso(`No he podido cargar el diario: ${mensajeDe(e)}`))
  }, [id])
  useEffect(cargar, [cargar])
  useEffect(() => {
    const al = (e: Event) => (e as CustomEvent<CambioAplicado>).detail.proyecto_id === id && cargar()
    window.addEventListener(EVENTO_CAMBIO_APLICADO, al)
    return () => window.removeEventListener(EVENTO_CAMBIO_APLICADO, al)
  }, [id, cargar])
  const enPaso = (pid: string | null) => {
    const t = tituloDePaso(pid, pasos, yaNoEstan)
    return t ? ` · en «${t.titulo}»${t.yaNoEsta ? ' (ya no está en el roadmap)' : ''}` : ''
  }
  return (
    <section className="proyecto-diario">
      <header>
        <h2>Diario de decisiones</h2>
        {!abierto && (
          <button className="boton-mini" onClick={() => setAbierto(true)}>
            Apuntar una decisión
          </button>
        )}
      </header>
      <p className="nota">Qué decidiste, por qué y qué implica. Al detallar los siguientes niveles, el roadmap lo tiene en cuenta.</p>
      {aviso && (
        <p className="nota" role="alert">
          {aviso}{' '}
          <button type="button" className="boton-mini" onClick={cargar}>
            Reintentar
          </button>
        </p>
      )}
      {abierto && (
        <form
          className="proyecto-decision-nueva"
          onSubmit={async (e) => {
            e.preventDefault()
            setAviso(null)
            let d: Decision
            try {
              d = await pedir<Decision>(`/api/proyectos/${id}/decisiones`, enviarJson({ ...f, paso_id: f.paso_id || null }))
            } catch (err) {
              // Lo escrito se queda en el formulario para volver a guardarlo.
              setAviso(`No he podido guardar la decisión: ${mensajeDe(err)}`)
              return
            }
            setLista([d, ...lista])
            alCambiar?.(d)
            setF({ titulo: '', contexto: '', decision: '', consecuencias: '', paso_id: '' })
            setAbierto(false)
          }}
        >
          <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Título (Usar boto3 y no la CLI)" />
          <textarea value={f.contexto} onChange={(e) => setF({ ...f, contexto: e.target.value })} rows={2} placeholder="Contexto: qué pasaba, qué opciones había" />
          <textarea value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })} rows={2} placeholder="Lo que decides y por qué" />
          <textarea value={f.consecuencias} onChange={(e) => setF({ ...f, consecuencias: e.target.value })} rows={2} placeholder="Qué implica (opcional)" />
          <select value={f.paso_id} onChange={(e) => setF({ ...f, paso_id: e.target.value })}>
            <option value="">Sin paso concreto</option>
            {pasos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.titulo}
              </option>
            ))}
          </select>
          <div className="botones">
            <button className="boton boton-principal" disabled={f.titulo.trim().length < 3 || f.decision.trim().length < 3}>
              Guardar
            </button>
            <button type="button" className="boton" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {lista.length > 0 && (
        <ol className="proyecto-decisiones">
          {lista.map((d) => (
            <li key={d.id}>
              <strong>{d.titulo}</strong>
              <span className="nota">
                {' '}
                · {new Date(d.creada_en).toLocaleDateString('es-ES')}
                {enPaso(d.paso_id)}
              </span>
              {d.contexto && <p className="nota">{d.contexto}</p>}
              <p>{d.decision}</p>
              {d.consecuencias && <p className="nota">Implica: {d.consecuencias}</p>}
              <button
                className="boton-mini"
                onClick={async () => {
                  try {
                    await pedir(`/api/proyectos/${id}/decisiones/${d.id}`, { method: 'DELETE' })
                  } catch (err) {
                    setAviso(`No he podido quitarla: ${mensajeDe(err)}`)
                    return
                  }
                  const resto = lista.filter((x) => x.id !== d.id)
                  setLista(resto)
                  alCambiar?.(resto[0] ?? null)
                }}
              >
                Quitar
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
