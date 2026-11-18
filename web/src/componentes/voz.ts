// Voz del tutor y oído del navegador, compartidos por Hablar y la Llamada.
// - Locutor: habla frase a frase mientras la respuesta llega (no espera al final) y se puede cortar al instante.
// - Oido: escucha continuo, con resultados provisionales, y se reinicia solo si el navegador lo corta.
// - esEco: distingue tu voz de la del propio tutor que el micro recoge por los altavoces.
import { aplicarGlosario } from './pronunciacion.ts'

export interface Reconocimiento {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

export const Reconocedor = (window as unknown as { SpeechRecognition?: new () => Reconocimiento; webkitSpeechRecognition?: new () => Reconocimiento })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Reconocimiento }).webkitSpeechRecognition

// Una voz en español instalada en el equipo (no de un servicio en la red).
export function vozLocal(): SpeechSynthesisVoice | null {
  const es = (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith('es'))
  return es.find((v) => v.localService && v.lang === 'es-ES') ?? es.find((v) => v.localService) ?? es[0] ?? null
}

// Lo que se lee: sin bloques, sin marcas de Markdown y con las fórmulas avisadas. Lo que va por líneas (títulos,
// listas, tablas, citas) se quita antes de juntar el texto; los operadores (2*3, x > 3, snake_case) se dejan.
export function paraLeer(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (la fórmula está en pantalla) ')
    .replace(/\$([^$\n]+)\$/g, (_, f: string) => (/[\\^{}]/.test(f) ? 'una fórmula' : f))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\{[^}]*\}/g, '$1')
    .replace(/\s*\{[.#][^}]*\}/g, '')
    .replace(/https?:\/\/\S+/g, 'un enlace')
    .replace(/^\s*\|.*$/gm, '')
    .replace(/^#+\s+(.+?)\s*$/gm, '$1.')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/gm, '$1.')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_](?=\S)/g, '$1')
    .replace(/(?<=\S)[*_](?=\s|$|[.,;:!?)])/g, '')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/\s*=>\s*/g, ' entonces ')
    .replace(/\s*->\s*/g, ' a ')
    .replace(/\[(\d+)\]/g, '')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/([.!?…:;])\s*\./g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// Cómo debe sonar lo que una voz española lee mal (solo para la voz: el subtítulo sigue con el texto escrito).
const PRONUNCIACION: [RegExp, string][] = [
  [/\bO\(\s*1\s*\)/g, 'O de uno'],
  [/\bO\(\s*n\s*log\s*n\s*\)/g, 'O de n por logaritmo de n'],
  [/\bO\(\s*log\s*n\s*\)/g, 'O de logaritmo de n'],
  [/\bO\(\s*n\s*(\^\s*2|²)\s*\)/g, 'O de n al cuadrado'],
  [/\bO\(\s*n\s*\)/g, 'O de n'],
  // Rutas como /pedidos/42?limit=20: se leen sus palabras, sin las barras.
  [/(^|\s)\/[\w\-/{}.?=&%]+/g, (' $&' as string)],
]
// Los términos sueltos (siglas, SQL, HTTP, unidades...) van en el glosario de pronunciación: componentes/pronunciacion.ts.

const NOMBRE_LETRA: Record<string, string> = {
  A: 'á', B: 'be', C: 'ce', D: 'de', E: 'é', F: 'efe', G: 'ge', H: 'hache', I: 'í', J: 'jota', K: 'ka', L: 'ele', M: 'eme',
  N: 'ene', O: 'ó', P: 'pe', Q: 'cu', R: 'erre', S: 'ese', T: 'te', U: 'ú', V: 'uve', W: 'uve doble', X: 'equis',
  Y: 'i griega', Z: 'zeta',
}

export function pronunciar(frase: string): string {
  let t = frase
  for (const [patron, por] of PRONUNCIACION) {
    t = por === ' $&' ? t.replace(patron, (m) => ' ' + m.replace(/[/?=&{}%]+/g, ' ').trim()) : t.replace(patron, por)
  }
  // El glosario, y después los nombres con guion bajo (idx_pedidos_cliente) palabra a palabra, sin «guion bajo».
  t = aplicarGlosario(t).replace(/([\p{L}\d])_(?=[\p{L}\d])/gu, '$1 ')
  // Una letra mayúscula suelta que nombra algo («el punto A», «de A a C», «la X») se dice por su nombre; si no, «el
  // punto A» suena «el puntoa». Solo tras una palabra en minúscula: la «A» que abre una frase es la preposición.
  t = t.replace(/(?<=\p{Ll}[ \t]+)([A-Z])(?![\p{L}\d])/gu, (_, l: string) => NOMBRE_LETRA[l] ?? l)
  return t.replace(/\s+/g, ' ').trim()
}

// Velocidad y voz, compartidas por la llamada, Hablar y el vídeo, y recordadas en el navegador.
// Con las voces de Windows, Chrome redondea la velocidad a pasos enteros: por eso los pasos son grandes (1,05× no se nota).
export const VELOCIDADES = [0.8, 1, 1.25, 1.5, 1.75, 2]
export interface AjustesVoz {
  velocidad: number
  // null = la mejor que haya (la natural de Magister si está instalada); «piper:<id>» = una voz de Magister;
  // «navegador» = la del equipo; otro texto = el nombre de una voz del navegador.
  voz: string | null
}
const CLAVE_VOZ = 'magister-voz'
export function leerAjustesVoz(): AjustesVoz {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_VOZ) ?? '{}')
    return { velocidad: VELOCIDADES.includes(v.velocidad) ? v.velocidad : 1, voz: typeof v.voz === 'string' ? v.voz : null }
  } catch {
    return { velocidad: 1, voz: null }
  }
}
export function guardarAjustesVoz(a: AjustesVoz) {
  try {
    localStorage.setItem(CLAVE_VOZ, JSON.stringify(a))
  } catch {
    /* sin almacenamiento */
  }
  window.dispatchEvent(new CustomEvent('magister-voz', { detail: a }))
}
export function vocesEspanol(): SpeechSynthesisVoice[] {
  return (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith('es'))
}
// La voz del navegador: la elegida, o una «Natural» si el navegador la tiene (Edge), o la local en español.
export function vozElegida(): SpeechSynthesisVoice | null {
  const nombre = leerAjustesVoz().voz
  const voces = vocesEspanol()
  return (
    (nombre && voces.find((v) => v.name === nombre)) ||
    voces.find((v) => /natural/i.test(v.name) && v.lang === 'es-ES') ||
    voces.find((v) => /natural/i.test(v.name)) ||
    vozLocal()
  )
}

