import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { enviarJson, listarPlanes, pedir, verPlan, type ResumenPlan, type VistaPlan } from '../api.ts'
import { planActivo, recordarPlan } from '../componentes/planActivo.ts'
import { colorDeTema } from '../componentes/colorTema.ts'
import Pensando from '../componentes/Pensando.tsx'
import Cargando, { DetalleTecnico, mayuscula, mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import { errorLegible } from '../componentes/errores.ts'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import ControlVoz, { usarAjustesVoz } from '../componentes/ControlVoz.tsx'
import {
  leerAjustesVoz,
  pedirVozMagister,
  pronunciar,
  vocesMagister,
  vocesMagisterListas,
  LENGUA,
  vozElegida,
  vozLocal,
  vozMagister,
} from '../componentes/voz.ts'
import { idiomaActual, t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import BarraCuota from '../componentes/BarraCuota.tsx'
import { DEMO_IDEMPOTENCIA } from '../escena/demo.ts'
import { DEMO_INDICES } from '../escena/indices.ts'
import { DEMO_TOPOGRAFIA } from '../escena/topografia.ts'
import { teclaDelReproductor } from '../escena/teclas.ts'
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
        error={t('video.noCargado', { motivo: this.state.error.message })}
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
  [clave: string]: {
    tipos: Record<string, string>
    ids?: Record<string, number>
    en_marcha?: boolean
    trabajo?: { id: number; estado: string; tipos: string[] } | null
  }
}

// La lección cuyo vídeo (un trabajo con guion) está en marcha: al entrar o al recargar se sigue viendo «Haciendo el
// vídeo de L3» en vez de «Aún no tienes vídeos».
function videoEnMarcha(estados: Estados): string | null {
  return Object.entries(estados).find(([, d]) => d.en_marcha && d.trabajo?.tipos?.includes('guion'))?.[0] ?? null
}

// #/video/<tema>: el plan elegido va también en la ruta, así recargar lo conserva aunque el navegador no guarde nada.
function temaDeLaRuta(): number | null {
  const n = Number(window.location.hash.split('?')[0].match(/^#\/video\/(\d+)(?:\/|$)/)?.[1])
  return Number.isInteger(n) && n > 0 ? n : null
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

const ESTILOS_ID = ['clase', 'resumen', 'analogias', 'examen'] as const
const estilos = () => ESTILOS_ID.map((id) => ({ id, nombre: t(`video.estilo.${id}`), desc: t(`video.estilo.${id}.desc`) }))
const nombreEstilo = (id: string): string => (id in { clase: 1, resumen: 1, analogias: 1, examen: 1 } ? t(`video.estilo.${id}` as 'video.estilo.clase') : t('video.estilo.clase'))

const nombreMarca = (m: string) =>
  ['intuicion', 'choque', 'nombre', 'teoria'].includes(m) ? t(`video.marca.${m}` as 'video.marca.teoria') : m.charAt(0).toUpperCase() + m.slice(1)

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

type EstadoVoz = 'parado' | 'sonando' | 'pausado'

function Reproductor({ video, diaposId }: { video: VideoInfo; diaposId?: number }) {
  const { idioma } = usarIdioma() // los textos y la voz siguen al idioma
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
  // Con una voz de Magister (Piper) elegida, cada frase suena en un <audio>; antes la versión narrada solo usaba la del
  // navegador, y además sin decirlo. Si Piper falla, suena la del navegador y se avisa.
  const audio = useRef<HTMLAudioElement | null>(null)
  const audios = useRef(new Map<string, Promise<string | null>>())
  const [avisoVoz, setAvisoVoz] = useState<string | null>(null)
  // Un vídeo de un solo concepto no casa con las diapositivas de toda la lección: va con tarjetas de escena.
  const conDiapos = !!diaposId && !video.concepto

  // Corta lo que suena (voz del navegador o audio de Magister) sin tocar dónde va.
  const callar = () => {
    window.speechSynthesis?.cancel()
    const a = audio.current
    if (a) {
      a.onended = null
      a.onerror = null
      a.pause()
      audio.current = null
    }
  }
  const pedirAudio = (frase: string, vozId: string): Promise<string | null> => {
    const clave = `${vozId}|${frase}`
    let p = audios.current.get(clave)
    if (!p) {
      p = pedirVozMagister(frase, vozId)
        .then((b) => (b ? URL.createObjectURL(b) : null))
        .catch(() => null)
      audios.current.set(clave, p)
    }
    return p
  }
  useEffect(() => {
    const cache = audios.current
    return () => {
      for (const p of cache.values()) void p.then((u) => u && URL.revokeObjectURL(u))
      cache.clear()
    }
  }, [video.material_id])

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
        callar()
        setVoz((v) => (v === 'sonando' ? 'pausado' : v))
      }
    }
    document.addEventListener('visibilitychange', oculto)
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', cargarVoz)
      document.removeEventListener('visibilitychange', oculto)
      turno.current++
      callar()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      callar()
      const mio = ++turno.current
      const frase = lista[ie]?.frases[jf]
      if (!frase) {
        setVoz('parado')
        return
      }
      const siguiente = () => {
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
      const conNavegador = () => {
        if (mio !== turno.current) return
        const u = new SpeechSynthesisUtterance(frase)
        u.lang = LENGUA[idiomaActual()]
        const elegida = vozElegida() ?? laVoz
        if (elegida) u.voice = elegida
        u.rate = velocidad
        u.onend = siguiente
        window.speechSynthesis.speak(u)
      }
      const magister = vozMagister()
      if (!magister) {
        // Elegiste una voz de Magister y no está (el servidor no la tiene): se dice, no se cambia en silencio.
        if (leerAjustesVoz().voz?.startsWith('piper:'))
          setAvisoVoz(t('video.vozNoDisponible'))
        conNavegador()
        return
      }
      // Las dos frases siguientes se piden ya, mientras suena esta: sin huecos entre frases.
      const resto = lista.slice(ie).flatMap((x, k) => (k === 0 ? x.frases.slice(jf + 1) : x.frases))
      for (const x of resto.slice(0, 2)) void pedirAudio(x, magister)
      const caer = () => {
        setAvisoVoz(t('video.vozNoUsable'))
        conNavegador()
      }
      void pedirAudio(frase, magister).then((url) => {
        if (mio !== turno.current) return
        if (!url) return caer()
        const a = new Audio(url)
        a.playbackRate = velocidad
        a.onended = siguiente
        a.onerror = caer
        audio.current = a
        setAvisoVoz(null)
        a.play().catch(caer)
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const a = audio.current
    if (voz === 'sonando') {
      if (a) a.pause()
      else s.pause()
      setVoz('pausado')
    } else if (voz === 'pausado' && a && a.paused) {
      void a.play().catch(() => decir(e, f))
      setVoz('sonando')
    } else if (voz === 'pausado' && !a && s.paused) {
      s.resume()
      setVoz('sonando')
    } else {
      setVoz('sonando')
      decir(e, f)
    }
  }
  const parar = () => {
    turno.current++
    callar()
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
      // Las flechas y la S valen también con el foco en un botón (tras pulsar «Ver»); el espacio ahí pulsa el botón.
      if (!teclaDelReproductor(ev, ev.target as Element | null)) return
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

  if (!lista) return falloLista ? <Cargando error={falloLista} reintentar={() => setIntento((x) => x + 1)} /> : <Pensando texto={t('video.cargando')} />
  const escena = lista[e]

  return (
    <div className="video">
      <div className={`video-pantalla ${voz}`} onClick={tocar} role="button" aria-label={voz === 'sonando' ? t('video.pausar') : t('video.reproducir')}>
        {conDiapos ? (
          <iframe
            ref={marco}
            title={t('video.diapositivasDe', { clave: video.clave })}
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
        <button className="boton" onClick={() => irEscena(e - 1)} aria-label={t('video.escenaAnterior')}>
          ⏮
        </button>
        <button className="boton boton-principal video-tocar" onClick={tocar}>
          {voz === 'sonando' ? t('video.pausa') : voz === 'pausado' ? t('video.seguir') : t('video.ver')}
        </button>
        <button className="boton" onClick={parar} disabled={voz === 'parado' && hechas === 0} aria-label={t('video.parar')} title={t('video.pararAyuda')}>
          ■
        </button>
        <button className="boton" onClick={() => irEscena(e + 1)} aria-label={t('video.escenaSiguiente')}>
          ⏭
        </button>
        <span className="barra video-barra">
          <span style={{ width: `${total ? (hechas / total) * 100 : 0}%` }} />
        </span>
        <ControlVoz compacto />
      </div>
      <DescargarVideo video={video} lista={lista} paginas={conDiapos ? paginas : 0} />
      {avisoVoz && (
        <p className="nota" role="status">
          {avisoVoz}
        </p>
      )}
      {!laVoz && !vozMagister() && (
        <p className="nota">{t('video.sinVoz', { idioma: t(`video.idioma.${idioma}`) })}</p>
      )}
      <div className="video-info">
        <h2>
          <span className="bloques-clave">{video.clave}</span> {video.concepto ?? video.titulo}
        </h2>
        <p className="nota">
          {t('video.infoEscenas', { estilo: nombreEstilo(video.estilo), n: lista.length })}
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

  const { idioma } = usarIdioma()
  const voz = vozMagister() ?? voces.find((v) => (v.idioma ?? 'es') === idioma)?.id ?? null
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
    try {
      await pedir(`/api/trabajos/${estado.trabajo.id}/cancelar`, { method: 'POST' })
    } catch (e) {
      // Sin mirar() justo después, que borraría el aviso: el MP4 sigue y se sigue esperando.
      setFallo(t('video.noCancelar', { motivo: mensajeDe(e) }))
      return
    }
    esperando.current = false
    await mirar()
  }

  if (!voz)
    return (
      <p className="nota video-descargar">
        {t('video.hacePiper')}
      </p>
    )
  const tb = estado?.trabajo
  return (
    <div className="video-descargar">
      {enMarcha ? (
        <>
          <span className="video-descargar-progreso">
            <Pensando texto={tb?.total ? t('video.montandoEscena', { paso: tb.paso ?? 0, total: tb.total }) : t('video.montando')} />
          </span>
          {tb?.total ? (
            <span className="barra video-barra">
              <span style={{ width: `${((tb.paso ?? 0) / tb.total) * 100}%` }} />
            </span>
          ) : null}
          <button type="button" className="boton-mini" onClick={() => void cancelar()}>
            {t('video.cancelar')}
          </button>
          {estado && !estado.trabajador && <small className="nota">{t('video.sinTrabajador')}</small>}
        </>
      ) : estado?.listo ? (
        <>
          <a className="boton" href={`/api/materiales/${mid}/mp4/fichero`} download>
            {t('video.descargarMp4')}{estado.segundos ? ` (${Math.floor(estado.segundos / 60)}:${String(Math.round(estado.segundos % 60)).padStart(2, '0')})` : ''}
          </a>
          {estado.voz !== voz && (
            <button type="button" className="boton-mini" onClick={() => void pedirMp4()} title={t('video.rehacerAyuda')}>
              {t('video.rehacer')}
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className="boton"
          onClick={() => void pedirMp4()}
          title={t('video.mp4Ayuda')}
        >
          {t('video.descargarVersion')}
        </button>
      )}
      {tb?.estado === 'fallido' && !enMarcha && (
        <>
          <span className="nota" role="alert">
            {t('video.noMontar', { motivo: mayuscula(errorLegible(tb.error).mensaje) })}{' '}
            <button type="button" className="boton-mini" onClick={() => void pedirMp4()}>
              {t('video.reintentar')}
            </button>
          </span>
          <DetalleTecnico detalle={errorLegible(tb.error).detalle} />
        </>
      )}
      {fallo && (
        <>
          <span className="nota" role="alert">
            {errorLegible(fallo).mensaje}{' '}
            <button type="button" className="boton-mini" onClick={() => void mirar()}>
              {t('video.reintentar')}
            </button>
          </span>
          <DetalleTecnico detalle={errorLegible(fallo).detalle} />
        </>
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
    <>
      <button className="boton boton-suave video-version" onClick={() => setSencilla((x) => !x)}>
        {sencilla ? t('video.verAnimado') : t('video.versionNarrada')}
      </button>
      {/* El MP4 se monta con las diapositivas (o tarjetas) y la voz: no es esta animación. Se dice aquí, donde se busca. */}
      {!sencilla && (
        <p className="nota">
          {t('video.paraDescargar')}
        </p>
      )}
    </>
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
          <Suspense fallback={<Pensando texto={t('video.preparandoEscena')} />}>
            <ReproductorEscena guion={guion} />
          </Suspense>
        </FalloReproductor>
      ) : (
        <Pensando texto={t('video.preparandoEscena')} />
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
  const [enviando, setEnviando] = useState(false)
  const leccion = plan.lecciones.find((l) => l.clave === clave)
  // Con un trabajo de esa lección en marcha no se pide otro: con `forzar`, el servidor creaba uno nuevo en cada clic.
  const ocupada = !!estados[clave]?.en_marcha

  if (!preparadas.length)
    return <p className="nota">{t('video.primeroLeccion')}</p>

  const hacer = async () => {
    if (enviando || ocupada) return
    setError(null)
    setEnviando(true)
    const tipos = concepto || estados[clave]?.ids?.diapositivas ? ['guion'] : ['guion', 'diapositivas']
    try {
      await pedir(
        `/api/planes/${plan.plan_id}/lecciones/${clave}/material`,
        enviarJson({ forzar: true, tipos, preferencias: { video: { estilo, concepto: concepto || null, minutos } } }),
      )
      alHecho(clave)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="nuevo-video">
      <h2>{t('video.nuevo')}</h2>
      <div className="nuevo-video-campos">
        <label>
          {t('video.leccion')}
          <select value={clave} onChange={(e) => { setClave(e.target.value); setConcepto('') }}>
            {preparadas.map((l) => (
              <option key={l.clave} value={l.clave}>
                {l.clave} · {l.titulo}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('video.queExplica')}
          <select value={concepto} onChange={(e) => setConcepto(e.target.value)}>
            <option value="">{t('video.todaLeccion')}</option>
            {leccion?.conceptos.map((c) => (
              <option key={c.id} value={c.nombre}>
                {t('video.soloConcepto', { nombre: c.nombre })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="nuevo-video-estilos" role="radiogroup" aria-label={t('video.estiloAria')}>
        {estilos().map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={estilo === x.id} className={`opcion ${estilo === x.id ? 'elegida' : ''}`} onClick={() => setEstilo(x.id)}>
            <strong>{x.nombre}</strong>
            <small>{x.desc}</small>
          </button>
        ))}
      </div>
      <div className="respuestas-rapidas" role="radiogroup" aria-label={t('video.duracionAria')}>
        {[3, 6, 10].map((m) => (
          <button key={m} type="button" role="radio" aria-checked={minutos === m} className={`opcion opcion-chip ${minutos === m ? 'elegida' : ''}`} onClick={() => setMinutos(m)}>
            {t('video.min', { m })}
          </button>
        ))}
      </div>
      <BarraCuota accion={{ accion: 'video', minutos }} />
      {error && <TextoError texto={error} />}
      {ocupada && <p className="nota">{t('video.ocupada', { clave })}</p>}
      <div className="botones">
        <button className="boton boton-principal" onClick={hacer} disabled={enviando || ocupada}>
          {enviando ? t('video.pidiendo') : t('video.hacer')}
        </button>
        <button className="boton" onClick={alCancelar}>
          {t('video.cancelar')}
        </button>
      </div>
      <p className="nota">{t('video.tarda')}</p>
    </section>
  )
}

export default function PanelVideo() {
  usarIdioma() // los textos siguen al idioma
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
        // El mismo plan activo que el resto de la app (y, si la ruta lo dice, el de la ruta).
        const activo = planActivo(ps, temaDeLaRuta())
        if (!activo) return setPlan(null)
        const v = await verPlan(activo.tema_id)
        setPlan(v)
        const { e } = await cargar(v)
        setHaciendo((h) => h ?? videoEnMarcha(e))
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
      // Acabado (o fallado): se deja de esperar; si salió un vídeo nuevo, se abre.
      if (!e[haciendo]?.en_marcha) {
        if (v.length > antes) setElegido(v[0].material_id)
        setHaciendo(null)
      }
    }, 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haciendo, plan])

  if (plan === undefined) return falloCarga ? <Cargando error={falloCarga} reintentar={reintentar} /> : <Pensando texto={t('video.cargandoCorto')} />
  if (!plan)
    return (
      <div className="panel">
        <h1>{t('video.titulo')}</h1>
        <Vacio
          etiqueta={t('video.sinPlan')}
          titulo={t('video.sinPlanTitulo')}
          texto={t('video.sinPlanTexto')}
          acciones={[{ texto: t('video.crearPlan'), principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  const actual = videos.find((v) => v.material_id === elegido) ?? videos[0]

  if (demo.abierta)
    return (
      <div className="panel video-panel">
        <div className="cabecera-panel">
          <h1>{t('video.animado')}</h1>
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
              {t('video.volver')}
            </button>
          </span>
        </div>
        <FalloReproductor alReintentar={() => setReproductorEscena(cargarEscena)}>
          <Suspense fallback={<Pensando texto={t('video.preparandoEscena')} />}>
            <ReproductorEscena key={demo.nombre} guion={DEMOS[demo.nombre]} segundo={demo.segundo} />
          </Suspense>
        </FalloReproductor>
      </div>
    )

  return (
    <div className="panel video-panel">
      <div className="cabecera-panel">
        <h1>{t('video.titulo')}</h1>
        {planes.length > 1 && plan && (
          <span className="selector-tema video-plan">
          <span className="punto-tema" style={colorDeTema(plan.tema_id, planes)?.estilo} aria-hidden="true" />
          <select
            aria-label={t('video.planAria')}
            value={plan.tema_id}
            onChange={(e) =>
              verPlan(Number(e.target.value))
                .then(async (v) => {
                  recordarPlan(v.tema_id)
                  window.history.replaceState(null, '', `#/video/${v.tema_id}`)
                  setPlan(v)
                  setElegido(null)
                  setNuevo(false)
                  setHaciendo(videoEnMarcha((await cargar(v)).e))
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
          </span>
        )}
        {!nuevo && (
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              className="boton"
              onClick={() => {
                window.history.replaceState(null, '', '#/video/demo/indices')
                setDemo({ abierta: true, nombre: 'indices', segundo: 0 })
              }}
              title={t('video.demoAyuda')}
            >
              {t('video.demo')}
            </button>
            <button className="boton boton-principal" onClick={() => setNuevo(true)} disabled={!!haciendo}>
              {t('video.nuevo')}
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
          <Pensando texto={t('video.haciendo', { clave: haciendo })} />
        </p>
      )}
      {actual ? (
        <VistaVideo key={actual.material_id} video={actual} diaposId={estados[actual.clave]?.ids?.diapositivas} />
      ) : (
        !nuevo && !haciendo && (
          <Vacio
            etiqueta={t('video.aunNo')}
            titulo={t('video.primero')}
            texto={t('video.aunNoTexto')}
            acciones={[{ texto: t('video.nuevo'), principal: true, alPulsar: () => setNuevo(true) }]}
          />
        )
      )}
      {videos.length > 0 && (
        <section className="pg-seccion">
          <h2>{t('video.tusVideos')}</h2>
          <ul className="video-biblioteca">
            {videos.map((v) => (
              <li key={v.material_id} className="video-item">
                <button className={v.material_id === actual?.material_id ? 'actual' : ''} onClick={() => setElegido(v.material_id)}>
                  <span className="bloques-clave">{v.clave}</span>
                  <span>
                    {v.concepto ?? v.titulo}
                    <small className="video-meta">
                      {nombreEstilo(v.estilo)}
                      {v.minutos ? ` · ${t('video.min', { m: v.minutos })}` : ''}
                      {v.animado ? t('video.animadoMeta') : ''}
                    </small>
                  </span>
                  <small>▶</small>
                </button>
                <button
                  className="borrar"
                  aria-label={t('video.borrarAria')}
                  onClick={async () => {
                    if (!confirm(t('video.confirmarBorrar'))) return
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
