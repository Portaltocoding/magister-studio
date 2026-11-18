import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { enviarJson, listarPlanes, pedir, verPlan, type ResumenPlan, type VistaPlan } from '../api.ts'
import Pensando from '../componentes/Pensando.tsx'
import Cargando, { mensajeDe } from '../componentes/Cargando.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import ControlVoz, { usarAjustesVoz } from '../componentes/ControlVoz.tsx'
import { pronunciar, vocesMagister, vocesMagisterListas, vozElegida, vozMagister } from '../componentes/voz.ts'
import BarraCuota from '../componentes/BarraCuota.tsx'
import { DEMO_IDEMPOTENCIA } from '../escena/demo.ts'
import { DEMO_INDICES } from '../escena/indices.ts'
import { DEMO_TOPOGRAFIA } from '../escena/topografia.ts'
import type { GuionGrafico } from '../escena/tipos.ts'

const DEMOS: Record<string, GuionGrafico> = { indices: DEMO_INDICES, topografia: DEMO_TOPOGRAFIA, idempotencia: DEMO_IDEMPOTENCIA }

// El vídeo animado (Remotion) se carga solo cuando se abre: no pesa en el resto de la app. Se crea de nuevo en cada
// reintento: un `lazy` que falló al cargar se queda fallado para siempre.
const cargarEscena = () => lazy(() => import('../escena/ReproductorEscena.tsx'))

// Si el reproductor falla (no carga su código o se rompe al pintar), cae solo él, con «Reintentar».
class FalloReproductor extends Component<{ children: ReactNode; alReintentar: () => void }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <Cargando
        error={`No he podido cargar el vídeo: ${this.state.error.message}`}
        reintentar={() => {
          this.setState({ error: null })
          this.props.alReintentar()
        }}
      />
    )
  }
}

// #/video/demo/indices abre ese vídeo animado; ?t=40 empieza en el segundo 40.
function rutaDemo(): { abierta: boolean; nombre: string; segundo: number } {
  const [ruta, consulta] = window.location.hash.split('?')
  const nombre = ruta.replace(/^#\/video\/demo\/?/, '')
  return {
    abierta: ruta.startsWith('#/video/demo'),
    nombre: nombre in DEMOS ? nombre : 'indices',
    segundo: Number(new URLSearchParams(consulta ?? '').get('t')) || 0,
  }
}

// Vídeo: entender una lección (o un concepto) antes de estudiarla. El guion se narra por escenas con la voz
// del equipo, con subtítulos y las diapositivas a la par. Cada vídeo lo pides tú: qué, con qué estilo y cuánto dura.

interface Estados {
  [clave: string]: { tipos: Record<string, string>; ids?: Record<string, number>; en_marcha?: boolean }
}

interface VideoInfo {
  material_id: number
  clave: string
  titulo: string
  estilo: string
  concepto: string | null
  minutos: number | null
  // Con guion gráfico: se ve como vídeo animado (motor de escena); si no, narrado con sus diapositivas.
  animado?: boolean
}

interface Escena {
  marca: string
  frases: string[]
}

const ESTILOS: { id: string; nombre: string; desc: string }[] = [
  { id: 'clase', nombre: 'Clase', desc: 'Razonado, con un ejemplo por idea' },
  { id: 'resumen', nombre: 'Resumen rápido', desc: 'Lo esencial, para repasar' },
  { id: 'analogias', nombre: 'Con analogías', desc: 'Comparaciones de la vida diaria' },
  { id: 'examen', nombre: 'Para el examen', desc: 'Lo que suele caer y el error típico' },
]
const NOMBRE_ESTILO = Object.fromEntries(ESTILOS.map((e) => [e.id, e.nombre]))

const MARCAS: Record<string, string> = { intuicion: 'Intuición', choque: 'Choque', nombre: 'Nombre', teoria: 'Teoría' }
const nombreMarca = (m: string) => MARCAS[m] ?? m.charAt(0).toUpperCase() + m.slice(1)

export function escenas(guion: string): Escena[] {
  const salida: Escena[] = []
  for (const trozo of guion.replace(/^---\n[\s\S]*?\n---\n/, '').split(/(?=\[\[[a-z_]+\]\])/)) {
    const m = trozo.match(/^\[\[([a-z_]+)\]\]\s*([\s\S]*)$/)
    const texto = (m ? m[2] : trozo).replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim()
    if (!texto) continue
    const frases = texto.split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9])/).filter(Boolean)
    salida.push({ marca: m ? m[1] : 'intro', frases })
  }
  return salida
}

