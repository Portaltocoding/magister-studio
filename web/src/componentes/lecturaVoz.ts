// Leer en voz alta el párrafo activo del modo foco (tecla P) y seguir solo. Con la voz de Magister (Piper, en el
// servidor: no sale del equipo y no gasta modelo); si no está, con una voz del navegador instalada en el equipo
// (nunca una de la red). Los bloques de código, las tablas y las fórmulas en bloque se anuncian y no se leen.
// Lo de arriba es puro (pruebas en web/pruebas/lecturaVoz.test.ts); el lector, al final.
import { frases, leerAjustesVoz, pedirVozMagister, pronunciar, vocesMagisterListas, vozMagister } from './voz.ts'

// Lo que hace falta saber de una unidad para decidir qué se dice.
export interface Leible {
  tag: string
  texto: string
  lineas?: number // en un bloque de código
  filas?: number // en una tabla
  formula?: boolean // una fórmula en bloque
  imagen?: boolean // un diagrama o una imagen sin texto
}

export interface QueDecir {
  leer: boolean // false: se anuncia, no se lee
  texto: string
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export function queDecir(x: Leible): QueDecir {
  const tag = x.tag.toUpperCase()
  if (tag === 'PRE' || x.lineas != null) {
    const n = Math.max(1, x.lineas ?? x.texto.replace(/\n+$/, '').split('\n').length)
    return { leer: false, texto: `Bloque de código, ${plural(n, 'línea', 'líneas')}` }
  }
  if (tag === 'TABLE' || x.filas != null) return { leer: false, texto: `Tabla, ${plural(Math.max(1, x.filas ?? 1), 'fila', 'filas')}` }
  if (x.formula) return { leer: false, texto: 'Fórmula, en pantalla' }
  const texto = x.texto.replace(/\s+/g, ' ').trim()
  if (!texto) return { leer: false, texto: x.imagen ? 'Imagen, en pantalla' : '' }
  return { leer: true, texto }
}

// Lo que dice el lector, en frases (así la primera suena antes y se piden las siguientes mientras tanto).
export const frasesDe = (q: QueDecir) => (q.leer ? frases(q.texto) : q.texto ? [q.texto] : [])

// La espera entre un párrafo y el siguiente.
export const PAUSA_MS = 600

// ===== Con el navegador =====

// Lo que se ve de una unidad del papel, sin las fórmulas en línea (KaTeX repite su texto) ni las notas guardadas.
export function describir(el: HTMLElement): Leible {
  const tag = el.tagName
  if (tag === 'PRE') return { tag, texto: el.textContent ?? '', lineas: (el.textContent ?? '').replace(/\n+$/, '').split('\n').length }
  const tabla = tag === 'TABLE' ? el : el.querySelector('table')
  if (tabla && !(el.textContent ?? '').replace(tabla.textContent ?? '', '').trim()) return { tag: 'TABLE', texto: '', filas: tabla.querySelectorAll('tr').length }
  if (el.classList.contains('katex-display') || (el.querySelector('.katex-display') && !(el.textContent ?? '').trim().replace(el.querySelector('.katex-display')?.textContent ?? '', '').trim()))
    return { tag, texto: '', formula: true }
  const copia = el.cloneNode(true) as HTMLElement
  copia.querySelectorAll('.katex').forEach((k) => k.replaceWith(document.createTextNode(' una fórmula ')))
  copia.querySelectorAll('pre').forEach((k) => k.replaceWith(document.createTextNode(' ')))
  return { tag, texto: copia.textContent ?? '', imagen: !!el.querySelector('svg, img') }
}

// Una voz del navegador instalada en el equipo (localService), en español. Nunca una de un servicio en la red.
export function vozLocalSolo(): SpeechSynthesisVoice | null {
  const es = (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.localService && v.lang.toLowerCase().startsWith('es'))
  return es.find((v) => v.lang === 'es-ES') ?? es[0] ?? null
}

// La voz con la que se lee: la de Magister que tengas elegida o la primera que haya; si el servidor no tiene
// ninguna, la del equipo. null si no hay ninguna local.
export async function elegirVoz(): Promise<{ piper: string | null; local: SpeechSynthesisVoice | null } | null> {
  const voces = await vocesMagisterListas
  const piper = vozMagister() ?? voces[0]?.id ?? null
  const local = vozLocalSolo()
  return piper || local ? { piper, local } : null
}

export class LectorFoco {
  private vez = 0
  private audio: HTMLAudioElement | null = null
  private soltar: (() => void) | null = null
  private audios = new Map<string, Promise<string | null>>()
  private piper: string | null
  private local: SpeechSynthesisVoice | null
  constructor(voz: { piper: string | null; local: SpeechSynthesisVoice | null }) {
    this.piper = voz.piper
    this.local = voz.local
  }

  // Dice las frases en orden. true si acabó; false si se cortó (otro párrafo, P, Esc).
  async decir(lista: string[]): Promise<boolean> {
    this.callar()
    const vez = this.vez
    for (let k = 0; k < lista.length; k++) {
      // La que toca primero; las dos siguientes se piden mientras suena.
      if (this.piper) for (const x of lista.slice(k, k + 3)) void this.pedir(x)
      await this.una(lista[k], vez)
      if (vez !== this.vez) return false
    }
    return vez === this.vez
  }

  callar() {
    this.vez++
    // Lo que estaba sonando termina ya (quien esperaba su final no se queda colgado).
    const s = this.soltar
    this.soltar = null
    s?.()
    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
      this.audio = null
    }
    if (this.local) window.speechSynthesis?.cancel()
  }

  cerrar() {
    this.callar()
    for (const p of this.audios.values()) void p.then((u) => u && URL.revokeObjectURL(u))
    this.audios.clear()
  }

  private pedir(frase: string): Promise<string | null> {
    let p = this.audios.get(frase)
    if (!p && this.piper) {
      p = pedirVozMagister(frase, this.piper)
        .then((b) => (b ? URL.createObjectURL(b) : null))
        .catch(() => null)
      this.audios.set(frase, p)
    }
    return p ?? Promise.resolve(null)
  }

  private async una(frase: string, vez: number): Promise<void> {
    const url = this.piper ? await this.pedir(frase) : null
    if (vez !== this.vez) return
    if (url) {
      await new Promise<void>((fin) => {
        const a = new Audio(url)
        a.playbackRate = leerAjustesVoz().velocidad
        a.onended = () => fin()
        a.onerror = () => fin()
        this.audio = a
        this.soltar = fin
        a.play().catch(() => fin())
      })
      this.soltar = null
      this.audios.delete(frase)
      URL.revokeObjectURL(url)
      return
    }
    // Sin Piper (o falló esta frase): la voz del equipo, si la hay.
    if (!this.local || !window.speechSynthesis) return
    await new Promise<void>((fin) => {
      const u = new SpeechSynthesisUtterance(pronunciar(frase))
      u.lang = this.local!.lang
      u.voice = this.local
      u.rate = leerAjustesVoz().velocidad
      u.onend = () => fin()
      u.onerror = () => fin()
      this.soltar = fin
      window.speechSynthesis.speak(u)
    })
    this.soltar = null
  }
}
