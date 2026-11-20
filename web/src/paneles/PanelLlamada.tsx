import { useCallback, useEffect, useRef, useState } from 'react'
import { crearConversacion, enviar, enviarJson, listarPlanes, pedir, verPlan, type ExtraMensaje, type VistaPlan } from '../api.ts'
import { planActivo } from '../componentes/planActivo.ts'
import { esEco, frases, guardarAjustesVoz, leerAjustesVoz, Locutor, nombreVozActual, Oido, paraLeer, VELOCIDADES } from '../componentes/voz.ts'
import { conPreguntas, narrarApuntes, type FraseClase } from '../componentes/narracion.ts'
import { todosLosModos, usarPreferencias } from '../componentes/preferencias.ts'
import Mascota from '../Mascota.tsx'
import ControlVoz from '../componentes/ControlVoz.tsx'
import Cargando, { mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import Diagrama from '../componentes/Diagrama.tsx'
import MapaConceptos, { type Mapa } from '../componentes/MapaConceptos.tsx'
import { TextoLibro } from '../componentes/LectorLibro.tsx'
import { escenas } from './PanelVideo.tsx'
import { idiomaActual, t } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'

// La llamada: hablas con tu tutor como por teléfono, sin pulsar nada.
// - Clase: te explica una lección en voz (con su guion o sus apuntes); le interrumpes cuando quieras, contesta tu duda
//   y sigue por donde iba.
// - Examen oral: el banco de preguntas en tres bloques, una a una.
// - Entrevista: te hace preguntas de entrevista técnica, te puntúa cada respuesta y, al colgar, te da la nota.
// - Charla: hablas de lo que quieras, con el modo de aprendizaje que elijas.
// Habla frase a frase según le llega la respuesta, te escucha todo el rato y distingue tu voz de la suya.
// Mientras habla, la pizarra enseña lo que explica (el diagrama del apartado, el que dibuja el tutor o un trozo de tus
// apuntes) y las notas recogen los conceptos que salen, con su definición.

type Tipo = 'clase' | 'oral' | 'entrevista' | 'charla'
type Estado = 'conectando' | 'escuchando' | 'pensando' | 'hablando' | 'narrando'
interface Turno {
  rol: 'tu' | 'tutor'
  texto: string
}
interface Nota {
  termino: string
  definicion: string
}
type Pizarra =
  | { tipo: 'svg'; svg: string; completo: boolean; titulo: string }
  | { tipo: 'ficha'; texto: string; titulo: string }
  | { tipo: 'mapa'; mapa: Mapa; titulo: string }
interface DatosLeccion {
  mid: number
  bloques: { clave: string; titulo: string; texto: string; pregunta?: { enunciado: string } | null }[]
  definiciones: { termino: string; ingles?: string; definicion: string }[]
}
// El registro de la llamada: qué pasó y cuándo (ms desde que empezó), para ver dónde se puso rara.
interface EventoRegistro {
  t: number
  e: string
  d?: Record<string, unknown>
}
const corto = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n)}…` : t)
const SALTAR_PREGUNTA = /^(paso|s[aá]ltala|siguiente|otra|no quiero|mejor sigue|pass|skip( it)?|next|another( one)?|i don'?t want to|just (go on|continue|carry on))\b/i

// «Sí», «vale», «sigue»... como respuesta entera: «sí, sigue» es seguir; «sí, pero no entiendo X» es una duda.
const SIGUE = /^(s[ií]|sigue|seguimos|sigamos|vale|venga|adelante|ok|okey|dale|perfecto|contin[uú]a|entendido|ya est[aá]|yes|yeah|yep|go on|go ahead|continue|carry on|keep going|sure|alright|got it|understood|next)(?=[\s,.!]|$)/i
const DUDA = /\b(pero|no|por qu[eé]|porque|c[oó]mo|qu[eé]|cu[aá]l|otro|otra|repite|espera|antes|but|why|how|what|which|another|repeat|wait|before)\b/i
export function esSeguir(texto: string): boolean {
  const x = texto.trim().toLowerCase()
  if (/[¿?]/.test(x)) return false
  const m = x.match(SIGUE)
  if (!m) return false
  const resto = x.slice(m[0].length).replace(/[\s,.!]+/g, ' ').trim()
  if (!resto) return true
  return resto.split(' ').length <= 3 && !DUDA.test(resto) && SIGUE.test(resto)
}
const REPITE = /^(rep[ií]te(lo|me)?|otra vez|qu[eé] has dicho|no te he o[ií]do|no te oigo|perd[oó]n,? qu[eé]|repeat( that| it)?|say that again|again|what did you say|i can'?t hear you|sorry,? what|pardon)\b/i
const DESPACIO = /\b(m[aá]s despacio|m[aá]s lento|habla m[aá]s despacio|ve m[aá]s despacio|slower|more slowly|slow down|speak slower)\b/i
const DEPRISA = /\b(m[aá]s r[aá]pido|m[aá]s deprisa|ve m[aá]s r[aá]pido|faster|more quickly|speed up|speak faster)\b/i
const rellenos = () => [t('llamada.relleno1'), t('llamada.relleno2'), t('llamada.relleno3'), t('llamada.relleno4')]
const ESPERA_RELLENO = 4500 // el primer trozo del modelo suele llegar a los 3 o 4 s: antes, el relleno sobra
const ESPERA_SEGUNDO = 12000
const VENTANA_ECO = 3000 // Chrome entrega el eco de la última frase hasta 3 s después de que calle
const marcaDe = (m: string): string =>
  (['intuicion', 'choque', 'nombre', 'teoria'].includes(m) ? t(`llamada.marca.${m}` as 'llamada.marca.teoria') : null) ?? t('llamada.marca.parte', { titulo: m })

// Las reglas del examen oral (del prompt del vídeo, parte VIII), con el banco delante.
function contextoOral(b: { panoramica: string[]; secciones: string[]; profundizacion: string[] }): string {
  const lista = (titulo: string, xs: string[]) => `${titulo}:\n${xs.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
  return (
    t('llamada.ctx.oral') +
    '\n\n' +
    [lista(t('llamada.ctx.bloque1'), b.panoramica), lista(t('llamada.ctx.bloque2'), b.secciones), lista(t('llamada.ctx.bloque3'), b.profundizacion)].join('\n\n')
  )
}

function contextoEntrevista(clave: string, titulo: string): string {
  return (
    (clave
      ? t('llamada.ctx.entrevistaLeccion', { clave, titulo })
      : t('llamada.ctx.entrevistaPlan')) + t('llamada.ctx.entrevistaReglas')
  )
}

