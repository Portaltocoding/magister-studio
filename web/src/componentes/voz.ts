// Voz del tutor y oído del navegador, compartidos por Hablar y la Llamada.
// - Locutor: habla frase a frase mientras la respuesta llega (no espera al final) y se puede cortar al instante.
// - Oido: escucha continuo, con resultados provisionales, y se reinicia solo si el navegador lo corta.
// - esEco: distingue tu voz de la del propio tutor que el micro recoge por los altavoces.
import { paraLaVoz } from './pronunciacion.ts'
import { idiomaActual, t as texto, type Idioma } from '../i18n/i18n.ts'

// El código de idioma de las voces y del dictado del navegador.
export const LENGUA: Record<Idioma, string> = { es: 'es-ES', en: 'en-US' }

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

type VozNav = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService'>

// Las voces del navegador de un idioma.
export const delIdioma = <V extends Pick<SpeechSynthesisVoice, 'lang'>>(voces: V[], idioma: Idioma): V[] => voces.filter((v) => v.lang.toLowerCase().startsWith(idioma))

// Una voz instalada en el equipo (no de un servicio en la red) en ese idioma.
export function mejorVozLocal<V extends VozNav>(voces: V[], idioma: Idioma): V | null {
  const del = delIdioma(voces, idioma)
  return del.find((v) => v.localService && v.lang === LENGUA[idioma]) ?? del.find((v) => v.localService) ?? del[0] ?? null
}

// La voz del navegador: la elegida (si es de este idioma), o una «Natural» si el navegador la tiene (Edge), o la local.
export function elegirVozNavegador<V extends VozNav>(voces: V[], nombre: string | null, idioma: Idioma): V | null {
  const del = delIdioma(voces, idioma)
  return (
    (nombre && del.find((v) => v.name === nombre)) ||
    del.find((v) => /natural/i.test(v.name) && v.lang === LENGUA[idioma]) ||
    del.find((v) => /natural/i.test(v.name)) ||
    mejorVozLocal(voces, idioma)
  )
}

// La voz de Magister (Piper) con la que se habla: la elegida o la primera de ese idioma, o null si no hay ninguna de ese
// idioma (entonces toca la del navegador). Una voz sin idioma es española.
export function elegirVozMagister(voces: VozMagister[], ajuste: string | null, idioma: Idioma): string | null {
  const del = voces.filter((x) => (x.idioma ?? 'es') === idioma)
  if (ajuste?.startsWith('piper:')) return del.some((x) => x.id === ajuste.slice(6)) ? ajuste.slice(6) : (del[0]?.id ?? null)
  if (ajuste === null) return del[0]?.id ?? null
  return null
}

export function vozLocal(idioma: Idioma = idiomaActual()): SpeechSynthesisVoice | null {
  return mejorVozLocal(window.speechSynthesis?.getVoices() ?? [], idioma)
}

