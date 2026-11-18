import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from './Markdown.tsx'
import { crearConversacion, enviar, listarMensajes } from '../api.ts'
import Mascota from '../Mascota.tsx'
import { MODOS } from '../modos.ts'
import { EVENTO_SUENO } from './animo.ts'
import { buscarFaq, faqsDe } from './faqs.ts'
import { aCss } from './escala.ts'

// El asesor: la mascota de la barra de arriba, cogida y dejada donde quieras. Se queda flotando sobre la pantalla y,
// al pulsarla, abre una ventanita de chat que sabe dónde estás: lo que pone la pantalla le llega con cada pregunta.
// Una conversación por sección (este proyecto, esta lección, Repaso…), con pestañas para saltar entre ellas.
// - Coger: mantener pulsada la mascota de la barra (o la flotante) y arrastrar; cierra los ojos mientras la llevas.
// - Un clic en la flotante: abre o cierra el chat. Doble clic: vuelve a la barra.
// - Imán: si la acercas a su sitio de la barra, se pega; soltada ahí, vuelve a la barra.

export const EVENTO_COGER = 'magister-asesor-coger'
export const EVENTO_ESTADO = 'magister-asesor-estado'
const CLAVE = 'magister-asesor'
const CLAVE_HILOS = 'magister-asesor-hilos'
const TAM = 64 // lo que mide la mascota flotante
const ESPERA_COGER = 350
const HOLGURA = 8
const IMAN = 180 // a cuántos píxeles de su sitio en la barra la atrae el imán

// El centro de su sitio en la barra de arriba (el botón de la mascota), si está a la vista.
function casa(): { x: number; y: number } | null {
  const r = document.querySelector('.afinar-boton')?.getBoundingClientRect()
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
}
// Si la mascota (su esquina en x, y) está al alcance del imán, dónde se pega.
function alIman(x: number, y: number): { x: number; y: number } | null {
  const c = casa()
  if (!c || Math.hypot(x + TAM / 2 - c.x, y + TAM / 2 - c.y) > IMAN) return null
  return { x: Math.round(c.x - TAM / 2), y: Math.round(c.y - TAM / 2) }
}

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

// A dónde puede llevarte el asesor: las secciones de la app y los pasos de proyecto que hay en pantalla.
function rutasPosibles(): { rutas: string[]; pasos: { id: string; titulo: string }[] } {
  const rutas = MODOS.filter((m) => m.encendido).map((m) => `#/${m.id}`)
  const pasos = Array.from(document.querySelectorAll<HTMLElement>('main.central [id^="paso-"]')).slice(0, 40).map((el) => ({
    id: el.id.slice(5),
    titulo: el.querySelector('strong')?.textContent?.trim() ?? '',
  }))
  return { rutas, pasos }
}

interface Accion {
  texto: string
  destino: string
}

// El bloque ```acciones de una respuesta: «Texto | destino» por línea. Solo vale un destino que exista de verdad.
function separarAcciones(texto: string): { cuerpo: string; acciones: Accion[] } {
  const acciones: Accion[] = []
  const cuerpo = texto.replace(/```acciones[^\n]*\n([\s\S]*?)(```|$)/g, (_, dentro: string) => {
    for (const linea of dentro.split('\n')) {
      const [t, d] = linea.split('|').map((x) => x?.trim().replace(/^[-*]\s*/, ''))
      if (t && d && acciones.length < 3) acciones.push({ texto: t.slice(0, 60), destino: d })
    }
    return ''
  })
  return { cuerpo, acciones }
}