// Las notas de 0 a 10 que ha dado el entrevistador («un 7 sobre 10», «un 6,5 de 10»), para la media final.
function notasDichas(turnos: Turno[]): number[] {
  const salida: number[] = []
  for (const t of turnos) {
    if (t.rol !== 'tutor') continue
    const m = t.texto.match(/\b(\d{1,2}(?:[.,]\d)?)\s*(?:sobre|de|out of)\s*(?:10|diez|ten)\b/i)
    const n = m ? Number(m[1].replace(',', '.')) : NaN
    if (n >= 0 && n <= 10) salida.push(n)
  }
  return salida
}

// Los bloques del tutor que no se oyen: ```svg va a la pizarra, ```ficha b3 enseña ese apartado y ```concepto,
// a las notas («Término: definición» por línea).
function bloquesDelTutor(t: string) {
  const svgs = [...t.matchAll(/```svg[^\n]*\n([\s\S]*?)(```|$)/g)]
  const ultimo = svgs[svgs.length - 1]
  const fichas = [...t.matchAll(/```ficha\s*\n?\s*(b\d+)\s*\n?```/g)]
  const conceptos: Nota[] = []
  for (const m of t.matchAll(/```concepto[^\n]*\n([\s\S]*?)```/g)) {
    for (const linea of m[1].split('\n')) {
      const x = linea.replace(/^[-*\s]+/, '').match(/^\*{0,2}([^:]{2,60}?)\*{0,2}\s*:\s*(.{3,})$/)
      if (x) conceptos.push({ termino: x[1].trim(), definicion: x[2].trim() })
    }
  }
  return {
    svg: ultimo ? { codigo: ultimo[1], completo: ultimo[2] === '```' } : null,
    ficha: fichas.length ? fichas[fichas.length - 1][1] : null,
    conceptos,
  }
}

const normalizar = (t: string) =>
  ` ${t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')} `

