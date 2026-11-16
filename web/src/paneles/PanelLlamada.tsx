import { useCallback, useEffect, useRef, useState } from 'react'
import { crearConversacion, enviar, listarPlanes, pedir, verPlan, type ExtraMensaje, type VistaPlan } from '../api.ts'
import { esEco, frases, Locutor, Oido, paraLeer } from '../componentes/voz.ts'
import { todosLosModos, usarPreferencias } from '../componentes/preferencias.ts'
import Mascota from '../Mascota.tsx'
import { escenas } from './PanelVideo.tsx'

// La llamada: hablas con tu tutor como por teléfono, sin pulsar nada.
// - Clase: te explica una lección en voz (con su guion o sus apuntes); le interrumpes cuando quieras, contesta tu duda
//   y sigue por donde iba.
// - Entrevista: te hace preguntas de entrevista técnica, te puntúa cada respuesta y, al colgar, te da la nota.
// - Charla: hablas de lo que quieras, con el modo de aprendizaje que elijas.
// Habla frase a frase según le llega la respuesta, te escucha todo el rato y distingue tu voz de la suya.

type Tipo = 'clase' | 'entrevista' | 'charla'
type Estado = 'conectando' | 'escuchando' | 'pensando' | 'hablando' | 'narrando'
interface Turno {
  rol: 'tu' | 'tutor'
  texto: string
}
interface Frase {
  marca: string
  texto: string
}

// «Sí», «vale», «sigue»... al principio de lo que dices (sin \b, que no sabe que la í es letra).
const SIGUE = /^(s[ií]|sigue|seguimos|sigamos|vale|venga|adelante|ok|okey|dale|claro|perfecto|contin[uú]a|entendido|ya est[aá])(?=[\s,.!?]|$)/i
const RELLENOS = ['A ver.', 'Vale.', 'Mmm.', 'Déjame pensar.']
const MARCAS: Record<string, string> = { intuicion: 'la intuición', choque: 'el choque', nombre: 'el nombre', teoria: 'la teoría' }

