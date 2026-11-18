import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { crearConversacion, enviar, listarMensajes } from '../api.ts'
import Mascota from '../Mascota.tsx'
import { MODOS } from '../modos.ts'

// El asesor: la mascota de la barra de arriba, cogida y dejada donde quieras. Se queda flotando sobre la pantalla y,
// al pulsarla, abre una ventanita de chat que sabe dónde estás: lo que pone la pantalla le llega con cada pregunta.
// Una conversación por sección (este proyecto, esta lección, Repaso…), con pestañas para saltar entre ellas.
// - Coger: mantener pulsada la mascota de la barra (o la flotante) y arrastrar; cierra los ojos mientras la llevas.
// - Un clic en la flotante: abre o cierra el chat. Doble clic: vuelve a la barra.

export const EVENTO_COGER = 'magister-asesor-coger'
export const EVENTO_ESTADO = 'magister-asesor-estado'
const CLAVE = 'magister-asesor'
const CLAVE_HILOS = 'magister-asesor-hilos'
const TAM = 64 // lo que mide la mascota flotante
const ESPERA_COGER = 350
const HOLGURA = 8

interface Sitio {
  activo: boolean
  x: number
  y: number
}
interface Hilo {
  cid: number
  nombre: string
  usado: number
}
interface Mensaje {
  rol: 'usuario' | 'tutor'
  texto: string
}

const leer = <T,>(clave: string, defecto: T): T => {
  try {
    return { ...defecto, ...JSON.parse(localStorage.getItem(clave) ?? 'null') } as T
  } catch {
    return defecto
  }
}
const guardar = (clave: string, valor: unknown) => {
  try {
    localStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}
export const asesorActivo = () => leer<Sitio>(CLAVE, { activo: false, x: 0, y: 0 }).activo

const dentro = (x: number, y: number) => ({
  x: Math.round(Math.max(8, Math.min(window.innerWidth - TAM - 8, x))),
  y: Math.round(Math.max(8, Math.min(window.innerHeight - TAM - 8, y))),
})

// Dónde estás: la sección (por la ruta) y, si la hay, la cosa concreta (el título de la pantalla).
function seccionActual(): { clave: string; nombre: string } {
  const partes = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const modo = MODOS.find((m) => m.id === partes[0])
  const base = partes[0] === 'conversacion' ? 'Estudio libre' : (modo?.nombre ?? 'Hoy')
  const titulo = document.querySelector('main.central h1')?.textContent?.trim()
  const concreto = partes.length > 1 && titulo && titulo !== base ? titulo : null
  return {
    clave: (partes.slice(0, 2).join('/') || 'hoy').slice(0, 80),
    nombre: concreto ? `${base} · ${concreto.slice(0, 60)}` : base,
  }
}

// Lo que pone la pantalla, en texto y sin el propio asesor (va al tutor marcado como datos de la página).
function textoPantalla(): string {
  const main = document.querySelector('main.central') as HTMLElement | null
  if (!main) return ''
  return main.innerText.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim().slice(0, 6000)
}

export default function Asesor() {
  const [sitio, setSitio] = useState<Sitio>(() => leer<Sitio>(CLAVE, { activo: false, x: 0, y: 0 }))
  const [cogida, setCogida] = useState(false)
  // Si lo dejaste abierto, sigue abierto al volver.
  const [abierto, setAbiertoVista] = useState(() => leer<{ abierto: boolean }>(`${CLAVE}-abierto`, { abierto: false }).abierto)
  const setAbierto = useCallback((f: boolean | ((a: boolean) => boolean)) => {
    setAbiertoVista((a) => {
      const nuevo = typeof f === 'function' ? f(a) : f
      guardar(`${CLAVE}-abierto`, { abierto: nuevo })
      return nuevo
    })
  }, [])
  const [piensa, setPiensa] = useState(false)
  const sitioRef = useRef(sitio)
  sitioRef.current = sitio
  const caja = useRef<HTMLDivElement | null>(null)

  const fijar = useCallback((s: Sitio) => {
    setSitio(s)
    guardar(CLAVE, s)
    window.dispatchEvent(new CustomEvent(EVENTO_ESTADO, { detail: s.activo }))
  }, [])

  // Arrastrar: sigue al puntero hasta que lo sueltas (vale para cogerla de la barra y para recolocarla).
  const arrastrar = useCallback(
    (desde: { x: number; y: number }, delta: { x: number; y: number }) => {
      setCogida(true)
      const mover = (e: PointerEvent) => setSitio({ activo: true, ...dentro(e.clientX - delta.x, e.clientY - delta.y) })
      const soltar = (e: PointerEvent) => {
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', soltar)
        window.removeEventListener('pointercancel', soltar)
        setCogida(false)
        fijar({ activo: true, ...dentro(e.clientX - delta.x, e.clientY - delta.y) })
        // El clic que llega al soltar no abre nada.
        const tragar = (ev: Event) => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        window.addEventListener('click', tragar, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', tragar, { capture: true }), 0)
      }
      setSitio({ activo: true, ...dentro(desde.x - delta.x, desde.y - delta.y) })
      window.addEventListener('pointermove', mover)
      window.addEventListener('pointerup', soltar)
      window.addEventListener('pointercancel', soltar)
    },
    [fijar],
  )

  // La mascota de la barra avisa de que la has cogido: aparece bajo el dedo y te sigue.
  useEffect(() => {
    const al = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail
      arrastrar({ x, y }, { x: TAM / 2, y: TAM / 2 })
    }
    window.addEventListener(EVENTO_COGER, al)
    return () => window.removeEventListener(EVENTO_COGER, al)
  }, [arrastrar])

  // Si la ventana encoge, que no se quede fuera.
  useEffect(() => {
    const al = () => sitioRef.current.activo && fijar({ activo: true, ...dentro(sitioRef.current.x, sitioRef.current.y) })
    window.addEventListener('resize', al)
    return () => window.removeEventListener('resize', al)
  }, [fijar])

  // La flotante: mantener pulsada la recoloca; un clic abre el chat; doble clic la devuelve a la barra.
  const pulsar = useRef<{ t: number; x: number; y: number } | null>(null)
  const alBajar = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const x = e.clientX
    const y = e.clientY
    const delta = { x: x - sitio.x, y: y - sitio.y }
    const t = window.setTimeout(() => {
      pulsar.current = null
      arrastrar({ x, y }, delta)
    }, ESPERA_COGER)
    pulsar.current = { t, x, y }
  }
  const alMover = (e: React.PointerEvent) => {
    const p = pulsar.current
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > HOLGURA) {
      window.clearTimeout(p.t)
      pulsar.current = null
      arrastrar({ x: e.clientX, y: e.clientY }, { x: p.x - sitio.x, y: p.y - sitio.y })
    }
  }
  const alSubir = () => {
    const p = pulsar.current
    if (!p) return
    window.clearTimeout(p.t)
    pulsar.current = null
    setAbierto((a) => !a)
  }
  const devolver = () => {
    setAbierto(false)
    fijar({ ...sitio, activo: false })
  }

  if (!sitio.activo) return null
  // El chat sale hacia donde haya sitio: a la izquierda si la mascota está a la derecha, y hacia arriba si está abajo.
  const aLaIzquierda = sitio.x > window.innerWidth / 2
  const haciaArriba = sitio.y > window.innerHeight / 2
  return (
    <div ref={caja} className={`asesor ${cogida ? 'cogida' : ''} ${abierto ? 'abierto' : ''}`} style={{ left: sitio.x, top: sitio.y }}>
      <div
        className="asesor-mascota"
        role="button"
        tabIndex={0}
        aria-label={abierto ? 'Cerrar el asesor' : 'Abrir el asesor'}
        title="Tu asesor · clic: hablar · mantener: mover · doble clic: devolverlo a la barra"
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSubir}
        onDoubleClick={devolver}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setAbierto((a) => !a)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Mascota gesto={piensa ? 'pensando' : abierto ? 'escuchando' : 'normal'} />
      </div>
      {abierto && !cogida && (
        <ChatAsesor
          lado={aLaIzquierda ? 'izquierda' : 'derecha'}
          vertical={haciaArriba ? 'arriba' : 'abajo'}
          alCerrar={() => setAbierto(false)}
          alDevolver={devolver}
          alPensar={setPiensa}
        />
      )}
    </div>
  )
}