// Una voz en español instalada en el equipo (no de un servicio en la red).
function vozLocal(): SpeechSynthesisVoice | null {
  const es = (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith('es'))
  return es.find((v) => v.localService && v.lang === 'es-ES') ?? es.find((v) => v.localService) ?? null
}

type EstadoVoz = 'parado' | 'sonando' | 'pausado'

function Reproductor({ video, diaposId }: { video: VideoInfo; diaposId?: number }) {
  const [lista, setLista] = useState<Escena[] | null>(null)
  const [falloLista, setFalloLista] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const [paginas, setPaginas] = useState(0)
  const [e, setE] = useState(0)
  const [f, setF] = useState(0)
  const [voz, setVoz] = useState<EstadoVoz>('parado')
  const [{ velocidad, voz: nombreVoz }] = usarAjustesVoz()
  const [laVoz, setLaVoz] = useState<SpeechSynthesisVoice | null>(null)
  const marco = useRef<HTMLIFrameElement | null>(null)
  const turno = useRef(0)
  // Un vídeo de un solo concepto no casa con las diapositivas de toda la lección: va con tarjetas de escena.
  const conDiapos = !!diaposId && !video.concepto

  useEffect(() => {
    setFalloLista(null)
    pedir<{ texto: string }>(`/api/materiales/${video.material_id}`)
      .then((m) => setLista(escenas(m.texto)))
      .catch((e) => setFalloLista(mensajeDe(e)))
    // Si no se pueden contar las diapositivas, se queda en la primera (el vídeo se ve igual, con la voz y los subtítulos).
    if (conDiapos)
      fetch(`/api/materiales/${diaposId}/fichero/html`)
        .then((r) => (r.ok ? r.text() : ''))
        .then((h) => setPaginas((h.match(/<section[\s>]/g) ?? []).length))
        .catch(() => undefined)
    const cargarVoz = () => setLaVoz(vozLocal())
    cargarVoz()
    window.speechSynthesis?.addEventListener('voiceschanged', cargarVoz)
    // Al cambiar de pestaña o de pantalla, se para.
    const oculto = () => {
      if (document.visibilityState === 'hidden') {
        turno.current++
        window.speechSynthesis?.cancel()
        setVoz((v) => (v === 'sonando' ? 'pausado' : v))
      }
    }
    document.addEventListener('visibilitychange', oculto)
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', cargarVoz)
      document.removeEventListener('visibilitychange', oculto)
      turno.current++
      window.speechSynthesis?.cancel()
    }
  }, [video.material_id, diaposId, conDiapos, intento])

  const pagina = lista && paginas ? 1 + Math.round((e * (paginas - 1)) / Math.max(1, lista.length - 1)) : 1
  useEffect(() => {
    if (marco.current && conDiapos) marco.current.src = `/api/materiales/${diaposId}/fichero/html#${pagina}`
  }, [pagina, diaposId, conDiapos])

  const total = useMemo(() => lista?.reduce((a, x) => a + x.frases.length, 0) ?? 0, [lista])
  const hechas = useMemo(() => (lista ? lista.slice(0, e).reduce((a, x) => a + x.frases.length, 0) + f : 0), [lista, e, f])

  const decir = useCallback(
    (ie: number, jf: number) => {
      if (!lista) return
      const sintesis = window.speechSynthesis
      sintesis.cancel()
      const mio = ++turno.current
      const frase = lista[ie]?.frases[jf]
      if (!frase) {
        setVoz('parado')
        return
      }
      const u = new SpeechSynthesisUtterance(frase)
      u.lang = 'es-ES'
      const elegida = vozElegida() ?? laVoz
      if (elegida) u.voice = elegida
      u.rate = velocidad
      u.onend = () => {
        if (mio !== turno.current) return
        const sigF = jf + 1 < lista[ie].frases.length ? jf + 1 : 0
        const sigE = sigF === 0 ? ie + 1 : ie
        if (sigE >= lista.length) {
          setVoz('parado')
          setE(0)
          setF(0)
          return
        }
        setE(sigE)
        setF(sigF)
        decir(sigE, sigF)
      }
      sintesis.speak(u)
    },
    [lista, laVoz, velocidad, nombreVoz],
  )

  // Si cambias la velocidad o la voz mientras suena, la frase de ahora se repite ya con lo nuevo.
  const sonando = useRef(false)
  sonando.current = voz === 'sonando'
  useEffect(() => {
    if (sonando.current) decir(e, f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [velocidad, nombreVoz])

  // Pausa de verdad: se detiene a mitad de frase y sigue desde ahí.
  const tocar = () => {
    const s = window.speechSynthesis
    if (voz === 'sonando') {
      s.pause()
      setVoz('pausado')
    } else if (voz === 'pausado' && s.paused) {
      s.resume()
      setVoz('sonando')
    } else {
      setVoz('sonando')
      decir(e, f)
    }
  }
  const parar = () => {
    turno.current++
    window.speechSynthesis.cancel()
    setVoz('parado')
    setE(0)
    setF(0)
  }
  const irEscena = (k: number) => {
    if (!lista) return
    const n = Math.max(0, Math.min(lista.length - 1, k))
    setE(n)
    setF(0)
    if (voz !== 'parado') {
      setVoz('sonando')
      decir(n, 0)
    }
  }

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement).closest('input, select, textarea, button')) return
      if (ev.key === ' ') {
        ev.preventDefault()
        tocar()
      } else if (ev.key === 'ArrowRight') irEscena(e + 1)
      else if (ev.key === 'ArrowLeft') irEscena(e - 1)
      else if (ev.key.toLowerCase() === 's') parar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  if (!lista) return falloLista ? <Cargando error={falloLista} reintentar={() => setIntento((x) => x + 1)} /> : <Pensando texto="Cargando el vídeo…" />
  const escena = lista[e]

  return (
    <div className="video">
      <div className={`video-pantalla ${voz}`} onClick={tocar} role="button" aria-label={voz === 'sonando' ? 'Pausar' : 'Reproducir'}>
        {conDiapos ? (
          <iframe
            ref={marco}
            title={`Diapositivas de ${video.clave}`}
            tabIndex={-1}
            onLoad={(ev) => {
              // Mismo origen: se esconde el panel de navegación de Marp, que aquí manda el reproductor.
              const doc = (ev.target as HTMLIFrameElement).contentDocument
              if (doc && !doc.getElementById('sin-osc')) {
                const st = doc.createElement('style')
                st.id = 'sin-osc'
                st.textContent = '.bespoke-marp-osc { display: none !important; }'
                doc.head.appendChild(st)
              }
            }}
          />
        ) : (
          <div className="video-escena">
            <span className="foco-etq">{nombreMarca(escena.marca)}</span>
            <p>{escena.frases[0]}</p>
          </div>
        )}
        {voz !== 'sonando' && <span className="video-play" aria-hidden>{voz === 'pausado' ? '❚❚' : '▶'}</span>}
        <div className="video-subtitulo" aria-live="polite">
          {voz !== 'parado' || hechas > 0 ? escena.frases[f] : ''}
        </div>
      </div>
      <div className="video-controles">
        <button className="boton" onClick={() => irEscena(e - 1)} aria-label="Escena anterior">
          ⏮
        </button>
        <button className="boton boton-principal video-tocar" onClick={tocar}>
          {voz === 'sonando' ? '❚❚ Pausa' : voz === 'pausado' ? '▶ Seguir' : '▶ Ver'}
        </button>
        <button className="boton" onClick={parar} disabled={voz === 'parado' && hechas === 0} aria-label="Parar" title="Parar y volver al principio (S)">
          ■
        </button>
        <button className="boton" onClick={() => irEscena(e + 1)} aria-label="Escena siguiente">
          ⏭
        </button>
        <span className="barra video-barra">
          <span style={{ width: `${total ? (hechas / total) * 100 : 0}%` }} />
        </span>
        <ControlVoz compacto />
      </div>
      <DescargarVideo video={video} lista={lista} paginas={conDiapos ? paginas : 0} />
      {!laVoz && <p className="nota">No encuentro una voz en español instalada en tu equipo: se usará la que tenga el navegador.</p>}
      <div className="video-info">
        <h2>
          <span className="bloques-clave">{video.clave}</span> {video.concepto ?? video.titulo}
        </h2>
        <p className="nota">
          {NOMBRE_ESTILO[video.estilo] ?? 'Clase'} · {lista.length} escenas · espacio pausa, S para, ← → escenas
        </p>
        <ol className="video-capitulos">
          {lista.map((x, k) => (
            <li key={k}>
              <button className={k === e ? 'actual' : ''} onClick={() => irEscena(k)}>
                <span>{nombreMarca(x.marca)}</span>
                <small>{x.frases[0]}</small>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// «Descargar vídeo»: el mismo vídeo en MP4 (diapositivas o tarjetas, la voz de Magister y subtítulos), montado en el
// servidor. Se pide una vez; mientras se hace se ve por qué escena va, y al acabar se baja solo.
interface EstadoMp4 {
  listo: boolean
  voz: string | null
  segundos: number | null
  trabajador: boolean
  trabajo: { id: number; estado: string; paso: number | null; total: number | null; error: string | null } | null
}

function bajar(mid: number) {
  const a = document.createElement('a')
  a.href = `/api/materiales/${mid}/mp4/fichero`
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function DescargarVideo({ video, lista, paginas }: { video: VideoInfo; lista: Escena[]; paginas: number }) {
  const [estado, setEstado] = useState<EstadoMp4 | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [voces, setVoces] = useState(vocesMagister)
  const esperando = useRef(false)
  const mid = video.material_id

  const mirar = useCallback(async () => {
    try {
      const e = await pedir<EstadoMp4>(`/api/materiales/${mid}/mp4`)
      setEstado(e)
      setFallo(null)
      if (esperando.current && e.listo && e.trabajo?.estado === 'hecho') {
        esperando.current = false
        bajar(mid)
      }
    } catch (e) {
      setFallo(mensajeDe(e))
    }
  }, [mid])

  useEffect(() => {
    void mirar()
    vocesMagisterListas.then(setVoces).catch(() => undefined)
  }, [mirar])

  const enMarcha = estado?.trabajo && ['pendiente', 'en_curso'].includes(estado.trabajo.estado)
  // Mientras se hace, se mira cada 2 s cómo va (un fallo suelto no corta la espera: se vuelve a mirar).
  useEffect(() => {
    if (!enMarcha) return
    const t = setInterval(() => void mirar(), 2000)
    return () => clearInterval(t)
  }, [enMarcha, mirar])

  const voz = vozMagister() ?? voces[0]?.id ?? null
  const pedirMp4 = async () => {
    if (!voz) return
    setFallo(null)
    const n = lista.length
    try {
      const r = await pedir<{ trabajo_id: number | null; listo: boolean }>(
        `/api/materiales/${mid}/mp4`,
        enviarJson({
          voz,
          titulo: `${video.clave} · ${video.concepto ?? video.titulo}`,
          escenas: lista.map((x, k) => ({
            marca: nombreMarca(x.marca),
            frases: x.frases.map((t) => ({ texto: t.slice(0, 600), dicho: pronunciar(t).slice(0, 600) || t.slice(0, 600) })),
            pagina: paginas ? 1 + Math.round((k * (paginas - 1)) / Math.max(1, n - 1)) : null,
          })),
        }),
      )
      if (r.listo) return bajar(mid)
      esperando.current = true
      await mirar()
    } catch (e) {
      setFallo(mensajeDe(e))
    }
  }
  const cancelar = async () => {
    if (!estado?.trabajo) return
    esperando.current = false
    await pedir(`/api/trabajos/${estado.trabajo.id}/cancelar`, { method: 'POST' }).catch(() => undefined)
    await mirar()
  }

  if (!voz)
    return (
      <p className="nota video-descargar">
        Para descargar el vídeo en MP4 hace falta la voz de Magister (Piper) instalada en el servidor.
      </p>
    )
  const t = estado?.trabajo
  return (
    <div className="video-descargar">
      {enMarcha ? (
        <>
          <span className="video-descargar-progreso">
            <Pensando texto={t?.total ? `Montando el MP4: escena ${t.paso ?? 0} de ${t.total}` : 'Montando el MP4…'} />
          </span>
          {t?.total ? (
            <span className="barra video-barra">
              <span style={{ width: `${((t.paso ?? 0) / t.total) * 100}%` }} />
            </span>
          ) : null}
          <button type="button" className="boton-mini" onClick={() => void cancelar()}>
            Cancelar
          </button>
          {estado && !estado.trabajador && <small className="nota">No hay ningún trabajador en marcha: el MP4 no avanzará hasta que lo haya.</small>}
        </>
      ) : estado?.listo ? (
        <>
          <a className="boton" href={`/api/materiales/${mid}/mp4/fichero`} download>
            ⬇ Descargar MP4{estado.segundos ? ` (${Math.floor(estado.segundos / 60)}:${String(Math.round(estado.segundos % 60)).padStart(2, '0')})` : ''}
          </a>
          {estado.voz !== voz && (
            <button type="button" className="boton-mini" onClick={() => void pedirMp4()} title="El MP4 que hay se hizo con otra voz">
              Rehacer con la voz actual
            </button>
          )}
        </>
      ) : (
        <button type="button" className="boton" onClick={() => void pedirMp4()} title="Diapositivas o tarjetas, la voz de Magister y subtítulos">
          ⬇ Descargar vídeo
        </button>
      )}
      {t?.estado === 'fallido' && !enMarcha && (
        <span className="nota" role="alert">
          No se pudo montar: {t.error}{' '}
          <button type="button" className="boton-mini" onClick={() => void pedirMp4()}>
            Reintentar
          </button>
        </span>
      )}
      {fallo && (
        <span className="nota" role="alert">
          {fallo}{' '}
          <button type="button" className="boton-mini" onClick={() => void mirar()}>
            Reintentar
          </button>
        </span>
      )}
    </div>
  )
}
// «Nuevo vídeo»: qué lección (o qué concepto), con qué estilo y cuánto dura.
// Un vídeo con guion gráfico se ve animado; «Versión narrada» pasa al reproductor de siempre (con su MP4).
function VistaVideo({ video, diaposId }: { video: VideoInfo; diaposId?: number }) {
  const [guion, setGuion] = useState<GuionGrafico | null>(null)
  const [sencilla, setSencilla] = useState(!video.animado)
  const [fallo, setFallo] = useState(false)
  const [ReproductorEscena, setReproductorEscena] = useState(cargarEscena)
  useEffect(() => {
    if (!video.animado) return
    pedir<GuionGrafico>(`/api/materiales/${video.material_id}/guion_grafico`)
      .then(setGuion)
      .catch(() => {
        setFallo(true)
        setSencilla(true)
      })
  }, [video.material_id, video.animado])
  const cambiar = video.animado && !fallo && (
    <button className="boton boton-suave video-version" onClick={() => setSencilla((x) => !x)}>
      {sencilla ? 'Ver animado' : 'Versión narrada (y MP4)'}
    </button>
  )
  if (sencilla)
    return (
      <>
        {cambiar}
        <Reproductor video={video} diaposId={diaposId} />
      </>
    )
  return (
    <>
      {cambiar}
      {guion ? (
        <FalloReproductor alReintentar={() => setReproductorEscena(cargarEscena)}>
          <Suspense fallback={<Pensando texto="Preparando la escena…" />}>
            <ReproductorEscena guion={guion} />
          </Suspense>
        </FalloReproductor>
      ) : (
        <Pensando texto="Preparando la escena…" />
      )}
    </>
  )
}

function NuevoVideo({ plan, estados, alHecho, alCancelar }: { plan: VistaPlan; estados: Estados; alHecho: (clave: string) => void; alCancelar: () => void }) {
  const preparadas = plan.lecciones.filter((l) => estados[l.clave]?.ids?.apuntes)
  const [clave, setClave] = useState(preparadas[0]?.clave ?? '')
  const [concepto, setConcepto] = useState('')
  const [estilo, setEstilo] = useState('clase')
  const [minutos, setMinutos] = useState(6)
  const [error, setError] = useState<string | null>(null)
  const leccion = plan.lecciones.find((l) => l.clave === clave)

  if (!preparadas.length)
    return <p className="nota">Para hacer un vídeo, primero prepara alguna lección en Lecciones: el guion sale de sus apuntes.</p>

  const hacer = async () => {
    setError(null)
    const tipos = concepto || estados[clave]?.ids?.diapositivas ? ['guion'] : ['guion', 'diapositivas']
    try {
      await pedir(
        `/api/planes/${plan.plan_id}/lecciones/${clave}/material`,
        enviarJson({ forzar: true, tipos, preferencias: { video: { estilo, concepto: concepto || null, minutos } } }),
      )
      alHecho(clave)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  return (
    <section className="nuevo-video">
      <h2>Nuevo vídeo</h2>
      <div className="nuevo-video-campos">
        <label>
          Lección
          <select value={clave} onChange={(e) => { setClave(e.target.value); setConcepto('') }}>
            {preparadas.map((l) => (
              <option key={l.clave} value={l.clave}>
                {l.clave} · {l.titulo}
              </option>
            ))}
          </select>
        </label>
        <label>
          Qué explica
          <select value={concepto} onChange={(e) => setConcepto(e.target.value)}>
            <option value="">Toda la lección</option>
            {leccion?.conceptos.map((c) => (
              <option key={c.id} value={c.nombre}>
                Solo «{c.nombre}»
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="nuevo-video-estilos" role="radiogroup" aria-label="Estilo">
        {ESTILOS.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={estilo === x.id} className={`opcion ${estilo === x.id ? 'elegida' : ''}`} onClick={() => setEstilo(x.id)}>
            <strong>{x.nombre}</strong>
            <small>{x.desc}</small>
          </button>
        ))}
      </div>
      <div className="respuestas-rapidas" role="radiogroup" aria-label="Duración">
        {[3, 6, 10].map((m) => (
          <button key={m} type="button" role="radio" aria-checked={minutos === m} className={`opcion opcion-chip ${minutos === m ? 'elegida' : ''}`} onClick={() => setMinutos(m)}>
            {m} min
          </button>
        ))}
      </div>
      <BarraCuota accion={{ accion: 'video', minutos }} />
      {error && <p role="alert">{error}</p>}
      <div className="botones">
        <button className="boton boton-principal" onClick={hacer}>
          Hacer el vídeo
        </button>
        <button className="boton" onClick={alCancelar}>
          Cancelar
        </button>
      </div>
      <p className="nota">Tarda un par de minutos; puedes seguir con otra cosa. Sale de los apuntes que ya tienes.</p>
    </section>
  )
}

export default function PanelVideo() {
  const [plan, setPlan] = useState<VistaPlan | null | undefined>(undefined)
  const [estados, setEstados] = useState<Estados>({})
  const [videos, setVideos] = useState<VideoInfo[]>([])
  const [planes, setPlanes] = useState<ResumenPlan[]>([])
  const [elegido, setElegido] = useState<number | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [demo, setDemo] = useState(rutaDemo)
  const [ReproductorEscena, setReproductorEscena] = useState(cargarEscena)

  const cargar = useCallback(async (p: VistaPlan) => {
    const [e, v] = await Promise.all([
      pedir<Estados>(`/api/planes/${p.plan_id}/materiales`),
      pedir<VideoInfo[]>(`/api/planes/${p.plan_id}/videos`),
    ])
    setEstados(e)
    setVideos(v)
    return { e, v }
  }, [])

  const [falloCarga, setFalloCarga] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const reintentar = useCallback(() => {
    setFalloCarga(null)
    setIntento((x) => x + 1)
  }, [])
  useEffect(() => {
    listarPlanes()
      .then(async (ps) => {
        setPlanes(ps)
        if (!ps[0]) return setPlan(null)
        const v = await verPlan(ps[0].tema_id)
        setPlan(v)
        await cargar(v)
      })
      .catch((e) => setFalloCarga(mensajeDe(e)))
  }, [cargar, intento])

  // Mientras se hace un vídeo, se mira cada pocos segundos si ya está.
  useEffect(() => {
    if (!haciendo || !plan) return
    const antes = videos.length
    const t = setInterval(async () => {
      // Un fallo suelto (el servidor reiniciándose) no rompe la espera: se vuelve a mirar en 5 s.
      const r = await cargar(plan).catch(() => null)
      if (!r) return
      const { e, v } = r
      if (v.length > antes && !e[haciendo]?.en_marcha) {
        setElegido(v[0].material_id)
        setHaciendo(null)
      }
    }, 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haciendo, plan])

  if (plan === undefined) return falloCarga ? <Cargando error={falloCarga} reintentar={reintentar} /> : <Pensando texto="Cargando…" />
  if (!plan)
    return (
      <div className="panel">
        <h1>Vídeo</h1>
        <Vacio
          etiqueta="Sin plan todavía"
          titulo="Vídeos para entender antes de estudiar"
          texto="Cada lección con guion se ve aquí como un vídeo corto: diapositivas, voz y subtítulos, por escenas."
          acciones={[{ texto: 'Crear un plan', principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  const actual = videos.find((v) => v.material_id === elegido) ?? videos[0]

  if (demo.abierta)
    return (
      <div className="panel video-panel">
        <div className="cabecera-panel">
          <h1>Vídeo animado</h1>
          <span style={{ display: 'flex', gap: 8 }}>
            {Object.entries(DEMOS).map(([id, g]) => (
              <button
                key={id}
                className="boton"
                aria-pressed={demo.nombre === id}
                onClick={() => {
                  window.history.replaceState(null, '', `#/video/demo/${id}`)
                  setDemo({ abierta: true, nombre: id, segundo: 0 })
                }}
              >
                {g.titulo}
              </button>
            ))}
            <button
              className="boton"
              onClick={() => {
                window.history.replaceState(null, '', '#/video')
                setDemo({ abierta: false, nombre: 'indices', segundo: 0 })
              }}
            >
              Volver a tus vídeos
            </button>
          </span>
        </div>
        <FalloReproductor alReintentar={() => setReproductorEscena(cargarEscena)}>
          <Suspense fallback={<Pensando texto="Preparando la escena…" />}>
            <ReproductorEscena key={demo.nombre} guion={DEMOS[demo.nombre]} segundo={demo.segundo} />
          </Suspense>
        </FalloReproductor>
      </div>
    )

  return (
    <div className="panel video-panel">
      <div className="cabecera-panel">
        <h1>Vídeo</h1>
        {planes.length > 1 && plan && (
          <select
            className="video-plan"
            aria-label="Plan"
            value={plan.tema_id}
            onChange={(e) =>
              verPlan(Number(e.target.value))
                .then(async (v) => {
                  setPlan(v)
                  setElegido(null)
                  setNuevo(false)
                  await cargar(v)
                })
                .catch((err) => setFalloCarga(mensajeDe(err)))
            }
          >
            {planes.map((x) => (
              <option key={x.plan_id} value={x.tema_id}>
                {x.tema}
              </option>
            ))}
          </select>
        )}
        {!nuevo && (
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              className="boton"
              onClick={() => {
                window.history.replaceState(null, '', '#/video/demo/indices')
                setDemo({ abierta: true, nombre: 'indices', segundo: 0 })
              }}
              title="Prototipo del vídeo animado: una lección hecha con el método del núcleo"
            >
              Vídeo animado (demo)
            </button>
            <button className="boton boton-principal" onClick={() => setNuevo(true)} disabled={!!haciendo}>
              Nuevo vídeo
            </button>
          </span>
        )}
      </div>
      {nuevo && (
        <NuevoVideo
          plan={plan}
          estados={estados}
          alCancelar={() => setNuevo(false)}
          alHecho={(c) => {
            setNuevo(false)
            setHaciendo(c)
          }}
        />
      )}
      {haciendo && (
        <p className="nota video-haciendo">
          <Pensando texto={`Haciendo el vídeo de ${haciendo}. Tarda un par de minutos; puedes seguir con otra cosa.`} />
        </p>
      )}
      {actual ? (
        <VistaVideo key={actual.material_id} video={actual} diaposId={estados[actual.clave]?.ids?.diapositivas} />
      ) : (
        !nuevo && (
          <Vacio
            etiqueta="Aún no tienes vídeos"
            titulo="Haz el primero"
            texto="Elige una lección preparada (o un solo concepto), el estilo y la duración. Se ve aquí narrado, con subtítulos y sus diapositivas."
            acciones={[{ texto: 'Nuevo vídeo', principal: true, alPulsar: () => setNuevo(true) }]}
          />
        )
      )}
      {videos.length > 0 && (
        <section className="pg-seccion">
          <h2>Tus vídeos</h2>
          <ul className="video-biblioteca">
            {videos.map((v) => (
              <li key={v.material_id} className="video-item">
                <button className={v.material_id === actual?.material_id ? 'actual' : ''} onClick={() => setElegido(v.material_id)}>
                  <span className="bloques-clave">{v.clave}</span>
                  <span>
                    {v.concepto ?? v.titulo}
                    <small className="video-meta">
                      {NOMBRE_ESTILO[v.estilo] ?? 'Clase'}
                      {v.minutos ? ` · ${v.minutos} min` : ''}
                      {v.animado ? ' · animado' : ''}
                    </small>
                  </span>
                  <small>▶</small>
                </button>
                <button
                  className="borrar"
                  aria-label="Borrar este vídeo"
                  onClick={async () => {
                    if (!confirm('¿Borrar este vídeo? Podrás hacerlo de nuevo cuando quieras.')) return
                    await pedir(`/api/materiales/${v.material_id}`, { method: 'DELETE' })
                    if (plan) cargar(plan)
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
