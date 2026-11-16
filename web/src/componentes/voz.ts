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
  voz: SpeechSynthesisVoice | null = vozLocal()
  velocidad = 1.05
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

  parar() {
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
      this.hablando = false
      this.actual = ''
      if (this.cerrado) this.acabar()
      return
    }
    this.hablando = true
    this.actual = frase
    this.reciente = (this.reciente + ' ' + frase).slice(-600)
    this.alFrase?.(frase)
    const u = new SpeechSynthesisUtterance(frase)
    u.lang = 'es-ES'
    if (this.voz) u.voice = this.voz
    u.rate = this.velocidad
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
