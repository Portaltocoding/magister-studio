// Las teclas de los reproductores de vídeo (el animado y el narrado). Código puro: lo prueban los tests de web/pruebas.
//
// Las escucha la ventana, así que valen con el foco en cualquier sitio (también en pantalla completa), salvo donde
// la tecla es de otro: al escribir en una caja nunca, y el espacio sobre un botón, un enlace o una casilla lo pulsa a
// él (si además pausara, el vídeo se pararía y arrancaría a la vez). Las flechas sobre un deslizador o un grupo de
// opciones mueven eso, no el vídeo.
import { tramoEn, verTramo } from './tipos.ts'

// Lo mínimo de un elemento del DOM para decidir (los tests pasan uno falso).
export interface Destino {
  closest(selector: string): unknown
}
export interface Tecla {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  defaultPrevented?: boolean
}

const ESCRIBIR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]'
const PULSAR = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]'
const CON_FLECHAS = '[role="slider"], [role="listbox"], [role="menu"], [role="radiogroup"], [role="tablist"], [role="grid"], [role="tree"]'
const FLECHAS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
// Los <input> en los que no se escribe: una casilla se pulsa con el espacio; un deslizador o una opción, además, se
// mueven con las flechas. Las demás teclas (K, M, F…) siguen siendo del vídeo.
const SE_PULSAN = new Set(['checkbox', 'button', 'submit', 'reset', 'color', 'file', 'image'])
const SE_MUEVEN = new Set(['radio', 'range'])

export function teclaDelReproductor(e: Tecla, destino: Destino | null): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false
  if (!destino || typeof destino.closest !== 'function') return true
  const caja = destino.closest(ESCRIBIR) as { tagName?: string; type?: string } | null
  if (caja) {
    const tipo = caja.tagName === 'INPUT' ? String(caja.type ?? '') : ''
    if (SE_PULSAN.has(tipo)) return e.key !== ' '
    if (SE_MUEVEN.has(tipo)) return e.key !== ' ' && !FLECHAS.has(e.key)
    return false
  }
  if (e.key === ' ' && destino.closest(PULSAR)) return false
  if (FLECHAS.has(e.key) && destino.closest(CON_FLECHAS)) return false
  return true
}

// ===== El vídeo animado: qué hace cada tecla =====
// Como en cualquier reproductor: espacio o K pausa y sigue; ← → saltan 5 s; Mayús+← → (o J / L) van a la tesis
// anterior o siguiente; M calla o devuelve la voz; F pone o quita la pantalla completa.
export type AccionVideo = 'tocar' | 'atras' | 'adelante' | 'tramoAnterior' | 'tramoSiguiente' | 'silencio' | 'pantalla'

export const SALTO_SEGUNDOS = 5
// «Tesis anterior» con el tramo ya empezado vuelve a su principio (como «anterior» en una lista de canciones).
export const VOLVER_AL_PRINCIPIO_SEGUNDOS = 2
export const AYUDA_TECLAS = 'Teclas: espacio o K pausa · ← → 5 s · Mayús+← → (o J / L) tesis · M voz · F pantalla completa'

export function accionDeTecla(e: Tecla, destino: Destino | null): AccionVideo | null {
  if (!teclaDelReproductor(e, destino)) return null
  if (e.key === 'ArrowLeft') return e.shiftKey ? 'tramoAnterior' : 'atras'
  if (e.key === 'ArrowRight') return e.shiftKey ? 'tramoSiguiente' : 'adelante'
  if (e.key === ' ') return 'tocar'
  switch (e.key.toLowerCase()) {
    case 'k':
      return 'tocar'
    case 'j':
      return 'tramoAnterior'
    case 'l':
      return 'tramoSiguiente'
    case 'm':
      return 'silencio'
    case 'f':
      return 'pantalla'
  }
  return null
}

// Adónde lleva un salto: el fotograma, o null si no hay adónde (ya en la última tesis). Nunca antes de que la
// primera escena haya entrado (el fotograma 0 es negro) ni más allá del último.
export function fotogramaTrasTecla(
  accion: 'atras' | 'adelante' | 'tramoAnterior' | 'tramoSiguiente',
  frame: number,
  desde: number[],
  total: number,
  fps: number,
): number | null {
  const ultimo = Math.max(0, total - 1)
  const primero = verTramo(desde, 0, total)
  if (accion === 'adelante') return Math.min(ultimo, frame + SALTO_SEGUNDOS * fps)
  if (accion === 'atras') return Math.max(Math.min(primero, frame), frame - SALTO_SEGUNDOS * fps)
  const i = tramoEn(desde, frame)
  if (accion === 'tramoSiguiente') return i + 1 < desde.length ? verTramo(desde, i + 1, total) : null
  const inicio = verTramo(desde, i, total)
  if (i === 0 || frame - inicio > VOLVER_AL_PRINCIPIO_SEGUNDOS * fps) return inicio
  return verTramo(desde, i - 1, total)
}