// Las voces naturales de Magister (Piper, en el servidor): suenan mucho mejor que las de Windows y no salen del equipo.
export interface VozMagister {
  id: string
  nombre: string
}
export let vocesMagister: VozMagister[] = []
export const vocesMagisterListas: Promise<VozMagister[]> =
  typeof fetch === 'function'
    ? fetch('/api/voz/voces')
        .then((r) => (r.ok ? (r.json() as Promise<VozMagister[]>) : []))
        .catch(() => [])
        .then((v) => {
          vocesMagister = v
          window.dispatchEvent(new CustomEvent('magister-voces'))
          return v
        })
    : Promise.resolve([])

// La voz de Magister con la que se habla ahora, o null si toca la del navegador.
export function vozMagister(): string | null {
  const v = leerAjustesVoz().voz
  if (v?.startsWith('piper:')) return vocesMagister.some((x) => x.id === v.slice(6)) ? v.slice(6) : (vocesMagister[0]?.id ?? null)
  if (v === null) return vocesMagister[0]?.id ?? null
  return null
}

// Cómo se llama la voz que suena (para el registro de la llamada).
export function nombreVozActual(): string {
  const m = vozMagister()
  return m ? `magister:${m}` : (vozElegida()?.name ?? 'sin voz')
}

// Los locutores que están hablando: si cambias la velocidad o la voz, repiten la frase que suena con lo nuevo.
const hablando = new Set<Locutor>()
window.addEventListener('magister-voz', () => hablando.forEach((l) => l.repetirActual()))