const reloj = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function PanelLlamada({ alCambiar }: { alCambiar?: () => void }) {
  const prefs = usarPreferencias()
  const [plan, setPlan] = useState<VistaPlan | null>(null)
  const [preparadas, setPreparadas] = useState<Record<string, { apuntes?: number; guion?: number }>>({})
  const ruta = window.location.hash.replace(/^#\/?/, '').split('/')
  const [tipo, setTipo] = useState<Tipo>(ruta[1] === 'entrevista' ? 'entrevista' : ruta[1] === 'charla' ? 'charla' : 'clase')
  const [clave, setClave] = useState<string>(ruta[2] ?? '')
  const [modo, setModo] = useState<string>('')
  const [noCuenta, setNoCuenta] = useState(false)
  const [velocidad, setVelocidad] = useState(1.05)

  const [fase, setFase] = useState<'preparar' | 'llamada' | 'colgada'>('preparar')
  const [estado, setEstadoVista] = useState<Estado>('conectando')
  const [subtitulo, setSubtitulo] = useState('')
  const [parcial, setParcial] = useState('')
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [segundos, setSegundos] = useState(0)
  const [mudo, setMudo] = useState(false)
  const [escrito, setEscrito] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resumen, setResumen] = useState<string | null>(null)
  const [cerrando, setCerrando] = useState(false)

  const estadoRef = useRef<Estado>('conectando')
  const cid = useRef<number | null>(null)
  const locutor = useRef(new Locutor())
  const oido = useRef(new Oido())
  const control = useRef<AbortController | null>(null)
  const narracion = useRef<{ lista: Frase[]; pos: number; activa: boolean; acabada: boolean }>({ lista: [], pos: 0, activa: false, acabada: false })
  const esperandoSeguir = useRef(false)
  const buffer = useRef('')
  const temporizador = useRef(0)
  const ultimaPregunta = useRef('')
  const finHabla = useRef(0)
  const vivo = useRef(false)
  const datos = useRef({ tipo, clave, modo, noCuenta, titulo: '' })

  const setEstado = (e: Estado) => {
    estadoRef.current = e
    setEstadoVista(e)
  }

  // Lo que hay para elegir: lecciones con apuntes (y guion, si lo tienen).
  useEffect(() => {
    listarPlanes().then(async (ps) => {
      if (!ps[0]) return
      const v = await verPlan(ps[0].tema_id)
      setPlan(v)
      const [estados, videos] = await Promise.all([
        pedir<Record<string, { tipos: Record<string, string>; ids?: Record<string, number> }>>(`/api/planes/${v.plan_id}/materiales`),
        pedir<{ material_id: number; clave: string; concepto: string | null }[]>(`/api/planes/${v.plan_id}/videos`),
      ])
      const p: Record<string, { apuntes?: number; guion?: number }> = {}
      for (const [k, e] of Object.entries(estados)) if (e.ids?.apuntes && ['listo', 'revisar'].includes(e.tipos?.apuntes)) p[k] = { apuntes: e.ids.apuntes }
      for (const x of videos) if (p[x.clave] && !x.concepto && !p[x.clave].guion) p[x.clave].guion = x.material_id
      setPreparadas(p)
      setClave((c) => (c && p[c] ? c : (Object.keys(p)[0] ?? '')))
    })
  }, [])

  useEffect(() => {
    if (fase !== 'llamada') return
    const t = window.setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [fase])

  useEffect(() => {
    locutor.current.velocidad = velocidad
  }, [velocidad])

  // Al salir de la pantalla, se cuelga.
  useEffect(
    () => () => {
      vivo.current = false
      oido.current.parar()
      locutor.current.parar()
      control.current?.abort()
    },
    [],
  )

  const leccion = plan?.lecciones.find((l) => l.clave === clave)

  // ---- El tutor habla ----
  const interrumpir = useCallback(() => {
    if (narracion.current.activa) {
      narracion.current.activa = false
      esperandoSeguir.current = true
    }
    control.current?.abort()
    locutor.current.parar()
    setEstado('escuchando')
  }, [])

  const narrar = useCallback(async () => {
    const n = narracion.current
    if (!vivo.current) return
    n.activa = true
    esperandoSeguir.current = false
    setEstado('narrando')
    const l = locutor.current
    l.nueva()
    const desde = n.pos
    let k = desde
    l.alFrase = (f) => {
      // La posición avanza con lo que de verdad suena: si le interrumpes, retoma esa misma frase.
      while (k < n.lista.length && n.lista[k].texto !== f) k++
      if (k < n.lista.length) n.pos = k
      setSubtitulo(f)
    }
    for (const x of n.lista.slice(desde)) l.decir(x.texto)
    l.cerrar()
    await l.terminado()
    if (!vivo.current || !n.activa) return
    n.activa = false
    n.acabada = true
    n.pos = n.lista.length
    finHabla.current = Date.now()
    l.nueva()
    l.alFrase = (f) => setSubtitulo(f)
    l.decir('Hasta aquí la clase. ¿Te queda alguna duda? Si no, puedes colgar cuando quieras.')
    l.cerrar()
    await l.terminado()
    finHabla.current = Date.now()
    if (vivo.current) setEstado('escuchando')
  }, [])

  const turno = useCallback(
    async (texto: string, contexto?: string, visible = true) => {
      if (!vivo.current || cid.current == null) return
      ultimaPregunta.current = texto
      if (visible) setTurnos((t) => [...t, { rol: 'tu', texto }])
      setTurnos((t) => [...t, { rol: 'tutor', texto: '' }])
      setEstado('pensando')
      const l = locutor.current
      l.nueva()
      l.alFrase = (f) => {
        setSubtitulo(f)
        if (estadoRef.current === 'pensando') setEstado('hablando')
      }
      const d = datos.current
      const extra: ExtraMensaje = {
        llamada: true,
        modo: d.tipo === 'entrevista' ? 'entrevista' : d.tipo === 'clase' ? 'normal' : d.modo || null,
        plan_id: d.clave && plan ? plan.plan_id : null,
        leccion_clave: d.tipo !== 'charla' && d.clave ? d.clave : null,
        contexto: contexto ?? null,
      }
      // Si tarda en arrancar, una palabra para que se note que te ha oído.
      let algo = false
      const relleno = window.setTimeout(() => {
        if (visible && !algo && estadoRef.current === 'pensando') l.decir(RELLENOS[Math.floor(Math.random() * RELLENOS.length)])
      }, 2200)
      control.current = new AbortController()
      let acumulado = ''
      try {
        for await (const ev of enviar(cid.current, texto, control.current.signal, !d.noCuenta, true, extra)) {
          if (ev.tipo === 'delta') {
            acumulado += ev.t
            if (frases(paraLeer(acumulado)).length > 1) algo = true
            l.empujar(acumulado)
            setTurnos((t) => [...t.slice(0, -1), { rol: 'tutor', texto: acumulado }])
          } else if (ev.tipo === 'error') throw new Error(ev.detalle)
        }
        window.clearTimeout(relleno)
        l.empujar(acumulado, true)
        await l.terminado()
        finHabla.current = Date.now()
        if (vivo.current && (estadoRef.current === 'hablando' || estadoRef.current === 'pensando')) {
          setEstado('escuchando')
          // En la clase, tras contestar la duda, espera tu «sí» para seguir.
          if (d.tipo === 'clase' && !narracion.current.acabada && narracion.current.lista.length) esperandoSeguir.current = true
        }
      } catch (e) {
        window.clearTimeout(relleno)
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError(String((e as Error).message))
          if (vivo.current) setEstado('escuchando')
        }
      }
    },
    [plan],
  )

  // ---- Lo que dices ----
  const entregar = useCallback(
    (texto: string) => {
      texto = texto.trim()
      if (!texto || !vivo.current) return
      setParcial('')
      if (esperandoSeguir.current && SIGUE.test(texto) && texto.split(/\s+/).length <= 6) {
        setTurnos((t) => [...t, { rol: 'tu', texto }])
        narrar()
        return
      }
      const n = narracion.current
      let contexto: string | undefined
      if (datos.current.tipo === 'clase' && n.lista.length && !n.acabada) {
        const aqui = n.lista[Math.min(n.pos, n.lista.length - 1)]
        contexto =
          `Es una clase por voz de la lección ${datos.current.clave} «${datos.current.titulo}». Ibas por ${aqui.marca} y estabas ` +
          `diciendo: «${aqui.texto}». El alumno te ha interrumpido: contesta a lo que dice y pregúntale si sigues con la clase.`
        esperandoSeguir.current = false
      }
      turno(texto, contexto)
    },
    [narrar, turno],
  )

  const acumular = useCallback(
    (t: string) => {
      buffer.current = `${buffer.current} ${t}`.trim()
      window.clearTimeout(temporizador.current)
      temporizador.current = window.setTimeout(() => {
        const x = buffer.current
        buffer.current = ''
        entregar(x)
      }, 1000)
    },
    [entregar],
  )

  const configurarOido = useCallback(() => {
    const o = oido.current
    const l = locutor.current
    o.alError = (e) => setError(e)
    o.alParcial = (t) => {
      if (!t) return setParcial('')
      const e = estadoRef.current
      if (e === 'hablando' || e === 'narrando') {
        // Le cortas en cuanto se oyen unas palabras tuyas que no son su propia voz.
        if (t.split(/\s+/).length >= 3 && !esEco(t, l.reciente)) {
          interrumpir()
          setParcial(t)
        }
        return
      }
      if (Date.now() - finHabla.current < 1200 && esEco(t, l.reciente)) return
      setParcial(t)
    }
    o.alFinal = (t) => {
      if (!t) return
      const e = estadoRef.current
      if (e === 'hablando' || e === 'narrando') {
        if (esEco(t, l.reciente)) return
        interrumpir()
        acumular(t)
      } else if (e === 'pensando') {
        // Sigues hablando mientras piensa: se junta con lo anterior y se vuelve a preguntar.
        control.current?.abort()
        setTurnos((x) => (x.length && x[x.length - 1].rol === 'tutor' ? x.slice(0, -2) : x))
        acumular(`${ultimaPregunta.current} ${t}`)
      } else {
        if (Date.now() - finHabla.current < 1200 && esEco(t, l.reciente)) return
        acumular(t)
      }
    }
  }, [acumular, interrumpir])

  // ---- Llamar y colgar ----
  const llamar = async () => {
    setError(null)
    setResumen(null)
    setTurnos([])
    setSegundos(0)
    setFase('llamada')
    setEstado('conectando')
    vivo.current = true
    datos.current = { tipo, clave, modo, noCuenta, titulo: leccion?.titulo ?? '' }
    narracion.current = { lista: [], pos: 0, activa: false, acabada: false }
    esperandoSeguir.current = false
    try {
      const titulo =
        tipo === 'clase' ? `Llamada: clase de ${clave}` : tipo === 'entrevista' ? `Llamada: entrevista${clave ? ` de ${clave}` : ''}` : 'Llamada'
      cid.current = (await crearConversacion(titulo)).id
      alCambiar?.()
    } catch (e) {
      setError(String((e as Error).message))
      setFase('preparar')
      return
    }
    configurarOido()
    if (!mudo) oido.current.empezar()
    const l = locutor.current
    l.velocidad = velocidad
    if (tipo === 'clase') {
      const p = preparadas[clave]
      const lista: Frase[] = []
      if (p?.guion) {
        const g = await pedir<{ texto: string }>(`/api/materiales/${p.guion}`)
        for (const e of escenas(g.texto)) for (const f of e.frases) lista.push({ marca: MARCAS[e.marca] ?? `la parte «${e.marca}»`, texto: paraLeer(f) })
      } else if (p?.apuntes) {
        const a = await pedir<{ texto: string }>(`/api/materiales/${p.apuntes}`)
        const cuerpo = a.texto.split('\n# Repaso')[0].replace(/^---\n[\s\S]*?\n---\n/, '')
        for (const seccion of cuerpo.split(/\n(?=## )/)) {
          const titulo = (seccion.match(/^## (.+)$/m)?.[1] ?? '').replace(/\{.*?\}/g, '').trim()
          const sin = seccion.replace(/^## .*$/m, '').replace(/^:::.*$/gm, '').replace(/```[\s\S]*?```/g, ' ')
          const lista2 = frases(paraLeer(sin)).slice(0, 10)
          if (!titulo || !lista2.length || /definiciones/i.test(titulo)) continue
          lista.push({ marca: `la parte «${titulo}»`, texto: `${titulo}.` })
          for (const f of lista2) lista.push({ marca: `la parte «${titulo}»`, texto: f })
        }
      }
      narracion.current.lista = [
        { marca: 'el principio', texto: `Hola. Vamos con ${clave}: ${leccion?.titulo ?? ''}.` },
        { marca: 'el principio', texto: 'Si te surge una duda, interrúmpeme cuando quieras, hablando sin más.' },
        ...lista,
      ]
      narrar()
    } else if (tipo === 'entrevista') {
      turno(
        'Empecemos la entrevista.',
        (clave
          ? `Entrevista técnica oral por llamada SOLO sobre la lección ${clave} «${leccion?.titulo ?? ''}» (sus apuntes van arriba): ` +
            'todas las preguntas salen de ahí; no menciones otras lecciones. '
          : 'Entrevista técnica oral por llamada sobre las lecciones que el alumno ya tiene preparadas. ') +
          'Preséntate en una sola frase y haz la primera pregunta, fácil. Tras cada respuesta: nota de 0 a 10 en una frase, lo que faltó en otra y la siguiente pregunta, un poco más difícil.',
        false,
      )
    } else {
      l.nueva()
      l.alFrase = (f) => setSubtitulo(f)
      setEstado('hablando')
      l.decir('Hola. ¿De qué quieres que hablemos?')
      l.cerrar()
      await l.terminado()
      finHabla.current = Date.now()
      if (vivo.current) setEstado('escuchando')
    }
  }

  const colgar = async () => {
    const habia = turnos.filter((t) => t.rol === 'tu').length
    vivo.current = false
    oido.current.parar()
    locutor.current.parar()
    control.current?.abort()
    window.clearTimeout(temporizador.current)
    setParcial('')
    setFase('colgada')
    // En la entrevista, la nota final (por escrito: ya has colgado).
    if (datos.current.tipo === 'entrevista' && habia > 0 && cid.current != null) {
      setCerrando(true)
      let texto = ''
      try {
        for await (const ev of enviar(
          cid.current,
          'Hemos terminado. Dame tu valoración final.',
          new AbortController().signal,
          !datos.current.noCuenta,
          false,
          {
            modo: 'entrevista',
            contexto:
              'La entrevista ha terminado. Da la nota media de 0 a 10, lo mejor de sus respuestas y los dos puntos que más debe repasar, en 5 frases como mucho.',
          },
        )) {
          if (ev.tipo === 'delta') {
            texto += ev.t
            setResumen(texto)
          }
        }
      } catch {
        /* sin resumen */
      }
      setCerrando(false)
    }
  }

  const alternarMudo = () => {
    if (mudo) oido.current.empezar()
    else oido.current.parar()
    setMudo(!mudo)
  }

  // Espacio: «tengo una duda» (corta al tutor y te escucha).
  useEffect(() => {
    if (fase !== 'llamada') return
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, button')) return
      if (e.key === ' ') {
        e.preventDefault()
        interrumpir()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [fase, interrumpir])

  // ---- Pantallas ----
  if (fase === 'preparar') {
    const sinOido = !oido.current.disponible()
    const modos = prefs ? todosLosModos(prefs) : []
    return (
      <div className="panel llamada-preparar">
        <h1>Llamada</h1>
        <p className="nota">Habla con tu tutor como por teléfono: sin pulsar nada, interrumpiéndole cuando quieras.</p>
        <div className="llamada-tipos" role="radiogroup" aria-label="Tipo de llamada">
          {(
            [
              ['clase', 'Clase', 'Te explica una lección en voz. Le cortas con tus dudas y sigue.'],
              ['entrevista', 'Entrevista', 'Preguntas de entrevista técnica, nota en cada respuesta y al final.'],
              ['charla', 'Charla', 'Hablas de lo que quieras, con el modo que elijas.'],
            ] as const
          ).map(([id, nombre, desc]) => (
            <button key={id} type="button" role="radio" aria-checked={tipo === id} className={`opcion ${tipo === id ? 'elegida' : ''}`} onClick={() => setTipo(id)}>
              <strong>{nombre}</strong>
              <small>{desc}</small>
            </button>
          ))}
        </div>
        {tipo !== 'charla' && (
          <label className="llamada-campo">
            Lección
            <select value={clave} onChange={(e) => setClave(e.target.value)}>
              {tipo === 'entrevista' && <option value="">Todo el plan</option>}
              {plan?.lecciones
                .filter((l) => preparadas[l.clave])
                .map((l) => (
                  <option key={l.clave} value={l.clave}>
                    {l.clave} · {l.titulo}
                    {tipo === 'clase' ? (preparadas[l.clave].guion ? ' (con guion)' : ' (de sus apuntes)') : ''}
                  </option>
                ))}
            </select>
          </label>
        )}
        {tipo === 'charla' && (
          <label className="llamada-campo">
            Modo
            <select value={modo} onChange={(e) => setModo(e.target.value)}>
              <option value="">El de siempre</option>
              <option value="normal">Normal</option>
              {modos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="llamada-ajustes">
          <label>
            Velocidad de la voz{' '}
            <select value={velocidad} onChange={(e) => setVelocidad(Number(e.target.value))}>
              {[0.95, 1, 1.05, 1.15, 1.3].map((v) => (
                <option key={v} value={v}>
                  {String(v).replace('.', ',')}×
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={noCuenta} onChange={(e) => setNoCuenta(e.target.checked)} /> Esto no cuenta para el tutor
          </label>
        </div>
        <button className="boton boton-principal llamada-llamar" onClick={llamar} disabled={tipo !== 'charla' && tipo === 'clase' && !clave}>
          Llamar
        </button>
        {tipo === 'clase' && !Object.keys(preparadas).length && <p className="nota">Para una clase, primero prepara alguna lección en Lecciones.</p>}
        {sinOido && <p className="nota">Este navegador no tiene dictado por voz: podrás escribir y te contestará en voz alta.</p>}
        <p className="nota llamada-aviso">
          Mejor con auriculares: así no se oye a sí mismo. La voz del tutor es la de tu equipo; el dictado es el de tu navegador
          (en Chrome, el audio va a Google para pasarlo a texto). La conversación se guarda como las demás.
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
    )
  }

  if (fase === 'colgada') {
    return (
      <div className="panel llamada-colgada">
        <Mascota />
        <h1>Llamada terminada</h1>
        <p className="nota">
          {reloj(segundos)} · {turnos.filter((t) => t.rol === 'tu').length} intervenciones tuyas
        </p>
        {(cerrando || resumen) && (
          <section className="llamada-resumen">
            <h2>Tu valoración</h2>
            <p>{resumen ? paraLeer(resumen) : 'Preparando la nota…'}</p>
          </section>
        )}
        <div className="botones">
          <button className="boton boton-principal" onClick={() => setFase('preparar')}>
            Otra llamada
          </button>
          {cid.current != null && (
            <a className="boton" href={`#/conversacion/${cid.current}`}>
              Ver la conversación escrita
            </a>
          )}
        </div>
      </div>
    )
  }

  const textoEstado = {
    conectando: 'Conectando…',
    escuchando: mudo ? 'Micro silenciado: escribe abajo' : 'Te escucho…',
    pensando: 'Pensando…',
    hablando: 'Hablando · interrúmpele cuando quieras',
    narrando: 'Explicando · interrúmpele cuando quieras',
  }[estado]

  return (
    <div className={`llamada en-${estado}`}>
      <div className="llamada-cabeza">
        <span className="llamada-titulo">
          {tipo === 'clase' ? `Clase · ${clave}` : tipo === 'entrevista' ? `Entrevista${clave ? ` · ${clave}` : ''}` : 'Charla'}
        </span>
        <span className="llamada-reloj">{reloj(segundos)}</span>
      </div>
      <div className="llamada-avatar">
        <span className="llamada-onda" aria-hidden />
        <Mascota />
      </div>
      <p className="llamada-estado" aria-live="polite">
        {textoEstado}
      </p>
      <p className="llamada-subtitulo">{estado === 'escuchando' || estado === 'pensando' ? '' : subtitulo}</p>
      {parcial && <p className="llamada-parcial">Tú: {parcial}</p>}
      {(mudo || !oido.current.disponible()) && (
        <form
          className="llamada-escribir"
          onSubmit={(e) => {
            e.preventDefault()
            if (!escrito.trim()) return
            interrumpir()
            entregar(escrito)
            setEscrito('')
          }}
        >
          <input value={escrito} onChange={(e) => setEscrito(e.target.value)} placeholder="Escríbele y te contesta en voz alta" aria-label="Mensaje escrito" />
          <button className="boton">Enviar</button>
        </form>
      )}
      <div className="llamada-botones">
        <button className={`llamada-boton ${mudo ? 'activo' : ''}`} onClick={alternarMudo} aria-pressed={mudo} title={mudo ? 'Activar el micro' : 'Silenciar el micro'}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            {mudo && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
          </svg>
          <small>{mudo ? 'Silenciado' : 'Micro'}</small>
        </button>
        <button className="llamada-boton" onClick={interrumpir} disabled={estado === 'escuchando'} title="Cortarle para preguntar (espacio)">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L4 15.5a1.6 1.6 0 0 1 2.3-2.2L8 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <small>Una duda</small>
        </button>
        <button className="llamada-boton colgar" onClick={colgar} title="Colgar">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
            <path d="M3 14.5c5-4.5 13-4.5 18 0l-2.2 2.6-3.6-1.4v-2.4a12 12 0 0 0-6.4 0v2.4l-3.6 1.4z" fill="currentColor" />
          </svg>
          <small>Colgar</small>
        </button>
      </div>
      {error && <p role="alert" className="nota">{error}</p>}
      {turnos.length > 0 && (
        <details className="llamada-transcripcion">
          <summary>Lo que lleváis dicho</summary>
          {turnos
            .filter((t) => t.texto)
            .map((t, i) => (
              <p key={i} className={t.rol}>
                <strong>{t.rol === 'tu' ? 'Tú' : 'Tutor'}:</strong> {paraLeer(t.texto)}
              </p>
            ))}
        </details>
      )}
    </div>
  )
}
