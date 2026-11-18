// El ánimo de Magister: la mascota reacciona a lo que pasa (asiente si aciertas, ladea la cabeza si fallas, salta
// cuando terminas algo), se duerme si llevas un rato sin tocar nada y lo que terminas se celebra con un estallido
// pequeño de confeti. Todo es decorativo: con «reducir movimiento» no hay confeti y la mascota se queda quieta.

export type Reaccion = 'acierto' | 'fallo' | 'celebrar'
export const EVENTO_REACCION = 'magister-reaccion'
export const EVENTO_SUENO = 'magister-sueno'
const DORMIR_TRAS = 2 * 60 * 1000

const quieto = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function reaccionar(r: Reaccion) {
  window.dispatchEvent(new CustomEvent(EVENTO_REACCION, { detail: r }))
}

type Origen = Element | { x: number; y: number } | null | undefined

// Un estallido de confeti desde un elemento (o un punto) y la mascota salta. `fuerte`: más piezas y más lejos
// (terminar un bloque o un nivel, no un paso suelto).
export function celebrar(origen?: Origen, fuerte = false) {
  reaccionar('celebrar')
  if (quieto()) return
  let x = window.innerWidth / 2
  let y = window.innerHeight / 3
  if (origen instanceof Element) {
    const r = origen.getBoundingClientRect()
    x = r.left + Math.min(r.width / 2, 40)
    y = r.top + r.height / 2
  } else if (origen) ({ x, y } = origen)
  const capa = document.createElement('div')
  capa.className = 'confeti'
  capa.setAttribute('aria-hidden', 'true')
  capa.style.left = `${x}px`
  capa.style.top = `${y}px`
  const piezas = fuerte ? 26 : 14
  for (let i = 0; i < piezas; i++) {
    const p = document.createElement('span')
    const angulo = (Math.PI * 2 * i) / piezas + Math.random() * 0.5
    const lejos = (fuerte ? 90 : 55) + Math.random() * (fuerte ? 70 : 40)
    p.style.setProperty('--dx', `${Math.cos(angulo) * lejos}px`)
    p.style.setProperty('--dy', `${Math.sin(angulo) * lejos - 30}px`)
    p.style.setProperty('--giro', `${Math.round(Math.random() * 540 - 270)}deg`)
    p.style.setProperty('--retraso', `${Math.round(Math.random() * 80)}ms`)
    if (i % 3 === 0) p.className = 'redonda'
    capa.appendChild(p)
  }
  document.body.appendChild(capa)
  window.setTimeout(() => capa.remove(), 1400)
}

// El sueño: tras 2 minutos sin tocar nada, las mascotas cierran los ojos y respiran despacio; al volver, despiertan.
let vigilando = false
let dormida = false
export function vigilarSueno() {
  if (vigilando) return
  vigilando = true
  let ultimo = Date.now()
  const despertar = () => {
    ultimo = Date.now()
    if (dormida) {
      dormida = false
      window.dispatchEvent(new CustomEvent(EVENTO_SUENO, { detail: false }))
    }
  }
  for (const e of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(e, despertar, { passive: true })
  window.setInterval(() => {
    if (!dormida && Date.now() - ultimo > DORMIR_TRAS && document.visibilityState === 'visible') {
      dormida = true
      window.dispatchEvent(new CustomEvent(EVENTO_SUENO, { detail: true }))
    }
  }, 10000)
}
export const estaDormida = () => dormida