function ChatAsesor({ lado, vertical, alCerrar, alDevolver, alPensar }: {
  lado: 'izquierda' | 'derecha'
  vertical: 'arriba' | 'abajo'
  alCerrar: () => void
  alDevolver: () => void
  alPensar: (s: boolean) => void
}) {
  const [aqui, setAqui] = useState(seccionActual)
  const [hilos, setHilos] = useState<Record<string, Hilo>>(() => leer<Record<string, Hilo>>(CLAVE_HILOS, {}))
  const [viendo, setViendo] = useState<string>(() => seccionActual().clave)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const control = useRef<AbortController | null>(null)
  const fondo = useRef<HTMLDivElement | null>(null)

  // Al cambiar de pantalla, el chat se pone en la sección nueva.
  useEffect(() => {
    const al = () =>
      window.setTimeout(() => {
        const s = seccionActual()
        setAqui(s)
        setViendo(s.clave)
      }, 120)
    window.addEventListener('hashchange', al)
    return () => window.removeEventListener('hashchange', al)
  }, [])

  // La conversación de la sección que miras.
  useEffect(() => {
    const h = hilos[viendo]
    setMensajes([])
    setError(null)
    if (!h) return
    listarMensajes(h.cid)
      .then((ms) => setMensajes(ms.filter((m) => m.contenido).map((m) => ({ rol: m.rol, texto: m.contenido }))))
      .catch(() => undefined)
  }, [viendo, hilos])

  useEffect(() => {
    fondo.current?.scrollTo({ top: fondo.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes])
  useEffect(() => alPensar(pensando), [pensando, alPensar])
  useEffect(() => () => control.current?.abort(), [])

  const preguntar = async (pregunta: string) => {
    pregunta = pregunta.trim()
    if (!pregunta || pensando) return
    setTexto('')
    setError(null)
    setPensando(true)
    // La sección en la que estás ahora es la que se usa (aunque estuvieras mirando otra pestaña).
    const s = seccionActual()
    setAqui(s)
    setViendo(s.clave)
    try {
      let h = hilos[s.clave]
      if (!h) {
        const c = await crearConversacion(`Asesor · ${s.nombre}`.slice(0, 200), null, 'asesor')
        h = { cid: c.id, nombre: s.nombre, usado: Date.now() }
      }
      const nuevos = { ...hilos, [s.clave]: { ...h, nombre: s.nombre, usado: Date.now() } }
      setHilos(nuevos)
      guardar(CLAVE_HILOS, nuevos)
      setMensajes((m) => [...m, { rol: 'usuario', texto: pregunta }, { rol: 'tutor', texto: '' }])
      const contexto = `Sección: ${s.nombre}\nRuta: ${window.location.hash || '#/'}\n<pantalla>\n${textoPantalla()}\n</pantalla>`
      control.current = new AbortController()
      let acumulado = ''
      for await (const ev of enviar(h.cid, pregunta, control.current.signal, true, false, { asesor: true, contexto })) {
        if (ev.tipo === 'delta') {
          acumulado += ev.t
          setMensajes((m) => [...m.slice(0, -1), { rol: 'tutor', texto: acumulado }])
        } else if (ev.tipo === 'error') throw new Error(ev.detalle)
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setMensajes((m) => (m.length && m[m.length - 1].rol === 'tutor' && !m[m.length - 1].texto ? m.slice(0, -1) : m))
        setError('No he podido contestar. Prueba otra vez en un momento.')
      }
    } finally {
      setPensando(false)
    }
  }

  // Pestañas: la sección en la que estás y las últimas en las que hablasteis.
  const pestanas = [
    { clave: aqui.clave, nombre: aqui.nombre },
    ...Object.entries(hilos)
      .filter(([k]) => k !== aqui.clave)
      .sort((a, b) => b[1].usado - a[1].usado)
      .slice(0, 5)
      .map(([k, h]) => ({ clave: k, nombre: h.nombre })),
  ]
  const enOtra = viendo !== aqui.clave
  const sugerencias = ['¿Qué hago aquí?', 'Explícame esta pantalla', '¿Qué me recomiendas ahora?']

  return (
    <section className={`asesor-chat ${lado} ${vertical}`} role="dialog" aria-label={`Tu asesor · ${aqui.nombre}`}>
      <header className="asesor-cabeza">
        <div>
          <span className="asesor-etq">Tu asesor</span>
          <strong>{pestanas.find((p) => p.clave === viendo)?.nombre ?? aqui.nombre}</strong>
        </div>
        <button type="button" className="asesor-x" onClick={alDevolver} title="Devolver la mascota a la barra">
          ⤴
        </button>
        <button type="button" className="asesor-x" onClick={alCerrar} title="Cerrar" aria-label="Cerrar">
          ×
        </button>
      </header>
      {pestanas.length > 1 && (
        <nav className="asesor-pestanas" aria-label="Secciones con conversación">
          {pestanas.map((p) => (
            <button key={p.clave} type="button" className={p.clave === viendo ? 'actual' : ''} onClick={() => setViendo(p.clave)} title={p.nombre}>
              {p.clave === aqui.clave ? 'Aquí' : p.nombre}
            </button>
          ))}
        </nav>
      )}
      <div className="asesor-hilo" ref={fondo}>
        {!mensajes.length && !enOtra && (
          <div className="asesor-vacio">
            <p>Estoy aquí para lo que tienes delante. ¿En qué te ayudo?</p>
            <div className="asesor-sugerencias">
              {sugerencias.map((s) => (
                <button key={s} type="button" onClick={() => void preguntar(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {mensajes.map((m, i) =>
          m.rol === 'usuario' ? (
            <p key={i} className="asesor-tu">
              {m.texto}
            </p>
          ) : (
            <div key={i} className="asesor-tutor">
              {m.texto ? <Markdown>{m.texto.replace(/```[\s\S]*?(```|$)/g, (b) => (/^```(svg|test|opciones|concepto|ficha)/.test(b) ? '' : b))}</Markdown> : <span className="asesor-escribiendo" aria-label="Pensando" />}
            </div>
          ),
        )}
        {error && <p className="nota">{error}</p>}
      </div>
      {enOtra ? (
        <p className="asesor-otra nota">
          Esta conversación es de otra sección. Para seguirla, vuelve allí; aquí, pulsa «Aquí».
        </p>
      ) : (
        <form
          className="asesor-escribir"
          onSubmit={(e) => {
            e.preventDefault()
            void preguntar(texto)
          }}
        >
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Pregúntame sobre esta pantalla" aria-label="Tu pregunta" autoFocus />
          <button className="boton-mini" disabled={!texto.trim() || pensando}>
            {pensando ? '…' : 'Enviar'}
          </button>
        </form>
      )}
    </section>
  )
}