const reloj = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function PanelLlamada({ alCambiar }: { alCambiar?: () => void }) {
  usarIdioma() // los textos siguen al idioma
  const prefs = usarPreferencias()
  const [plan, setPlan] = useState<VistaPlan | null>(null)
  const [preparadas, setPreparadas] = useState<Record<string, { apuntes?: number; guion?: number }>>({})
  const ruta = window.location.hash.replace(/^#\/?/, '').split('/')
  const [tipo, setTipo] = useState<Tipo>(ruta[1] === 'entrevista' ? 'entrevista' : ruta[1] === 'charla' ? 'charla' : ruta[1] === 'oral' ? 'oral' : 'clase')
  // Examen oral: banco de preguntas en tres bloques (panorámica, sección a sección, profundización).
  const [banco, setBanco] = useState<{ panoramica: string[]; secciones: string[]; profundizacion: string[] } | null>(null)
  const bancoRef = useRef<typeof banco>(null)
  const [clave, setClave] = useState<string>(ruta[2] ?? '')
  const [modo, setModo] = useState<string>('')
  const [noCuenta, setNoCuenta] = useState(false)

  const [fase, setFase] = useState<'preparar' | 'llamada' | 'colgada'>('preparar')
  const [estado, setEstadoVista] = useState<Estado>('conectando')
  const [subtitulo, setSubtitulo] = useState('')
  const [parcial, setParcial] = useState('')
  const [turnos, setTurnos] = useState<Turno[]>([])
  const turnosRef = useRef<Turno[]>([])
  const [segundos, setSegundos] = useState(0)
  const [mudo, setMudo] = useState(false)
  const [escrito, setEscrito] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resumen, setResumen] = useState<string | null>(null)
  const [cerrando, setCerrando] = useState(false)
  const [pizarra, setPizarra] = useState<Pizarra | null>(null)
  const [notas, setNotas] = useState<Nota[]>([])
  const [notasGuardadas, setNotasGuardadas] = useState<'no' | 'guardando' | 'si' | 'error'>('no')

  const estadoRef = useRef<Estado>('conectando')
  const cid = useRef<number | null>(null)
  const locutor = useRef(new Locutor())
  const oido = useRef(new Oido())
  const control = useRef<AbortController | null>(null)
  const narracion = useRef<{ lista: FraseClase[]; pos: number; activa: boolean; acabada: boolean; gen: number }>({ lista: [], pos: 0, activa: false, acabada: false, gen: 0 })
  const esperandoSeguir = useRef(false)
  const buffer = useRef('')
  const temporizador = useRef(0)
  const silencio = useRef(0)
  const ultimaPregunta = useRef('')
  const ultimoVisible = useRef(true)
  const finHabla = useRef(0)
  const vivo = useRef(false)
  const datos = useRef({ tipo, clave, modo, noCuenta, titulo: '' })
  const leccionRef = useRef<DatosLeccion | null>(null)
  const mapaRef = useRef<Mapa | null>(null)
  const diagramas = useRef(new Map<string, Promise<string | null>>())
  const bloqueEnPizarra = useRef<string | null>(null)
  const notasRef = useRef<Nota[]>([])
  const preguntaPendiente = useRef<{ enunciado: string; bloque?: string } | null>(null)
  // La pregunta de la clase que estás contestando mientras piensa: si sigues hablando, lo que se junta sigue siendo respuesta.
  const preguntaEnCurso = useRef<{ enunciado: string; bloque?: string } | null>(null)
  // Lo que decía cuando le cortaste (para que sepa qué has oído y qué no).
  const cortadoEn = useRef('')
  const registro = useRef<{ t0: number; eventos: EventoRegistro[]; enviado: boolean }>({ t0: Date.now(), eventos: [], enviado: true })

  const apuntar = useCallback((e: string, d?: Record<string, unknown>) => {
    const r = registro.current
    if (r.enviado || r.eventos.length >= 5000) return
    r.eventos.push({ t: Date.now() - r.t0, e, ...(d ? { d } : {}) })
  }, [])

  const setEstado = (e: Estado) => {
    if (estadoRef.current !== e) apuntar('estado', { de: estadoRef.current, a: e })
    estadoRef.current = e
    setEstadoVista(e)
  }
  const ponerTurnos = (f: (t: Turno[]) => Turno[]) => {
    turnosRef.current = f(turnosRef.current)
    setTurnos(turnosRef.current)
  }

  // Lo que hay para elegir: lecciones con apuntes (y guion, si lo tienen).
  // Si falla, se dice y se puede reintentar (si no, parecería que no tienes ninguna lección preparada).
  const [falloLecciones, setFalloLecciones] = useState<string | null>(null)
  const cargarLecciones = useCallback(() => {
    setFalloLecciones(null)
    listarPlanes()
      .then(async (ps) => {
        const activo = planActivo(ps)
        if (!activo) return
        const v = await verPlan(activo.tema_id)
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
      .catch((e) => setFalloLecciones(mensajeDe(e)))
  }, [])
  useEffect(cargarLecciones, [cargarLecciones])

  useEffect(() => {
    if (fase !== 'llamada') return
    const t = window.setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [fase])

  // Al terminar (colgar o salir de la pantalla), el registro va al servidor con un resumen de lo que pasó.
  const enviarRegistro = useCallback((alSalir = false) => {
    const r = registro.current
    if (r.enviado) return
    r.enviado = true
    const ev = r.eventos
    const cuantos = (e: string, f?: (x: EventoRegistro) => boolean) => ev.filter((x) => x.e === e && (!f || f(x))).length
    const primeras = ev.filter((x) => x.e === 'primera-frase').map((x) => Number(x.d?.ms ?? 0))
    const orden = [...primeras].sort((a, b) => a - b)
    const resumen = {
      turnos: cuantos('turno'),
      interrupciones: cuantos('interrumpir'),
      ecos_descartados: cuantos('eco'),
      sies_ignorados: cuantos('sigue-ignorado'),
      rellenos: cuantos('relleno'),
      errores: cuantos('error'),
      silencios: cuantos('silencio'),
      preguntas: cuantos('pregunta'),
      respondidas: cuantos('entregar', (x) => x.d?.como === 'respuesta'),
      primera_frase_ms_mediana: orden.length ? orden[Math.floor(orden.length / 2)] : null,
      primera_frase_ms_max: orden.length ? orden[orden.length - 1] : null,
    }
    const cuerpo = JSON.stringify({
      conversacion_id: cid.current,
      tipo: datos.current.tipo,
      leccion: datos.current.clave || null,
      segundos: Math.round((Date.now() - r.t0) / 1000),
      voz: nombreVozActual(),
      resumen,
      eventos: ev,
    })
    if (alSalir && navigator.sendBeacon) navigator.sendBeacon('/api/llamadas/registro', new Blob([cuerpo], { type: 'application/json' }))
    else void fetch('/api/llamadas/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo, keepalive: true }).catch(() => undefined)
  }, [])

  // Al salir de la pantalla, se cuelga.
  useEffect(
    () => () => {
      if (vivo.current) enviarRegistro(true)
      vivo.current = false
      oido.current.parar()
      locutor.current.parar()
      control.current?.abort()
      window.clearTimeout(temporizador.current)
      window.clearTimeout(silencio.current)
    },
    [],
  )

  const leccion = plan?.lecciones.find((l) => l.clave === clave)

  // ---- Notas y pizarra ----
  const anotar = useCallback((nuevas: Nota[]) => {
    const faltan = nuevas.filter((n) => n.termino && !notasRef.current.some((x) => x.termino.toLowerCase() === n.termino.toLowerCase()))
    if (!faltan.length) return
    notasRef.current = [...notasRef.current, ...faltan]
    setNotas(notasRef.current)
  }, [])

  // Si lo que se oye nombra un término del glosario de la lección, a las notas con su definición.
  const anotarTerminos = useCallback(
    (texto: string) => {
      const defs = leccionRef.current?.definiciones ?? []
      if (!defs.length) return
      const dicho = normalizar(texto)
      anotar(defs.filter((d) => [d.termino, d.ingles].some((t) => t && t.length > 2 && dicho.includes(normalizar(t)))).map((d) => ({ termino: d.termino, definicion: d.definicion })))
    },
    [anotar],
  )

  const diagramaDe = useCallback((claveBloque: string) => {
    const l = leccionRef.current
    if (!l) return Promise.resolve(null)
    let p = diagramas.current.get(claveBloque)
    if (!p) {
      p = pedir<{ svg: string | null }>(`/api/estudio/${l.mid}/diagrama/${claveBloque}`)
        .then((r) => r.svg)
        .catch(() => {
          // No se guarda el fallo: la próxima vez que entres en el apartado se vuelve a pedir.
          diagramas.current.delete(claveBloque)
          return null
        })
      diagramas.current.set(claveBloque, p)
    }
    return p
  }, [])

  // Al entrar en un apartado: su diagrama en la pizarra (o el apartado de la ficha si no tiene) y se prepara el siguiente.
  const pizarraDeBloque = useCallback(
    async (claveBloque: string, siguiente?: string) => {
      const l = leccionRef.current
      const b = l?.bloques.find((x) => x.clave === claveBloque)
      if (!l || !b || bloqueEnPizarra.current === claveBloque) return
      bloqueEnPizarra.current = claveBloque
      if (siguiente) void diagramaDe(siguiente)
      setPizarra({ tipo: 'ficha', texto: b.texto, titulo: b.titulo })
      const t = Date.now()
      const svg = await diagramaDe(claveBloque)
      apuntar('diagrama', { bloque: claveBloque, hay: !!svg, espera_ms: Date.now() - t })
      if (svg && bloqueEnPizarra.current === claveBloque && vivo.current) setPizarra({ tipo: 'svg', svg, completo: true, titulo: b.titulo })
    },
    [diagramaDe, apuntar],
  )

  const fichaEnPizarra = useCallback((claveBloque: string) => {
    const b = leccionRef.current?.bloques.find((x) => x.clave === claveBloque)
    if (!b) return
    bloqueEnPizarra.current = claveBloque
    setPizarra({ tipo: 'ficha', texto: b.texto, titulo: b.titulo })
  }, [])

  // ---- Silencio: si le cortaste (o te preguntó) y no dices nada, te lo recuerda una vez ----
  const vigilarSilencio = useCallback(
    (frase = t('llamada.sigoClase'), ms = 8000) => {
      window.clearTimeout(silencio.current)
      silencio.current = window.setTimeout(() => {
        if (!vivo.current || estadoRef.current !== 'escuchando' || buffer.current) return
        if (!esperandoSeguir.current && !preguntaPendiente.current) return
        apuntar('silencio', { frase })
        const l = locutor.current
        l.nueva()
        l.alFrase = (f) => setSubtitulo(f)
        l.decir(frase)
        l.cerrar()
        void l.terminado().then(() => (finHabla.current = Date.now()))
      }, ms)
    },
    [apuntar],
  )

  // ---- El tutor habla ----
  const interrumpir = useCallback(
    (motivo: string = 'voz') => {
      apuntar('interrumpir', { motivo, estado: estadoRef.current })
      if (narracion.current.activa) {
        narracion.current.activa = false
        esperandoSeguir.current = true
      } else if (estadoRef.current === 'hablando' && locutor.current.ocupado()) cortadoEn.current = locutor.current.reciente
      control.current?.abort()
      locutor.current.parar()
      setEstado('escuchando')
      if (esperandoSeguir.current) vigilarSilencio()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vigilarSilencio, apuntar],
  )

  const narrar = useCallback(async () => {
    const n = narracion.current
    if (!vivo.current) return
    const gen = ++n.gen
    n.activa = true
    esperandoSeguir.current = false
    preguntaPendiente.current = null
    window.clearTimeout(silencio.current)
    setSubtitulo('')
    setEstado('narrando')
    const l = locutor.current
    l.nueva()
    const desde = n.pos
    // Se narra hasta la próxima pregunta (incluida): ahí la clase se para y espera tu respuesta.
    const parada = n.lista.findIndex((x, i) => i >= desde && !!x.pregunta)
    const hasta = parada === -1 ? n.lista.length - 1 : parada
    apuntar('narrar', { desde, hasta, total: n.lista.length })
    let k = desde - 1
    l.alFrase = (f) => {
      // La posición avanza con lo que de verdad suena: si le interrumpes, retoma esa misma frase.
      k = Math.min(k + 1, n.lista.length - 1)
      n.pos = k
      setSubtitulo(f)
      anotarTerminos(f)
      const x = n.lista[k]
      if (x?.pregunta) {
        // La pregunta, también escrita: por voz sola cuesta retenerla.
        bloqueEnPizarra.current = null
        setPizarra({ tipo: 'ficha', texto: `**${x.pregunta}**`, titulo: t('llamada.tePregunta') })
        apuntar('pregunta', { bloque: x.bloque, texto: corto(x.pregunta) })
      } else if (x?.marca === t('llamada.marca.mapa') && mapaRef.current) {
        bloqueEnPizarra.current = null
        setPizarra({ tipo: 'mapa', mapa: mapaRef.current, titulo: t('llamada.mapaLeccion') })
      } else if (x?.bloque) {
        const siguiente = n.lista.slice(k + 1).find((y) => y.bloque && y.bloque !== x.bloque)?.bloque
        void pizarraDeBloque(x.bloque, siguiente)
      }
    }
    for (const x of n.lista.slice(desde, hasta + 1)) l.decir(x.texto)
    l.cerrar()
    await l.terminado()
    if (!vivo.current || !n.activa || gen !== n.gen) return
    const enPregunta = n.lista[hasta]
    if (enPregunta?.pregunta && hasta >= desde) {
      n.activa = false
      n.pos = hasta + 1
      preguntaPendiente.current = { enunciado: enPregunta.pregunta, bloque: enPregunta.bloque }
      finHabla.current = Date.now()
      setEstado('escuchando')
      vigilarSilencio(t('llamada.tomateTiempo'), 15000)
      return
    }
    n.activa = false
    n.acabada = true
    n.pos = n.lista.length
    finHabla.current = Date.now()
    l.nueva()
    l.alFrase = (f) => setSubtitulo(f)
    l.decir(t('llamada.finClase'))
    l.cerrar()
    await l.terminado()
    if (gen !== n.gen) return
    finHabla.current = Date.now()
    if (vivo.current) setEstado('escuchando')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anotarTerminos, pizarraDeBloque, apuntar, vigilarSilencio])

  // Dice un texto suelto (repetir, avisos) y vuelve a escuchar.
  const decirSuelto = useCallback(async (texto: string) => {
    const l = locutor.current
    l.nueva()
    l.alFrase = (f) => setSubtitulo(f)
    setEstado('hablando')
    for (const f of frases(paraLeer(texto))) l.decir(f)
    l.cerrar()
    await l.terminado()
    finHabla.current = Date.now()
    if (vivo.current && estadoRef.current === 'hablando') setEstado('escuchando')
  }, [])

  const turno = useCallback(
    async (texto: string, contexto?: string, visible = true, respuesta = false) => {
      if (!vivo.current || cid.current == null) return
      ultimaPregunta.current = texto
      ultimoVisible.current = visible
      window.clearTimeout(silencio.current)
      if (visible) ponerTurnos((t) => [...t, { rol: 'tu', texto }])
      ponerTurnos((t) => [...t, { rol: 'tutor', texto: '' }])
      setEstado('pensando')
      const t0 = Date.now()
      apuntar('turno', { texto: corto(texto), visible, con_contexto: !!contexto, corrige: respuesta || ((datos.current.tipo === 'oral' || datos.current.tipo === 'entrevista') && visible) })
      let sonando = false
      const l = locutor.current
      l.nueva()
      l.alFrase = (f) => {
        setSubtitulo(f)
        const relleno = rellenos().includes(f) || f === t('llamada.sigoConEllo')
        if (relleno) apuntar('relleno', { texto: f, ms: Date.now() - t0 })
        else if (!sonando) {
          sonando = true
          apuntar('primera-frase', { ms: Date.now() - t0 })
        }
        // Un relleno («A ver.») no cuenta como empezar a hablar: si hablas encima, se junta con tu pregunta.
        if (estadoRef.current === 'pensando' && !relleno) setEstado('hablando')
      }
      const d = datos.current
      const extra: ExtraMensaje = {
        llamada: true,
        modo: d.tipo === 'entrevista' ? 'entrevista' : d.tipo === 'clase' || d.tipo === 'oral' ? 'normal' : d.modo || null,
        plan_id: d.clave && plan ? plan.plan_id : null,
        leccion_clave: d.tipo !== 'charla' && d.clave ? d.clave : null,
        // Juzgar una respuesta (examen oral, entrevista o la pregunta de la clase) va al modelo grande; lo demás, al rápido.
        corregir: respuesta || ((d.tipo === 'oral' || d.tipo === 'entrevista') && visible),
        contexto:
          [
            contexto,
            d.tipo === 'oral' && bancoRef.current ? contextoOral(bancoRef.current) : null,
            d.tipo === 'entrevista' ? contextoEntrevista(d.clave, d.titulo) : null,
            leccionRef.current?.bloques.length
              ? t('llamada.ctx.apartados', { lista: leccionRef.current.bloques.map((b) => `${b.clave} «${b.titulo}»`).join(', ') })
              : null,
          ]
            .filter(Boolean)
            .join('\n\n') || null,
      }
      // Si tarda en arrancar, una palabra para que se note que te ha oído; y otra si tarda mucho.
      let algo = false
      const relleno = window.setTimeout(() => {
        if (visible && !algo && estadoRef.current === 'pensando') l.decir(rellenos()[Math.floor(Math.random() * rellenos().length)])
      }, ESPERA_RELLENO)
      const segundo = window.setTimeout(() => {
        if (!algo && estadoRef.current === 'pensando') l.decir(t('llamada.sigoConEllo'))
      }, ESPERA_SEGUNDO)
      control.current = new AbortController()
      let acumulado = ''
      let svgVisto = ''
      let fichaVista = ''
      try {
        for await (const ev of enviar(cid.current, texto, control.current.signal, !d.noCuenta, true, extra)) {
          if (ev.tipo === 'delta') {
            if (!acumulado) apuntar('primer-trozo', { ms: Date.now() - t0 })
            acumulado += ev.t
            if (frases(paraLeer(acumulado)).length >= 1) algo = true
            l.empujar(acumulado)
            ponerTurnos((t) => [...t.slice(0, -1), { rol: 'tutor', texto: acumulado }])
            const b = bloquesDelTutor(acumulado)
            if (b.svg && (b.svg.codigo !== svgVisto || b.svg.completo)) {
              svgVisto = b.svg.codigo
              bloqueEnPizarra.current = null
              setPizarra({ tipo: 'svg', svg: b.svg.codigo, completo: b.svg.completo, titulo: t('llamada.loDibuja') })
            }
            if (b.ficha && b.ficha !== fichaVista) {
              fichaVista = b.ficha
              fichaEnPizarra(b.ficha)
            }
            if (b.conceptos.length) anotar(b.conceptos)
          } else if (ev.tipo === 'error') throw new Error(ev.detalle)
        }
        window.clearTimeout(relleno)
        window.clearTimeout(segundo)
        l.empujar(acumulado, true)
        anotarTerminos(paraLeer(acumulado))
        const b = bloquesDelTutor(acumulado)
        apuntar('respuesta', {
          ms: Date.now() - t0,
          palabras: paraLeer(acumulado).split(/\s+/).filter(Boolean).length,
          dibujo: !!b.svg,
          ficha: b.ficha,
          conceptos: b.conceptos.length,
          texto: corto(paraLeer(acumulado), 300),
        })
        await l.terminado()
        finHabla.current = Date.now()
        if (vivo.current && (estadoRef.current === 'hablando' || estadoRef.current === 'pensando')) {
          setEstado('escuchando')
          // En la clase, tras contestar la duda, espera tu «sí» para seguir.
          if (d.tipo === 'clase' && !narracion.current.acabada && narracion.current.lista.length) {
            esperandoSeguir.current = true
            vigilarSilencio()
          }
        }
      } catch (e) {
        window.clearTimeout(relleno)
        window.clearTimeout(segundo)
        if (e instanceof DOMException && e.name === 'AbortError') apuntar('cortado', { ms: Date.now() - t0, llevaba: acumulado.length })
        else {
          apuntar('error', { ms: Date.now() - t0, detalle: corto(String((e as Error).message)) })
          // Se dice en voz (por teléfono no se mira la pantalla) y el turno vacío no se queda en la transcripción.
          ponerTurnos((t) => (t.length && t[t.length - 1].rol === 'tutor' && !t[t.length - 1].texto ? t.slice(0, -1) : t))
          setError(t('llamada.errorContestar'))
          if (vivo.current) await decirSuelto(t('llamada.perdona'))
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, anotar, anotarTerminos, fichaEnPizarra, vigilarSilencio, decirSuelto, apuntar],
  )

  // ---- Lo que dices ----
  const entregar = useCallback(
    (texto: string) => {
      texto = texto.trim()
      if (!texto || !vivo.current) return
      setParcial('')
      setError(null)
      window.clearTimeout(silencio.current)
      const cortado = cortadoEn.current
      cortadoEn.current = ''
      const n = narracion.current
      const enClase = datos.current.tipo === 'clase' && n.lista.length > 0 && !n.acabada
      const pregunta = enClase ? preguntaPendiente.current : null
      const corta = texto.split(/\s+/).length <= 6
      const como = (c: string) => apuntar('entregar', { texto: corto(texto), como: c })
      // La velocidad la pone la voz, no el modelo: «más despacio» baja un paso y sigue.
      const cambio = DESPACIO.test(texto) ? -1 : DEPRISA.test(texto) ? 1 : 0
      if (cambio && corta) {
        como('velocidad')
        const a = leerAjustesVoz()
        const i = Math.max(0, Math.min(VELOCIDADES.length - 1, VELOCIDADES.indexOf(a.velocidad) + cambio))
        guardarAjustesVoz({ ...a, velocidad: VELOCIDADES[i] })
        ponerTurnos((t) => [...t, { rol: 'tu', texto }])
        if (enClase && !pregunta) narrar()
        else void decirSuelto(cambio < 0 ? t('llamada.masDespacio') : t('llamada.masRapido'))
        return
      }
      // «Repite»: la pregunta que te ha hecho; en la clase, la frase en la que ibas; si no, su última respuesta tal cual.
      if (REPITE.test(texto) && corta) {
        como('repite')
        ponerTurnos((t) => [...t, { rol: 'tu', texto }])
        const ultima = [...turnosRef.current].reverse().find((t) => t.rol === 'tutor' && t.texto)
        if (pregunta) void decirSuelto(pregunta.enunciado)
        else if (enClase && (esperandoSeguir.current || !ultima)) narrar()
        else if (ultima) void decirSuelto(ultima.texto)
        return
      }
      if (enClase && (esSeguir(texto) || (pregunta && SALTAR_PREGUNTA.test(texto) && corta))) {
        como(pregunta ? 'salta-pregunta' : 'seguir')
        ponerTurnos((t) => [...t, { rol: 'tu', texto }])
        narrar()
        return
      }
      let contexto: string | undefined
      if (pregunta) {
        // Le respondes a la pregunta que te ha hecho: corrige corto, como un profesor, y sigue la clase.
        como('respuesta')
        preguntaPendiente.current = null
        contexto =
          t('llamada.ctx.claseRespuesta', { clave: datos.current.clave, titulo: datos.current.titulo, pregunta: pregunta.enunciado })
        esperandoSeguir.current = false
      } else if (enClase) {
        como('duda')
        const aqui = n.lista[Math.min(n.pos, n.lista.length - 1)]
        contexto =
          t('llamada.ctx.claseDuda', { clave: datos.current.clave, titulo: datos.current.titulo, marca: aqui.marca, texto: aqui.texto })
        esperandoSeguir.current = false
      } else {
        como('turno')
        if (cortado) contexto = t('llamada.ctx.cortado', { texto: cortado })
      }
      preguntaEnCurso.current = pregunta
      turno(texto, contexto, true, !!pregunta)
    },
    [narrar, turno, decirSuelto, apuntar],
  )

  const acumular = useCallback(
    (t: string) => {
      buffer.current = `${buffer.current} ${t}`.trim()
      window.clearTimeout(temporizador.current)
      window.clearTimeout(silencio.current)
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
        // Le cortas en cuanto se oyen unas palabras tuyas que no son su propia voz (un «sí, sí» no le corta).
        if (t.split(/\s+/).length >= 3 && !esEco(t, l.reciente) && !esSeguir(t)) {
          interrumpir('voz')
          setParcial(t)
        }
        return
      }
      if (Date.now() - finHabla.current < VENTANA_ECO && esEco(t, l.reciente)) return
      setParcial(t)
    }
    o.alFinal = (t) => {
      if (!t) return
      const e = estadoRef.current
      apuntar('oido', { texto: corto(t), estado: e })
      if (e === 'hablando' || e === 'narrando') {
        if (esEco(t, l.reciente)) return apuntar('eco', { texto: corto(t), dicho: corto(l.reciente, 200) })
        if (esSeguir(t)) return apuntar('sigue-ignorado', { texto: t })
        interrumpir('voz')
        acumular(t)
      } else if (e === 'pensando') {
        // Sigues hablando mientras piensa: se junta con lo anterior (una sola vez) y se vuelve a preguntar.
        apuntar('junta', { texto: corto(t) })
        control.current?.abort()
        ponerTurnos((x) => (x.length && x[x.length - 1].rol === 'tutor' ? x.slice(0, ultimoVisible.current ? -2 : -1) : x))
        // Si estabas contestando su pregunta, lo que se junta sigue siendo tu respuesta (y se corrige).
        if (preguntaEnCurso.current) preguntaPendiente.current = preguntaEnCurso.current
        acumular(buffer.current ? t : `${ultimaPregunta.current} ${t}`)
      } else {
        if (Date.now() - finHabla.current < VENTANA_ECO && esEco(t, l.reciente)) return apuntar('eco', { texto: corto(t), tras_hablar: true })
        acumular(t)
      }
    }
    o.alError = (err) => {
      apuntar('error-oido', { detalle: err })
      setError(err)
    }
    // El oído se ha rendido (sin permiso, sin micro o fallos seguidos): micro silenciado y la caja para escribir.
    // Pulsar el micro vuelve a intentarlo.
    o.alBloqueo = (err) => {
      apuntar('error-oido', { detalle: err, bloqueo: true })
      setMudo(true)
      setError(err)
    }
  }, [acumular, interrumpir, apuntar])

  // ---- Llamar y colgar ----
  const llamar = async () => {
    setError(null)
    setResumen(null)
    setTurnos([])
    turnosRef.current = []
    setSegundos(0)
    setPizarra(null)
    setNotas([])
    notasRef.current = []
    setNotasGuardadas('no')
    bloqueEnPizarra.current = null
    diagramas.current = new Map()
    leccionRef.current = null
    mapaRef.current = null
    buffer.current = ''
    setFase('llamada')
    setEstado('conectando')
    vivo.current = true
    datos.current = { tipo, clave, modo, noCuenta, titulo: leccion?.titulo ?? '' }
    narracion.current = { lista: [], pos: 0, activa: false, acabada: false, gen: narracion.current.gen + 1 }
    esperandoSeguir.current = false
    preguntaPendiente.current = null
    preguntaEnCurso.current = null
    cortadoEn.current = ''
    registro.current = { t0: Date.now(), eventos: [], enviado: false }
    apuntar('llamar', { tipo, leccion: clave || null, voz: nombreVozActual(), velocidad: leerAjustesVoz().velocidad, micro: !mudo, dictado: oido.current.disponible() })
    try {
      const titulo =
        tipo === 'oral'
          ? t('llamada.conv.oral', { clave })
          : tipo === 'clase'
            ? t('llamada.conv.clase', { clave })
            : tipo === 'entrevista'
              ? clave
                ? t('llamada.conv.entrevistaDe', { clave })
                : t('llamada.conv.entrevista')
              : t('llamada.conv.charla')
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
    const p = preparadas[clave]
    // La lección (apartados y glosario) para la pizarra y las notas.
    if (tipo !== 'charla' && p?.apuntes) {
      const mid = p.apuntes
      const [lec, mapa] = await Promise.all([
        pedir<{ bloques: DatosLeccion['bloques']; definiciones: DatosLeccion['definiciones'] }>(`/api/tutor/leccion/${mid}`).catch(() => null),
        pedir<Mapa>(`/api/estudio/${mid}/mapa`).catch(() => null),
      ])
      if (lec) leccionRef.current = { mid, bloques: lec.bloques ?? [], definiciones: lec.definiciones ?? [] }
      if (mapa?.nodos.length) mapaRef.current = mapa
    }
    if (tipo === 'clase') {
      let lista: FraseClase[] = []
      try {
        if (p?.guion) {
          const g = await pedir<{ texto: string }>(`/api/materiales/${p.guion}`)
          for (const e of escenas(g.texto)) for (const f of e.frases) lista.push({ marca: marcaDe(e.marca), texto: paraLeer(f) })
          lista = [{ marca: t('llamada.marca.principio'), texto: t('llamada.hola', { clave, titulo: leccion?.titulo ?? '' }) }, ...lista]
        } else if (p?.apuntes) {
          const a = await pedir<{ texto: string; contrato?: { bloques?: { clave: string; titulo: string }[] } }>(`/api/materiales/${p.apuntes}`)
          lista = narrarApuntes(a.texto, a.contrato?.bloques ?? [], clave, leccion?.titulo ?? '')
          // De vez en cuando, la pregunta preparada de un apartado (la misma del modo foco).
          const preguntas: Record<string, string> = {}
          for (const b of leccionRef.current?.bloques ?? []) if (b.pregunta?.enunciado) preguntas[b.clave] = b.pregunta.enunciado
          lista = conPreguntas(lista, preguntas)
        }
      } catch (e) {
        setError(t('llamada.noPreparoClase', { motivo: (e as Error).message }))
        setEstado('escuchando')
        return
      }
      if (!lista.length) {
        setError(t('llamada.nadaQueContar'))
        setEstado('escuchando')
        return
      }
      narracion.current.lista = lista
      apuntar('clase', { frases: lista.length, preguntas: lista.filter((x) => x.pregunta).length, guion: !!p?.guion })
      // El diagrama del primer apartado tarda unos 20 s la primera vez: se pide ya, mientras suenan el saludo y el mapa.
      const primero = lista.find((x) => x.bloque)?.bloque
      if (primero) void diagramaDe(primero)
      narrar()
    } else if (tipo === 'oral') {
      setEstado('pensando')
      try {
        const b = await pedir<{ panoramica: string[]; secciones: string[]; profundizacion: string[] }>(`/api/estudio/${p?.apuntes}/oral`)
        bancoRef.current = b
        setBanco(b)
      } catch (e) {
        setError(t('llamada.noPreparoExamen', { motivo: (e as Error).message }))
        setEstado('escuchando')
        return
      }
      turno(t('llamada.listoDiscusion'), undefined, false)
    } else if (tipo === 'entrevista') {
      turno(t('llamada.empecemosEntrevista'), undefined, false)
    } else {
      l.nueva()
      l.alFrase = (f) => setSubtitulo(f)
      setEstado('hablando')
      l.decir(t('llamada.holaCharla'))
      l.cerrar()
      await l.terminado()
      finHabla.current = Date.now()
      if (vivo.current) setEstado('escuchando')
    }
  }

  const colgar = async () => {
    const habia = turnosRef.current.filter((t) => t.rol === 'tu').length
    vivo.current = false
    narracion.current.gen++
    oido.current.parar()
    locutor.current.parar()
    control.current?.abort()
    window.clearTimeout(temporizador.current)
    window.clearTimeout(silencio.current)
    buffer.current = ''
    setParcial('')
    setFase('colgada')
    apuntar('colgar', { notas: notasRef.current.length })
    enviarRegistro()
    // En la entrevista, la nota final (por escrito: ya has colgado). La media la calcula el código, no el modelo.
    if (datos.current.tipo === 'entrevista' && habia > 0 && cid.current != null) {
      setCerrando(true)
      const ns = notasDichas(turnosRef.current)
      const media = ns.length ? Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10 : null
      let texto = ''
      try {
        for await (const ev of enviar(
          cid.current,
          t('llamada.finPide'),
          new AbortController().signal,
          !datos.current.noCuenta,
          true,
          {
            llamada: true,
            modo: 'entrevista',
            plan_id: datos.current.clave && plan ? plan.plan_id : null,
            leccion_clave: datos.current.clave || null,
            contexto:
              t('llamada.ctx.fin') +
              (media != null ? t('llamada.ctx.finMedia', { media: idiomaActual() === 'en' ? String(media) : String(media).replace('.', ',') }) : t('llamada.ctx.finSinMedia')) +
              t('llamada.ctx.finResto'),
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

  const guardarNotas = async () => {
    if (!notasRef.current.length) return
    setNotasGuardadas('guardando')
    const cabeza =
      datos.current.tipo === 'clase'
        ? t('llamada.notas.clase', { clave: datos.current.clave })
        : datos.current.tipo === 'oral'
          ? t('llamada.notas.oral', { clave: datos.current.clave })
          : datos.current.tipo === 'entrevista'
            ? t('llamada.notas.entrevista')
            : t('llamada.notas.charla')
    const texto = `${t('llamada.notas.texto', { cabeza, titulo: datos.current.titulo ? ` «${datos.current.titulo}»` : '' })}\n\n${notasRef.current.map((n) => `- **${n.termino}**: ${n.definicion}`).join('\n')}`
    try {
      await pedir('/api/notas', enviarJson({ texto }))
      setNotasGuardadas('si')
    } catch {
      setNotasGuardadas('error')
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
        interrumpir('tecla')
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [fase, interrumpir])

  const listaNotas = notas.length > 0 && (
    <section className="llamada-notas" aria-label={t('llamada.notas.aria')}>
      <h2>{t('llamada.notas.titulo')}</h2>
      <dl>
        {notas.map((n) => (
          <div key={n.termino}>
            <dt>{n.termino}</dt>
            <dd>{n.definicion}</dd>
          </div>
        ))}
      </dl>
    </section>
  )

  // ---- Pantallas ----
  if (fase === 'preparar') {
    const sinOido = !oido.current.disponible()
    const modos = prefs ? todosLosModos(prefs) : []
    return (
      <div className="panel llamada-preparar">
        <h1>{t('llamada.charla')}</h1>
        <p className="nota">{t('llamada.intro')}</p>
        <div className="llamada-tipos" role="radiogroup" aria-label={t('llamada.tipoAria')}>
          {(
            [
              ['clase', t('llamada.tipo.clase'), t('llamada.tipo.clase.desc')],
              ['oral', t('llamada.tipo.oral'), t('llamada.tipo.oral.desc')],
              ['entrevista', t('llamada.tipo.entrevista'), t('llamada.tipo.entrevista.desc')],
              ['charla', t('llamada.tipo.charla'), t('llamada.tipo.charla.desc')],
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
            {t('llamada.leccion')}
            <select value={clave} onChange={(e) => setClave(e.target.value)}>
              {tipo === 'entrevista' && <option value="">{t('llamada.todoElPlan')}</option>}
              {plan?.lecciones
                .filter((l) => preparadas[l.clave])
                .map((l) => (
                  <option key={l.clave} value={l.clave}>
                    {l.clave} · {l.titulo}
                    {tipo === 'clase' ? (preparadas[l.clave].guion ? t('llamada.conGuion') : t('llamada.deApuntes')) : ''}
                  </option>
                ))}
            </select>
          </label>
        )}
        {tipo === 'charla' && (
          <label className="llamada-campo">
            {t('llamada.modo')}
            <select value={modo} onChange={(e) => setModo(e.target.value)}>
              <option value="">{t('llamada.modoSiempre')}</option>
              <option value="normal">{t('llamada.modoNormal')}</option>
              {modos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="llamada-ajustes">
          <ControlVoz />
          <label>
            <input type="checkbox" checked={noCuenta} onChange={(e) => setNoCuenta(e.target.checked)} />{' '}
            <span title={t('llamada.noCuentaAyuda')}>{t('llamada.noCuenta')}</span>
          </label>
        </div>
        <button className="boton boton-principal llamada-llamar" onClick={llamar} disabled={(tipo === 'clase' || tipo === 'oral') && !clave}>
          {t('llamada.llamar')}
        </button>
        {falloLecciones && <Cargando error={falloLecciones} reintentar={cargarLecciones} />}
        {tipo === 'clase' && !falloLecciones && !Object.keys(preparadas).length && <p className="nota">{t('llamada.prepararLeccion')}</p>}
        {sinOido && <p className="nota">{t('llamada.sinDictado')}</p>}
        <p className="nota llamada-aviso">
          {t('llamada.aviso')}
        </p>
        {error && <TextoError texto={error} />}
      </div>
    )
  }

  if (fase === 'colgada') {
    return (
      <div className="panel llamada-colgada">
        <Mascota />
        <h1>{t('llamada.terminada')}</h1>
        <p className="nota">
          {t('llamada.intervenciones', { reloj: reloj(segundos), n: turnos.filter((x) => x.rol === 'tu').length })}
        </p>
        {(cerrando || resumen) && (
          <section className="llamada-resumen">
            <h2>{t('llamada.valoracion')}</h2>
            <p>{resumen ? paraLeer(resumen) : t('llamada.preparandoNota')}</p>
          </section>
        )}
        {listaNotas}
        <div className="botones">
          <button className="boton boton-principal" onClick={() => setFase('preparar')}>
            {t('llamada.otra')}
          </button>
          {notas.length > 0 && (
            <button className="boton" onClick={guardarNotas} disabled={notasGuardadas === 'guardando' || notasGuardadas === 'si'}>
              {notasGuardadas === 'si' ? t('llamada.guardadas') : notasGuardadas === 'guardando' ? t('llamada.guardando') : t('llamada.guardar')}
            </button>
          )}
          {cid.current != null && (
            <a className="boton" href={`#/conversacion/${cid.current}`}>
              {t('llamada.verEscrita')}
            </a>
          )}
        </div>
        {notasGuardadas === 'error' && <p className="nota">{t('llamada.noGuardoNotas')}</p>}
      </div>
    )
  }

  const textoEstado = {
    conectando: t('llamada.estado.conectando'),
    escuchando: mudo ? t('llamada.estado.mudo') : t('llamada.estado.escuchando'),
    pensando: t('llamada.estado.pensando'),
    hablando: t('llamada.estado.hablando'),
    narrando: t('llamada.estado.narrando'),
  }[estado]
  const gesto = estado === 'pensando' ? 'pensando' : estado === 'escuchando' ? 'escuchando' : estado === 'hablando' || estado === 'narrando' ? 'hablando' : 'normal'
  const textoSubtitulo = estado === 'escuchando' || estado === 'pensando' ? '' : subtitulo

  return (
    <div className={`llamada en-${estado} ${pizarra ? 'con-pizarra' : ''}`}>
      <div className="llamada-cabeza">
        <span className="llamada-titulo">
          {tipo === 'oral'
            ? t('llamada.cabeza.oral', { clave })
            : tipo === 'clase'
              ? t('llamada.cabeza.clase', { clave })
              : tipo === 'entrevista'
                ? clave
                  ? t('llamada.cabeza.entrevistaDe', { clave })
                  : t('llamada.cabeza.entrevista')
                : t('llamada.charla')}
        </span>
        <span className="llamada-reloj">{reloj(segundos)}</span>
      </div>
      {pizarra ? (
        <>
          <div className="llamada-compacta">
            <div className="llamada-avatar">
              <span className="llamada-onda" aria-hidden />
              <Mascota gesto={gesto} lugar="llamada" />
            </div>
            <div className="llamada-compacta-texto">
              <p className="llamada-estado" aria-live="polite">
                {textoEstado}
              </p>
              <p className="llamada-subtitulo">{textoSubtitulo}</p>
            </div>
          </div>
          <section className="llamada-pizarra" aria-label={t('llamada.pizarra')}>
            <header className="llamada-pizarra-titulo">{pizarra.titulo}</header>
            {pizarra.tipo === 'svg' ? (
              <Diagrama key={pizarra.svg.slice(0, 80)} svg={pizarra.svg} completo={pizarra.completo} />
            ) : pizarra.tipo === 'mapa' ? (
              <MapaConceptos mapa={pizarra.mapa} soloVer />
            ) : (
              <TextoLibro markdown={pizarra.texto} className="llamada-ficha" />
            )}
          </section>
        </>
      ) : (
        <>
          <div className="llamada-avatar">
            <span className="llamada-onda" aria-hidden />
            <Mascota gesto={gesto} lugar="llamada" />
          </div>
          <p className="llamada-estado" aria-live="polite">
            {textoEstado}
          </p>
          <p className="llamada-subtitulo">{textoSubtitulo}</p>
        </>
      )}
      {parcial && <p className="llamada-parcial">{t('llamada.tuParcial', { texto: parcial })}</p>}
      {(mudo || !oido.current.disponible()) && (
        <form
          className="llamada-escribir"
          onSubmit={(e) => {
            e.preventDefault()
            if (!escrito.trim()) return
            interrumpir('escrito')
            entregar(escrito)
            setEscrito('')
          }}
        >
          <input value={escrito} onChange={(e) => setEscrito(e.target.value)} placeholder={t('llamada.escribele')} aria-label={t('llamada.mensajeEscrito')} />
          <button className="boton">{t('llamada.enviar')}</button>
        </form>
      )}
      <ControlVoz compacto />
      <div className="llamada-botones">
        <button className={`llamada-boton ${mudo ? 'activo' : ''}`} onClick={alternarMudo} aria-pressed={mudo} title={mudo ? t('llamada.activarMicro') : t('llamada.silenciarMicro')}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            {mudo && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
          </svg>
          <small>{mudo ? t('llamada.silenciado') : t('llamada.micro')}</small>
        </button>
        {tipo === 'clase' && estado === 'escuchando' && narracion.current.lista.length > 0 && !narracion.current.acabada ? (
          <button
            className="llamada-boton"
            onClick={() => {
              apuntar('entregar', { como: 'boton-seguir' })
              narrar()
            }}
            title={t('llamada.seguirClase')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
            </svg>
            <small>{t('llamada.seguir')}</small>
          </button>
        ) : (
          <button className="llamada-boton" onClick={() => interrumpir('boton')} disabled={estado === 'escuchando'} title={t('llamada.cortarle')}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L4 15.5a1.6 1.6 0 0 1 2.3-2.2L8 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <small>{t('llamada.unaDuda')}</small>
          </button>
        )}
        <button className="llamada-boton colgar" onClick={colgar} title={t('llamada.colgar')}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
            <path d="M3 14.5c5-4.5 13-4.5 18 0l-2.2 2.6-3.6-1.4v-2.4a12 12 0 0 0-6.4 0v2.4l-3.6 1.4z" fill="currentColor" />
          </svg>
          <small>{t('llamada.colgar')}</small>
        </button>
      </div>
      {error && <TextoError texto={error} className="nota" />}
      {listaNotas}
      {banco && (
        <details className="llamada-transcripcion">
          <summary>{t('llamada.preguntasExamen')}</summary>
          {(
            [
              [t('llamada.banco1'), banco.panoramica],
              [t('llamada.banco2'), banco.secciones],
              [t('llamada.banco3'), banco.profundizacion],
            ] as const
          ).map(([nombre, lista]) => (
            <div key={nombre}>
              <p>
                <strong>{nombre}</strong>
              </p>
              <ol>
                {lista.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </div>
          ))}
        </details>
      )}
      {turnos.length > 0 && (
        <details className="llamada-transcripcion">
          <summary>{t('llamada.llevaisDicho')}</summary>
          {turnos
            .filter((x) => x.texto)
            .map((x, i) => (
              <p key={i} className={x.rol}>
                <strong>{x.rol === 'tu' ? t('llamada.tu') : t('llamada.tutor')}:</strong> {paraLeer(x.texto)}
              </p>
            ))}
        </details>
      )}
    </div>
  )
}
