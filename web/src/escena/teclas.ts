// Las teclas de los reproductores de vídeo (el animado y el narrado). Código puro: lo prueban los tests de web/pruebas.
//
// Las escucha la ventana, así que valen con el foco en cualquier sitio (también en pantalla completa), salvo donde
// la tecla es de otro: al escribir en una caja nunca, y el espacio sobre un botón, un enlace o una casilla lo pulsa a
// él (si además pausara, el vídeo se pararía y arrancaría a la vez).

// Lo mínimo de un elemento del DOM para decidir (los tests pasan uno falso).
export interface Destino {
  closest(selector: string): unknown
}
export interface Tecla {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  defaultPrevented?: boolean
}

const ESCRIBIR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]'
const PULSAR = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]'

export function teclaDelReproductor(e: Tecla, destino: Destino | null): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false
  if (!destino || typeof destino.closest !== 'function') return true
  if (destino.closest(ESCRIBIR)) return false
  if (e.key === ' ' && destino.closest(PULSAR)) return false
  return true
}