// Lo que se lee: sin bloques, sin marcas de Markdown y con las fórmulas avisadas. Lo que va por líneas (títulos,
// listas, tablas, citas) se quita antes de juntar el texto; los operadores (2*3, x > 3, snake_case) se dejan.
export function paraLeer(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/\$\$[\s\S]*?\$\$/g, texto('voz.formula'))
    .replace(/\$([^$\n]+)\$/g, (_, f: string) => (/[\\^{}]/.test(f) ? texto('voz.unaFormula') : f))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\{[^}]*\}/g, '$1')
    .replace(/\s*\{[.#][^}]*\}/g, '')
    .replace(/https?:\/\/\S+/g, texto('voz.enlace'))
    .replace(/^\s*\|.*$/gm, '')
    .replace(/^#+\s+(.+?)\s*$/gm, '$1.')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/gm, '$1.')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_](?=\S)/g, '$1')
    .replace(/(?<=\S)[*_](?=\s|$|[.,;:!?)])/g, '')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/\s*=>\s*/g, idiomaActual() === 'en' ? ' then ' : ' entonces ')
    .replace(/\s*->\s*/g, idiomaActual() === 'en' ? ' to ' : ' a ')
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

export function pronunciar(frase: string): string {
  // El glosario y las reglas son de una voz española: una voz inglesa lee los términos técnicos tal cual.
  if (idiomaActual() === 'en') return frase.replace(/\s+/g, ' ').trim()
  let t = frase
  for (const [patron, por] of PRONUNCIACION) {
    t = por === ' $&' ? t.replace(patron, (m) => ' ' + m.replace(/[/?=&{}%]+/g, ' ').trim()) : t.replace(patron, por)
  }
  // El glosario, los nombres con guion bajo y las letras sueltas (pronunciacion.ts, con sus pruebas en web/pruebas).
  return paraLaVoz(t).replace(/\s+/g, ' ').trim()
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
  return delIdioma(window.speechSynthesis?.getVoices() ?? [], 'es')
}
// La voz del navegador del idioma de ahora (en español, la de siempre).
export function vozElegida(): SpeechSynthesisVoice | null {
  return elegirVozNavegador(window.speechSynthesis?.getVoices() ?? [], leerAjustesVoz().voz, idiomaActual())
}

// Las voces naturales de Magister (Piper, en el servidor): suenan mucho mejor que las de Windows y no salen del equipo.
export interface VozMagister {
  id: string
  nombre: string
  // «es» o «en»; el servidor lo manda desde que hay voces inglesas (sin él, española).
  idioma?: Idioma
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
  return elegirVozMagister(vocesMagister, leerAjustesVoz().voz, idiomaActual())
}

// El audio (WAV) de una frase con una voz de Magister, o null si el servidor no puede. Es la misma petición para la
// llamada, Hablar y el vídeo, así que el servidor sirve de su caché lo que ya ha dicho.
export function pedirVozMagister(frase: string, voz: string, signal?: AbortSignal): Promise<Blob | null> {
  return fetch('/api/voz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: pronunciar(frase), voz }), signal }).then(
    (r) => (r.ok ? r.blob() : null),
  )
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

// Las frases de una respuesta con bloques (diagramas, conceptos, código): cada trozo entre bloques se corta por
// separado, así lo que viene después de un bloque es una frase nueva y no se pega a una que ya se ha dicho.
export function frasesDeRespuesta(visible: string): string[] {
  return visible.split(/```[\s\S]*?```/).flatMap((trozo) => frases(paraLeer(trozo)))
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
    const lista = frasesDeRespuesta(visible)
    const completas = terminado || bloqueAbierto ? lista.length : Math.max(0, lista.length - 1)
    for (; this.enviadas < completas; this.enviadas++) this.decir(lista[this.enviadas])
    if (terminado) this.cerrar()
  }

  decir(frase: string) {
    this.cola.push(frase)
    if (!this.hablando) this.siguiente()
  }

  // Varias frases de golpe: se encolan todas antes de empezar, así la primera ya pide el audio de las dos siguientes
  // (con decir() una a una, la cola está vacía al empezar y la segunda se pide tarde: un hueco de silencio).
  decirTodo(lista: string[]) {
    this.cola.push(...lista)
    if (!this.hablando && this.cola.length) this.siguiente()
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
      p = pedirVozMagister(frase, voz)
        .then((b) => (b ? URL.createObjectURL(b) : null))
        .catch(() => null)
      this.audios.set(clave, p)
    }
    return p
  }

  private conNavegador(frase: string, vez: number) {
    const u = new SpeechSynthesisUtterance(pronunciar(frase))
    u.lang = LENGUA[idiomaActual()]
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
  // Fallos seguidos del dictado: con tres (o uno sin arreglo, como no tener micro) deja de reintentar.
  private fallos = 0
  alParcial: (t: string) => void = () => undefined
  alFinal: (t: string) => void = () => undefined
  alError: (e: string) => void = () => undefined
  // El oído se ha rendido: quien lo usa debe ofrecer escribir. Si nadie lo engancha, se avisa como un error.
  alBloqueo: ((mensaje: string) => void) | null = null

  disponible() {
    return !!Reconocedor
  }

  empezar() {
    if (!Reconocedor || this.activo) return
    this.activo = true
    this.fallos = 0
    this.arrancar()
  }

  private arrancar() {
    if (!Reconocedor || !this.activo) return
    const r = new Reconocedor()
    r.lang = LENGUA[idiomaActual()]
    r.interimResults = true
    r.continuous = true
    r.onresult = (e) => {
      this.fallos = 0
      let provisional = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i]
        if (x.isFinal) this.alFinal(x[0].transcript.trim())
        else provisional += x[0].transcript
      }
      this.alParcial(provisional.trim())
    }
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
        return this.bloquear('No tengo permiso para usar el micrófono. Dale permiso en el candado de la barra de direcciones, o escríbeme abajo.')
      this.fallos++
      if (e.error === 'audio-capture' || this.fallos >= 3) return this.bloquear('No te oigo: revisa el micrófono o la conexión, o escríbeme abajo.')
      this.alError(`El dictado falló (${e.error}).`)
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

  // Deja de escuchar (sin reintentar) y avisa una sola vez.
  private bloquear(mensaje: string) {
    this.activo = false
    if (this.alBloqueo) this.alBloqueo(mensaje)
    else this.alError(mensaje)
  }

  parar() {
    this.activo = false
    this.r?.abort()
    this.r = null
  }
}
