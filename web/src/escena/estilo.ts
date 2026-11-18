// Los tokens del vídeo. Pocos colores y con significado: ámbar es foco, cian es estado, verde es bien,
// rojo es fallo; lo demás, gris. La app del ejemplo tiene su propia identidad (naranja).
import { interpolate, spring, Easing } from 'remotion'
import type { Estado } from './tipos.ts'

export const C = {
  fondo: '#1a1a1a',
  panel: '#212225',
  panelAlto: '#28292d',
  borde: '#3a3b40',
  texto: '#ecebe8',
  gris: '#9a9a9a',
  grisOscuro: '#5d5e63',
  foco: '#f2b33d',
  estado: '#5cc8e6',
  bien: '#62c47c',
  mal: '#e8615b',
  app: '#e8874d',
  palabraClave: '#c39cf2',
  funcion: '#e8c86a',
  numero: '#8fc6ff',
  cadena: '#a9d38f',
}

export const F = {
  serif: "'Newsreader', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
  mono: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  sans: "'Inter', 'Segoe UI', system-ui, sans-serif",
}

export const colorDe = (e?: Estado) =>
  e === 'bien' ? C.bien : e === 'mal' ? C.mal : e === 'foco' ? C.foco : e === 'nuevo' ? C.estado : C.borde

// Entradas suaves y deterministas: todo depende del fotograma.
export const aparecer = (frame: number, desde: number, dura = 12) =>
  interpolate(frame, [desde, desde + dura], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })

export const muelle = (frame: number, desde: number, fps: number) =>
  spring({ frame: frame - desde, fps, config: { damping: 18, stiffness: 120, mass: 0.7 } })

// Atenuar lo que no toca: 1 = encendido, 0.28 = de fondo.
export const atenuado = (encendido: boolean) => (encendido ? 1 : 0.28)
