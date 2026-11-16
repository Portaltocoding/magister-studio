// Voz del tutor y oído del navegador, compartidos por Hablar y la Llamada.
// - Locutor: habla frase a frase mientras la respuesta llega (no espera al final) y se puede cortar al instante.
// - Oido: escucha continuo, con resultados provisionales, y se reinicia solo si el navegador lo corta.
// - esEco: distingue tu voz de la del propio tutor que el micro recoge por los altavoces.

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

// Lo que se lee: sin bloques, sin marcas de Markdown y con las fórmulas avisadas.
export function paraLeer(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (fórmula en pantalla) ')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/[#*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Velocidad y voz, compartidas por la llamada, Hablar y el vídeo, y recordadas en el navegador.
// Con las voces de Windows, Chrome redondea la velocidad a pasos enteros: por eso los pasos son grandes (1,05× no se nota).
export const VELOCIDADES = [0.8, 1, 1.25, 1.5, 1.75, 2]
export interface AjustesVoz {
  velocidad: number
  voz: string | null // nombre de la voz; null = la local en español
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
export function vozElegida(): SpeechSynthesisVoice | null {
  const nombre = leerAjustesVoz().voz
  return (nombre && vocesEspanol().find((v) => v.name === nombre)) || vozLocal()
}

// Los locutores que están hablando: si cambias la velocidad o la voz, repiten la frase que suena con lo nuevo.
const hablando = new Set<Locutor>()
window.addEventListener('magister-voz', () => hablando.forEach((l) => l.repetirActual()))

export const frases = (t: string) => t.split(/(?<=[.!?…:;])\s+(?=\S)/).map((x) => x.trim()).filter(Boolean)

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
  // Lo último que ha dicho (para reconocer el eco) y la frase que suena (para el subtítulo).
  reciente = ''
  actual = ''
  alFrase: ((f: string) => void) | null = null

  // Texto acumulado de una respuesta que va llegando: dice las frases ya completas que aún no ha dicho.
  empujar(acumulado: string, terminado = false) {
    let visible = acumulado
    if ((visible.match(/```/g) ?? []).length % 2) visible = visible.slice(0, visible.lastIndexOf('```'))
    const lista = frases(paraLeer(visible))
    const completas = terminado ? lista.length : Math.max(0, lista.length - 1)
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
    window.speechSynthesis?.cancel() // su onend/onerror lanza la siguiente: la misma, otra vez
  }

  parar() {
    hablando.delete(this)
    this.cola = []
    this.hablando = false
    window.speechSynthesis?.cancel()
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
      this.reciente = (this.reciente + ' ' + frase).slice(-600)
      this.alFrase?.(frase)
    }
    const u = new SpeechSynthesisUtterance(frase)
    u.lang = 'es-ES'
    const voz = vozElegida()
    if (voz) u.voice = voz
    u.rate = leerAjustesVoz().velocidad
    u.onend = () => this.hablando && this.siguiente()
    u.onerror = () => this.hablando && this.siguiente()
    window.speechSynthesis.speak(u)
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