// Frases para decir de una en una. Se corta tras . ! ? …, pero no tras una abreviatura («p. ej.», «etc.», «EE. UU.»)
// ni cuando lo siguiente empieza en minúscula (la frase sigue).
const ABREVIATURA = /(?:^|[\s(])(?:p\.\s?ej|ej|etc|EE\.\s?UU|EE|Dr|Dra|Sr|Sra|Sres|pág|págs|cap|fig|vs|aprox|núm|art|a\.\s?C|d\.\s?C)\.$/i
export function frases(t: string): string[] {
  const salida: string[] = []
  for (const trozo of t.split(/(?<=[.!?…])\s+(?=\S)/)) {
    const x = trozo.trim()
    if (!x) continue
    const previa = salida[salida.length - 1]
    if (previa && (ABREVIATURA.test(previa) || /^\d+\.$/.test(previa) || /^[a-zñáéíóúü]/.test(x))) salida[salida.length - 1] = `${previa} ${x}`
    else salida.push(x)
  }
  return salida
}

const palabras = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)

// ¿Lo que ha oído el micro es la voz del tutor? Si casi todas sus palabras están en lo último que ha dicho, sí.
export function esEco(oido: string, dicho: string): boolean {
  const o = palabras(oido)
  if (!o.length) return true
  const d = new Set(palabras(dicho))
  const comunes = o.filter((w) => d.has(w)).length
  return comunes / o.length >= 0.6
}

export class Locutor {
  private cola: string[] = []
  private hablando = false
  private cerrado = false
  private enviadas = 0
  private fin: (() => void) | null = null
  // Cada frase que empieza lleva un número: los avisos de una ya cortada (onend tardío, audio que acaba) se ignoran.
  private vez = 0
  // Lo que suena: un enunciado del navegador (se guarda para que Chrome no lo recoja a medias) o un audio de Magister.
  private u: SpeechSynthesisUtterance | null = null
  private audio: HTMLAudioElement | null = null
  // El audio de cada frase con la voz de Magister, pedido antes de que toque (así no hay huecos entre frases).
  private audios = new Map<string, Promise<string | null>>()
  private ultimas: string[] = []
  // Lo último que ha dicho, sus tres últimas frases (para reconocer el eco), y la frase que suena (para el subtítulo).
  reciente = ''
  actual = ''
  alFrase: ((f: string) => void) | null = null