function ejecutar(a: Accion) {
  if (a.destino.startsWith('paso:')) {
    const el = document.getElementById(`paso-${a.destino.slice(5)}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('destacado')
    window.setTimeout(() => el.classList.remove('destacado'), 1800)
  } else if (/^#\/[\w-]+(\/[\w-]+)*$/.test(a.destino) && MODOS.some((m) => m.encendido && a.destino.slice(2).split('/')[0] === m.id)) {
    window.location.hash = a.destino
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
  const [iman, setIman] = useState(false)
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
  const [abrioAhora, setAbrioAhora] = useState(false)
  const aviso = usarAvisoAtasco(sitio.activo && !abierto)
  const [textoInicial, setTextoInicial] = useState('')
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
      // Cerca de su sitio en la barra, el imán la atrae y se queda pegada allí hasta que la alejes.
      const mover = (e: PointerEvent) => {
        const p = dentro(e.clientX - delta.x, e.clientY - delta.y)
        const pegada = alIman(p.x, p.y)
        setIman(!!pegada)
        setSitio({ activo: true, ...(pegada ?? p) })
      }
      const soltar = (e: PointerEvent) => {
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', soltar)
        window.removeEventListener('pointercancel', soltar)
        setCogida(false)
        setIman(false)
        const p = dentro(e.clientX - delta.x, e.clientY - delta.y)
        // Soltada al alcance del imán: vuelve a la barra.
        if (alIman(p.x, p.y)) {
          setAbierto(false)
          fijar({ activo: false, ...p })
        } else {
          fijar({ activo: true, ...p })
        }
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
    [fijar, setAbierto],
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
    setAbrioAhora(true)
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
    <div ref={caja} className={`asesor ${cogida ? 'cogida' : ''} ${iman ? 'iman' : ''} ${abierto ? 'abierto' : ''}`} style={{ left: aCss(sitio.x), top: aCss(sitio.y) }}>
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
        aria-expanded={abierto}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault() // Espacio no desplaza la página
          setAbrioAhora(true)
          setAbierto((a) => !a)
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Mascota gesto={piensa ? 'pensando' : abierto ? 'escuchando' : aviso.texto ? 'escuchando' : 'normal'} />
      </div>
      {aviso.texto && !abierto && !cogida && (
        <div className={`asesor-aviso ${aLaIzquierda ? 'izquierda' : 'derecha'}`} role="status">
          <p>{aviso.texto}</p>
          <div>
            <button
              type="button"
              onClick={() => {
                setTextoInicial(aviso.paso ? `Me he atascado en «${aviso.paso}»: ` : 'Me he atascado: ')
                aviso.cerrar()
                setAbrioAhora(true)
                setAbierto(true)
              }}
            >
              Me he atascado
            </button>
            <button type="button" className="suave" onClick={aviso.cerrar}>
              Va bien
            </button>
          </div>
        </div>
      )}
      {abierto && !cogida && (
        <ChatAsesor
          lado={aLaIzquierda ? 'izquierda' : 'derecha'}
          vertical={haciaArriba ? 'arriba' : 'abajo'}
          alCerrar={() => setAbierto(false)}
          alDevolver={devolver}
          alPensar={setPiensa}
          textoInicial={textoInicial}
          enfocar={abrioAhora}
        />
      )}
    </div>
  )
}

// ¿Te has atascado? Si llevas más de 25 minutos en un proyecto sin marcar ningún paso, al volver (a la ventana, o de
// la siesta de la mascota) el asesor pregunta por el paso que toca. Como mucho una vez cada 25 minutos.
const ATASCO_MS = 25 * 60 * 1000
const CLAVE_VISTO = 'magister-asesor-visto'

function usarAvisoAtasco(activo: boolean): { texto: string | null; paso: string | null; cerrar: () => void } {
  const [aviso, setAviso] = useState<{ texto: string; paso: string | null } | null>(null)
  const marcarVisto = (pid: string, ahora = Date.now()) => {
    const v = leer<Record<string, number>>(CLAVE_VISTO, {})
    guardar(CLAVE_VISTO, { ...v, [pid]: ahora })
  }
  useEffect(() => {
    if (!activo) return
    const proyecto = () => window.location.hash.match(/^#\/proyectos\/(\d+)/)?.[1] ?? null
    // Al entrar en un proyecto empieza a contar (si no estaba contando ya hoy).
    const alEntrar = () => {
      const pid = proyecto()
      if (!pid) return setAviso(null)
      const v = leer<Record<string, number>>(CLAVE_VISTO, {})
      if (!v[pid] || Date.now() - v[pid] > 12 * 3600 * 1000) marcarVisto(pid)
    }
    const revisar = async () => {
      const pid = proyecto()
      if (!pid || document.visibilityState !== 'visible') return
      const desde = leer<Record<string, number>>(CLAVE_VISTO, {})[pid] ?? Date.now()
      if (Date.now() - desde < ATASCO_MS) return
      try {
        const p = await (await fetch(`/api/proyectos/${pid}`)).json()
        const fechas = Object.values((p.hechos_en ?? {}) as Record<string, string>).map((x) => new Date(x).getTime())
        if (fechas.length && Date.now() - Math.max(...fechas) < ATASCO_MS) return marcarVisto(pid, Math.max(...fechas))
        const hechos = new Set<string>(p.hechos ?? [])
        type P = { id: string; titulo: string }
        const siguiente = ((p.roadmap?.niveles ?? []) as { bloques: { pasos: P[] }[] }[])
          .flatMap((n) => n.bloques.flatMap((b) => b.pasos))
          .find((x) => !hechos.has(x.id))
        if (!siguiente) return
        setAviso({ texto: `¿Qué tal con «${siguiente.titulo}»? Si te has atascado, cuéntamelo.`, paso: siguiente.titulo })
      } catch {
        /* sin red: otra vez será */
      }
    }
    alEntrar()
    const alVolver = () => document.visibilityState === 'visible' && void revisar()
    const alDespertar = (e: Event) => !(e as CustomEvent<boolean>).detail && void revisar()
    const cambiar = () => {
      alEntrar()
      void revisar()
    }
    const t = window.setInterval(() => void revisar(), 5 * 60 * 1000)
    window.addEventListener('hashchange', cambiar)
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener(EVENTO_SUENO, alDespertar)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('hashchange', cambiar)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener(EVENTO_SUENO, alDespertar)
    }
  }, [activo])
  return {
    texto: aviso?.texto ?? null,
    paso: aviso?.paso ?? null,
    cerrar: () => {
      const pid = window.location.hash.match(/^#\/proyectos\/(\d+)/)?.[1]
      if (pid) marcarVisto(pid)
      setAviso(null)
    },
  }
}

// Una respuesta del asesor: el texto y, debajo, sus botones (si propuso alguno). Los bloques del chat grande que
// aquí no se ven (test, opciones, dibujos) se quitan.
function RespuestaAsesor({ texto }: { texto: string }) {
  if (!texto) return <div className="asesor-tutor"><span className="asesor-escribiendo" aria-label="Pensando" /></div>
  const { cuerpo, acciones } = separarAcciones(texto)
  const limpio = cuerpo.replace(/```[\s\S]*?(```|$)/g, (b) => (/^```(svg|test|opciones|concepto|ficha)/.test(b) ? '' : b))
  return (
    <div className="asesor-tutor">
      <Markdown>{limpio}</Markdown>
      {acciones.length > 0 && (
        <div className="asesor-acciones">
          {acciones.map((a) => (
            <button key={a.texto} type="button" onClick={() => ejecutar(a)}>
              {a.texto} →
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChatAsesor({ lado, vertical, alCerrar, alDevolver, alPensar, textoInicial = '', enfocar = false }: {
  lado: 'izquierda' | 'derecha'
  vertical: 'arriba' | 'abajo'
  alCerrar: () => void
  alDevolver: () => void
  alPensar: (s: boolean) => void
  textoInicial?: string
  // Solo coge el foco si lo acabas de abrir tú (no cuando se restaura al cargar la página).
  enfocar?: boolean
}) {
  const [aqui, setAqui] = useState(seccionActual)
  const [hilos, setHilos] = useState<Record<string, Hilo>>(() => leer<Record<string, Hilo>>(CLAVE_HILOS, {}))
  const [viendo, setViendo] = useState<string>(() => seccionActual().clave)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [texto, setTexto] = useState(textoInicial)
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

  // La conversación de la sección que miras. Depende solo de qué conversación es (no de toda la lista de hilos, que cambia
  // con cada pregunta): si no, cada pregunta vaciaba el chat y la respuesta que llegaba pisaba lo recargado. Y la que
  // acaba de nacer con la pregunta en marcha no se recarga encima de ella.
  const cid = hilos[viendo]?.cid
  const recien = useRef<number | null>(null)
  useEffect(() => {
    setError(null)
    if (cid != null && cid === recien.current) return
    setMensajes([])
    if (cid == null) return
    listarMensajes(cid)
      .then((ms) => setMensajes(ms.filter((m) => m.contenido).map((m) => ({ rol: m.rol, texto: m.contenido }))))
      .catch(() => undefined)
  }, [viendo, cid])

  useEffect(() => {
    fondo.current?.scrollTo({ top: fondo.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes])
  useEffect(() => alPensar(pensando), [pensando, alPensar])
  useEffect(() => () => control.current?.abort(), [])

  const preguntar = async (pregunta: string) => {
    pregunta = pregunta.trim()
    if (!pregunta || pensando) return
    // Las preguntas frecuentes no se enseñan: si la pregunta se parece a una, su respuesta va al tutor como referencia.
    const frecuente = buscarFaq(pregunta)
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
        recien.current = c.id
        h = { cid: c.id, nombre: s.nombre, usado: Date.now() }
      }
      const nuevos = { ...hilos, [s.clave]: { ...h, nombre: s.nombre, usado: Date.now() } }
      setHilos(nuevos)
      guardar(CLAVE_HILOS, nuevos)
      setMensajes((m) => [...m, { rol: 'usuario', texto: pregunta }, { rol: 'tutor', texto: '' }])
      const { rutas, pasos } = rutasPosibles()
      const contexto =
        `Sección: ${s.nombre}\nRuta: ${window.location.hash || '#/'}\n<pantalla>\n${textoPantalla()}\n</pantalla>\n` +
        `<rutas>\n${rutas.join(' ')}${pasos.length ? `\nPasos en pantalla: ${pasos.map((p) => `paso:${p.id} «${p.titulo}»`).join('; ')}` : ''}\n</rutas>` +
        (frecuente ? `\n<referencia>\nCómo funciona esto en Magister (úsalo si viene al caso): ${frecuente.respuesta}\n</referencia>` : '')
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

  // Una sola pantalla: la conversación de la sección en la que estás. Tres sugerencias para empezar; si no, escribes.
  const sugerencias = ['Explícame esta pantalla', ...faqsDe(aqui.clave.split('/')[0]).map((f) => f.pregunta)].slice(0, 3)

  return (
    <section className={`asesor-chat ${lado} ${vertical}`} role="dialog" aria-label={`Tu asesor · ${aqui.nombre}`}>
      <header className="asesor-cabeza">
        <div>
          <span className="asesor-etq">Tu asesor</span>
          <strong>{aqui.nombre}</strong>
        </div>
        <button type="button" className="asesor-x" onClick={alDevolver} title="Devolver la mascota a la barra" aria-label="Devolver la mascota a la barra">
          ⤴
        </button>
        <button type="button" className="asesor-x" onClick={alCerrar} title="Cerrar" aria-label="Cerrar">
          ×
        </button>
      </header>
      <div className="asesor-hilo" ref={fondo} role="log" aria-live="polite">
        {!mensajes.length && (
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
            <div key={i}>
              <RespuestaAsesor texto={m.texto} />
            </div>
          ),
        )}
        {error && <p className="nota">{error}</p>}
      </div>
      <form
        className="asesor-escribir"
        onSubmit={(e) => {
          e.preventDefault()
          void preguntar(texto)
        }}
      >
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O escríbeme tu pregunta" aria-label="Tu pregunta" autoFocus={enfocar} />
        <button className="boton-mini" disabled={!texto.trim() || pensando}>
          {pensando ? '…' : 'Enviar'}
        </button>
      </form>
    </section>
  )
}
