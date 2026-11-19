// El modo zen del foco: la barra y el pie se apartan mientras lees. Aquí, solo las reglas (sin React ni DOM),
// para poder probarlas: cuándo asoma la barra, cuándo se ve el pie, la línea de progreso y el reloj en minutos.

// La franja de arriba que hace asomar la barra, y lo que tarda en irse cuando el ratón se aleja.
export const ZONA_BARRA_PX = 64
export const OCULTAR_BARRA_MS = 1200
// Lo que se queda el pie al cambiar de idea.
export const PIE_ASOMA_MS = 3000
// Lo que se queda el aviso «Modo zen · Z para salir» al entrar.
export const CINTA_MS = 2600

const CLAVE = 'magister-foco-zen'

interface Almacen {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

// Se recuerda entre sesiones; por defecto, apagado.
export function leerZen(almacen: Almacen | null | undefined): boolean {
  try {
    return almacen?.getItem(CLAVE) === 'si'
  } catch {
    return false
  }
}

export function guardarZen(almacen: Almacen | null | undefined, zen: boolean) {
  try {
    almacen?.setItem(CLAVE, zen ? 'si' : 'no')
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
}

// ¿Tiene que verse la barra con el ratón a `y` px del borde de arriba?
// Ya asomada, la franja crece hasta su borde de abajo (la barra puede medir más de 64 px) y estar encima de ella
// (o de su menú, que cuelga por debajo) la mantiene.
export function barraAsoma(y: number, c: { asomada: boolean; altoBarra: number; sobreBarra: boolean; menuAbierto: boolean }): boolean {
  if (c.menuAbierto || c.sobreBarra) return true
  const zona = c.asomada ? Math.max(ZONA_BARRA_PX, c.altoBarra) : ZONA_BARRA_PX
  return y >= 0 && y < zona
}

// ¿Se ve el pie? Sin zen, siempre. En zen, fuera de la lectura de una idea también (el calentamiento lleva ahí su
// «Saltar»); en la idea, solo en el último párrafo, un momento al cambiar de idea, con los atajos abiertos (cuelgan
// del pie) o si hay un error que leer.
export function pieVisible(c: {
  zen: boolean
  pantalla: string
  ultimoParrafo: boolean
  asomando: boolean
  chuleta: boolean
  error: boolean
}): boolean {
  if (!c.zen || c.pantalla !== 'idea') return true
  return c.ultimoParrafo || c.asomando || c.chuleta || c.error
}

// La línea de 3 px: las ideas hechas y, dentro de la idea, los párrafos hasta el activo. De 0 a 1.
export function progresoLeccion(idea: number, ideas: number, parrafo: number, parrafos: number): number {
  if (ideas <= 0) return 0
  const dentro = parrafos > 0 ? (Math.min(Math.max(parrafo, 0), parrafos - 1) + 1) / parrafos : 0
  return Math.min(1, Math.max(0, (Math.min(Math.max(idea, 0), ideas - 1) + dentro) / ideas))
}

// El reloj en zen: solo minutos («12 min», «1 h 05 min»), así cambia una vez por minuto y no cada segundo.
export function relojZen(segundos: number): string {
  const m = Math.floor(Math.max(0, segundos) / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}
