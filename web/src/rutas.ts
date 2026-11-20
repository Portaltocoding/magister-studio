// La ruta de la app (#/roadmap, #/conversacion/6, #/nuevo-plan): qué pantalla pide y qué ruta corresponde a una
// pantalla. Puro, con pruebas en web/pruebas/rutas.test.ts; Marco.tsx es quien toca la historia del navegador.
import { MODOS, type IdModo } from './modos.ts'

export interface Ruta {
  modo: IdModo
  conversacion: number | null
  // El cuestionario del plan nuevo (#/nuevo-plan) es Estudio libre sin conversación, en su variante «plan».
  nuevoPlan: boolean
}

export function leerRuta(hash: string): Ruta {
  const partes = hash.replace(/^#\/?/, '').split('/')
  if (partes[0] === 'conversacion' && Number(partes[1])) return { modo: 'libre', conversacion: Number(partes[1]), nuevoPlan: false }
  if (partes[0] === 'nuevo-plan') return { modo: 'libre', conversacion: null, nuevoPlan: true }
  const modo = MODOS.find((m) => m.id === partes[0] && m.encendido)?.id
  // Sin ruta se abre Estudio libre; Hoy sigue en #/hoy.
  return { modo: modo ?? 'libre', conversacion: null, nuevoPlan: false }
}

export function rutaDe(modo: IdModo, conversacion: number | null, tipoNueva: 'libre' | 'plan'): string {
  if (modo === 'libre' && conversacion != null) return `#/conversacion/${conversacion}`
  if (modo === 'libre' && tipoNueva === 'plan') return '#/nuevo-plan'
  return `#/${modo}`
}

// ¿Hay que escribir la ruta? No si ya es esa, ni si es esa con algo detrás que lee el panel (#/fichas/3/L2, #/foco/12/3,
// #/proyectos/4): el panel la limpia él mismo cuando toca.
export const hayQueEscribir = (actual: string, ruta: string) => actual !== ruta && !actual.startsWith(`${ruta}/`)
