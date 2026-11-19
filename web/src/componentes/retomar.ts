// Retomar una lección del modo foco donde la dejaste: la ruta #/foco/<apuntes>/<idea> mientras está abierta, la
// pantalla a la que vuelves al salir y el «Seguir · idea 3, párrafo 6 · hace 2 días» de la lista y de Hoy.
// Las funciones son puras (con pruebas en web/pruebas/retomar.test.ts); lo que toca la URL va al final.
import { cuando } from './aMedias.ts'

const MINUTO = 60_000

// Lo que pide la ruta al abrir el panel: entrar en una lección (la de hoy si mid es null) y en qué idea (desde 1).
export interface RutaFoco {
  entrar: boolean
  mid: number | null
  idea: number | null
}

// Vista foco: #/foco (la lista), #/foco/hoy, #/foco/12 y #/foco/12/3. Vista hoy: #/hoy/foco y #/hoy/foco/12.
export function leerRutaFoco(hash: string, vista: 'hoy' | 'foco'): RutaFoco {
  const partes = hash.replace(/^#\/?/, '').split('/')
  const nada: RutaFoco = { entrar: false, mid: null, idea: null }
  const num = (x: string | undefined) => (x && /^\d+$/.test(x) && Number(x) > 0 ? Number(x) : null)
  if (vista === 'foco') {
    if (partes[0] !== 'foco' || !partes[1]) return nada
    if (partes[1] === 'hoy') return { entrar: true, mid: null, idea: null }
    const mid = num(partes[1])
    return mid ? { entrar: true, mid, idea: num(partes[2]) } : nada
  }
  if (partes[0] !== 'hoy' || partes[1] !== 'foco') return nada
  return { entrar: true, mid: num(partes[2]), idea: num(partes[3]) }
}

// La ruta de una lección abierta: la idea va desde 1.
export const rutaFoco = (mid: number, i: number) => `#/foco/${mid}/${i + 1}`

// ¿Es la ruta de una lección abierta en foco (no la lista ni la de hoy)?
export const esRutaLeccion = (hash: string) => /^#\/(?:foco|hoy\/foco)\/\d+(?:\/|$)/.test(hash)

// La idea que pide la ruta, sobre lo que llevabas. Solo vale para volver atrás (las ideas de más adelante pueden
// tener una comprobación sin contestar); en otra idea, se empieza por su primer párrafo.
export function aplicarIdea<A extends { i: number; u?: number }>(avance: A | null, idea: number | null): A | null {
  if (!avance || idea == null) return avance
  const k = idea - 1
  if (k === avance.i || k < 0 || k > avance.i) return avance
  return { ...avance, i: k, u: 0 }
}

// A dónde vuelves al salir: lo que trae la historia (recargaste con la lección abierta), lo recordado al llegar por
// un enlace (#/fichas/… → #/foco/12) o la pantalla en la que estabas. Nunca otra lección.
export function rutaDeVuelta(c: { estado: unknown; recordada: string | null; actual: string }): string {
  const deEstado = (c.estado as { desde?: unknown } | null)?.desde
  const valida = (r: unknown): r is string => typeof r === 'string' && r.startsWith('#/') && !esRutaLeccion(r)
  if (valida(deEstado)) return deEstado
  if (valida(c.recordada)) return c.recordada
  if (c.actual.startsWith('#/') && !esRutaLeccion(c.actual)) return c.actual
  return c.actual.startsWith('#/hoy') ? '#/hoy' : '#/foco'
}

// «hace un momento», «hace 20 min», «hoy», «ayer», «hace 3 días». `ahora` entra como argumento (ms).
export function haceCuanto(en: number, ahora: number): string {
  const d = ahora - en
  if (d < 2 * MINUTO) return 'hace un momento'
  if (d < 60 * MINUTO) return `hace ${Math.floor(d / MINUTO)} min`
  return cuando(en, ahora)
}

// «Seguir · idea 3, párrafo 6 · hace 2 días». Sin párrafo guardado (o en el primero), solo la idea; sin fecha, sin el final.
export function textoSeguir(av: { i: number; u?: number; en?: number }, ahora: number): string {
  const parrafo = av.u != null && av.u > 0 ? `, párrafo ${av.u + 1}` : ''
  const hace = av.en != null ? ` · ${haceCuanto(av.en, ahora)}` : ''
  return `Seguir · idea ${av.i + 1}${parrafo}${hace}`
}

// ===== La URL (con el navegador; en las pruebas no hay ventana) =====

const CLAVE_DESDE = 'magister-foco-desde'
const VALE_MS = 30_000

// Si llegas a una lección por un enlace (Lecciones → #/foco/12), se recuerda de dónde venías: la ruta anterior ya no
// se puede leer después.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('hashchange', (e) => {
    try {
      const nueva = new URL(e.newURL).hash
      const vieja = new URL(e.oldURL).hash
      if (esRutaLeccion(nueva) && !esRutaLeccion(vieja)) sessionStorage.setItem(CLAVE_DESDE, JSON.stringify({ ruta: vieja || '#/hoy', en: Date.now() }))
    } catch {
      /* sin almacenamiento: al salir vuelves a la lista */
    }
  })
}

// Lo recordado al llegar, solo si es de hace un momento (se lee sin borrar: el render puede repetirse).
export function leerRutaRecordada(ahora: number): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(CLAVE_DESDE) ?? 'null')
    return v && typeof v.ruta === 'string' && ahora - Number(v.en) < VALE_MS ? v.ruta : null
  } catch {
    return null
  }
}

// Ya usado: la siguiente lección que abras desde la lista no vuelve allí.
export function olvidarRutaRecordada() {
  try {
    sessionStorage.removeItem(CLAVE_DESDE)
  } catch {
    /* sin almacenamiento */
  }
}

// Al salir con «Salir» o Esc: la ruta de antes, sin añadir historial, y la app cambia de pantalla si hace falta.
export function volverA(ruta: string) {
  const antes = window.location.href
  window.history.replaceState(null, '', ruta)
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: antes, newURL: window.location.href }))
}