  // Texto acumulado de una respuesta que va llegando: dice las frases ya completas que aún no ha dicho.
  empujar(acumulado: string, terminado = false) {
    let visible = acumulado
    // Un bloque abierto (un diagrama que se está dibujando) no se lee, y lo dicho antes de él ya está completo.
    const bloqueAbierto = (visible.match(/```/g) ?? []).length % 2 === 1
    if (bloqueAbierto) visible = visible.slice(0, visible.lastIndexOf('```'))
    const lista = frases(paraLeer(visible))
    const completas = terminado || bloqueAbierto ? lista.length : Math.max(0, lista.length - 1)
    for (; this.enviadas < completas; this.enviadas++) this.decir(lista[this.enviadas])
    if (terminado) this.cerrar()
  }

  decir(frase: string) {
    this.cola.push(frase)
    if (!this.hablando) this.siguiente()
  }

  // Ya no llegará más: cuando acabe lo que tiene en cola, avisa.
  cerrar() {
    this.cerrado = true
    if (!this.hablando && !this.cola.length) this.acabar()
  }

  // Una respuesta nueva: vacía el estado de la anterior.
  nueva() {
    this.parar()
    this.enviadas = 0
    this.cerrado = false
  }

  terminado(): Promise<void> {
    return new Promise((r) => {
      if (this.cerrado && !this.hablando && !this.cola.length) return r()
      this.fin = r
    })
  }

  // Vuelve a decir la frase que suena (con la velocidad y la voz de ahora).
  repetirActual() {
    if (!this.hablando || !this.actual) return
    this.cola.unshift(this.actual)
    this.callar()
    this.siguiente() // la misma frase, otra vez (sin volver a avisar del subtítulo)
  }

  parar() {
    hablando.delete(this)
    this.cola = []
    this.hablando = false
    this.callar()
    for (const p of this.audios.values()) void p.then((url) => url && URL.revokeObjectURL(url))
    this.audios.clear()
    this.actual = ''
    const f = this.fin
    this.fin = null
    f?.()
  }

  ocupado() {
    return this.hablando || this.cola.length > 0
  }

  private acabar() {
    const f = this.fin
    this.fin = null
    f?.()
  }

  // Corta lo que suena sin tocar la cola.
  private callar() {
    this.vez++
    if (this.u) {
      this.u.onend = null
      this.u.onerror = null
      this.u = null
    }
    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
      this.audio = null
    }
    window.speechSynthesis?.cancel()
  }

  private pedirAudio(frase: string, voz: string): Promise<string | null> {
    const clave = `${voz}|${frase}`
    let p = this.audios.get(clave)
    if (!p) {
      p = fetch('/api/voz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: pronunciar(frase), voz }) })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? URL.createObjectURL(b) : null))
        .catch(() => null)
      this.audios.set(clave, p)
    }
    return p
  }

  private conNavegador(frase: string, vez: number) {
    const u = new SpeechSynthesisUtterance(pronunciar(frase))
    u.lang = 'es-ES'
    const voz = vozElegida()
    if (voz) u.voice = voz
    u.rate = leerAjustesVoz().velocidad
    const sigue = () => {
      if (this.vez === vez && this.hablando) this.siguiente()
    }
    u.onend = sigue
    u.onerror = sigue
    this.u = u
    window.speechSynthesis.speak(u)
  }

  private conMagister(frase: string, voz: string, vez: number) {
    // Las dos frases siguientes se piden ya, mientras suena esta.
    for (const x of this.cola.slice(0, 2)) void this.pedirAudio(x, voz)
    void this.pedirAudio(frase, voz).then((url) => {
      if (this.vez !== vez || !this.hablando) return
      if (!url) return this.conNavegador(frase, vez) // si Magister no puede, la del navegador
      const a = new Audio(url)
      a.playbackRate = leerAjustesVoz().velocidad
      const sigue = () => {
        // Ya sonó: se suelta (si hay que repetirla, el servidor la tiene guardada).
        this.audios.delete(`${voz}|${frase}`)
        URL.revokeObjectURL(url)
        if (this.vez === vez && this.hablando) this.siguiente()
      }
      a.onended = sigue
      a.onerror = sigue
      this.audio = a
      a.play().catch(sigue)
    })
  }

  private siguiente() {
    const frase = this.cola.shift()
    if (frase == null) {
      hablando.delete(this)
      this.hablando = false
      this.actual = ''
      if (this.cerrado) this.acabar()
      return
    }
    this.hablando = true
    hablando.add(this)
    const repetida = frase === this.actual
    this.actual = frase
    if (!repetida) {
      this.ultimas = [...this.ultimas, frase].slice(-3)
      this.reciente = this.ultimas.join(' ')
      this.alFrase?.(frase)
    }
    const vez = ++this.vez
    const magister = vozMagister()
    if (magister) this.conMagister(frase, magister, vez)
    else this.conNavegador(frase, vez)
  }
}

// Escucha continua mientras dura la llamada. El navegador corta el dictado cada cierto tiempo: se reinicia solo.
export class Oido {
  private r: Reconocimiento | null = null
  private activo = false
  alParcial: (t: string) => void = () => undefined
  alFinal: (t: string) => void = () => undefined
  alError: (e: string) => void = () => undefined

  disponible() {
    return !!Reconocedor
  }

  empezar() {
    if (!Reconocedor || this.activo) return
    this.activo = true
    this.arrancar()
  }

  private arrancar() {
    if (!Reconocedor || !this.activo) return
    const r = new Reconocedor()
    r.lang = 'es-ES'
    r.interimResults = true
    r.continuous = true
    r.onresult = (e) => {
      let provisional = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i]
        if (x.isFinal) this.alFinal(x[0].transcript.trim())
        else provisional += x[0].transcript
      }
      this.alParcial(provisional.trim())
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.activo = false
        this.alError('No tengo permiso para usar el micrófono. Dale permiso en el candado de la barra de direcciones.')
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') this.alError(`El dictado falló (${e.error}).`)
    }
    r.onend = () => {
      this.r = null
      if (this.activo) window.setTimeout(() => this.arrancar(), 150)
    }
    this.r = r
    try {
      r.start()
    } catch {
      /* ya estaba en marcha */
    }
  }

  parar() {
    this.activo = false
    this.r?.abort()
    this.r = null
  }
}
