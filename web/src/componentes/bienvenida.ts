import { idiomaActual, traducir, type Clave, type Idioma } from '../i18n/i18n.ts'

// La bienvenida de la primera vez: qué pasos hay, cuáles se saltan y cómo avanza la conexión con Claude. Puro, con
// pruebas en web/pruebas/bienvenida.test.ts; Bienvenida.tsx solo pinta y llama a la API.

export type Paso = 'idioma' | 'nombre' | 'cuenta' | 'prueba' | 'plan' | 'apuntes'

// «completa»: la primera vez (o «Ver la bienvenida otra vez» en Ajustes). «reconectar»: ya la viste, pero la cuenta de
// Claude ha caducado: solo se vuelve al paso de Claude y a la prueba.
export type Modo = 'completa' | 'reconectar'

export interface EstadoBienvenida {
  estado: 'pendiente' | 'hecha' | 'omitida'
  nombre: string
  // false en el desarrollo sin pty (Windows): desde esa máquina no se puede conectar ni cambiar la cuenta.
  cuenta: { conectada: boolean; caida: boolean; puede_conectar?: boolean }
}

// «Conectar otra cuenta» solo se ofrece si de verdad se puede (un servidor antiguo no manda el campo: se da por bueno).
export const puedeCambiarCuenta = (cuenta: { puede_conectar?: boolean }): boolean => cuenta.puede_conectar !== false

// null: no hay nada que enseñar.
export function modoDe(e: Pick<EstadoBienvenida, 'estado' | 'cuenta'>): Modo | null {
  if (e.estado === 'pendiente') return 'completa'
  return e.cuenta.caida ? 'reconectar' : null
}

// El paso de Claude se enseña siempre: si ya hay cuenta, dice cuál está conectada y deja cambiarla.
export function pasosDe(modo: Modo): Paso[] {
  if (modo === 'reconectar') return ['cuenta', 'prueba']
  return ['idioma', 'nombre', 'cuenta', 'prueba', 'plan', 'apuntes']
}

export const siguiente = (pasos: Paso[], actual: Paso): Paso | null => pasos[pasos.indexOf(actual) + 1] ?? null

export const posicion = (pasos: Paso[], actual: Paso): { n: number; de: number } => ({ n: pasos.indexOf(actual) + 1, de: pasos.length })

// ===== Textos =====
// Todos salen del diccionario (i18n/es.ts, i18n/en.ts). El idioma entra como argumento (por defecto, el de ahora) para
// que se puedan probar los dos.

export function limpiarNombre(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, 60)
}

export const saludo = (nombre: string, idioma: Idioma = idiomaActual()): string =>
  nombre ? traducir(idioma, 'bienvenida.saludo', { nombre }) : traducir(idioma, 'bienvenida.saludoSolo')

export const tituloDe = (paso: Paso, idioma: Idioma = idiomaActual()): string => traducir(idioma, `bienvenida.titulo.${paso}`)

// Lo que dice la mascota (y lo que sale en pantalla debajo de su cara).
export function textoMascota(paso: Paso, nombre: string, modo: Modo = 'completa', idioma: Idioma = idiomaActual()): string {
  if (paso === 'cuenta') {
    if (modo === 'reconectar') return traducir(idioma, 'bienvenida.mascota.reconectar')
    const limpio = limpiarNombre(nombre)
    return limpio ? traducir(idioma, 'bienvenida.mascota.cuentaNombre', { nombre: limpio }) : traducir(idioma, 'bienvenida.mascota.cuenta')
  }
  return traducir(idioma, `bienvenida.mascota.${paso}`)
}

// Lo que dice en voz alta al probar.
export const fraseDePrueba = (nombre: string, idioma: Idioma = idiomaActual()): string =>
  traducir(idioma, 'bienvenida.fraseDePrueba', { saludo: saludo(limpiarNombre(nombre), idioma) })

// ===== La prueba: dos resultados, voz y Claude =====

export interface Resultado {
  ok: boolean
  texto: string
}

// El navegador no puede saber si de verdad se oye: solo si ha podido empezar a hablar.
export const resultadoVoz = (pudoHablar: boolean, idioma: Idioma = idiomaActual()): Resultado => ({
  ok: pudoHablar,
  texto: traducir(idioma, pudoHablar ? 'bienvenida.prueba.vozOk' : 'bienvenida.prueba.vozMal'),
})

export const resultadoClaude = (r: { ok: boolean; cuenta: boolean }, idioma: Idioma = idiomaActual()): Resultado =>
  r.ok
    ? { ok: true, texto: traducir(idioma, 'bienvenida.prueba.claudeOk') }
    : { ok: false, texto: traducir(idioma, r.cuenta ? 'bienvenida.prueba.claudeNoContesta' : 'bienvenida.prueba.claudeNoEntra') }

export const trasLaPrueba = (modo: Modo, idioma: Idioma = idiomaActual()): string => traducir(idioma, `bienvenida.tras.${modo}`)

// ===== La conexión con Claude =====

export type FaseCuenta = 'conectada' | 'inicio' | 'abriendo' | 'codigo' | 'enviando' | 'lista' | 'error' | 'sinpty'

export const pasosConexion = (idioma: Idioma = idiomaActual()): string[] =>
  [1, 2, 3].map((n) => traducir(idioma, `bienvenida.conexion.${n}` as Clave))

// Sin pty (el desarrollo en Windows) el servidor no puede hacer el alta: lo dice sin jerga (cerebro/cuenta.py).
export const esSinPty = (texto: string | null | undefined): boolean => /con la que iniciaste sesión|you signed in with/i.test(texto ?? '')

// Sin pty (puede = false) no hay alta posible: con cuenta, se ve cuál es; sin ella, el aviso llano y «Seguir».
export const inicialCuenta = (conectada: boolean, puede = true): EstadoCuenta => ({
  ...CUENTA_INICIAL,
  fase: conectada ? 'conectada' : puede ? 'inicio' : 'sinpty',
})

export interface EstadoCuenta {
  fase: FaseCuenta
  enlace: string | null
  error: string | null
}

export type EventoCuenta =
  | { tipo: 'pulsar' }
  | { tipo: 'enlace'; enlace: string }
  | { tipo: 'enviar' }
  | { tipo: 'conectada' }
  | { tipo: 'fallo'; mensaje: string }
  | { tipo: 'reiniciar' }
  | { tipo: 'otra' } // «Conectar otra cuenta»
  | { tipo: 'volver' } // de «sin pty» a la cuenta que ya había

export const CUENTA_INICIAL: EstadoCuenta = { fase: 'inicio', enlace: null, error: null }

// «Conectar» → pide el enlace → espera el código → lo envía → conectada. Cualquier fallo deja «Probar otra vez», que
// vuelve al principio (el servidor cierra la sesión anterior y abre otra con un enlace nuevo).
export function reducirCuenta(e: EstadoCuenta, ev: EventoCuenta): EstadoCuenta {
  switch (ev.tipo) {
    case 'pulsar':
      return e.fase === 'inicio' ? { fase: 'abriendo', enlace: null, error: null } : e
    case 'enlace':
      return e.fase === 'abriendo' ? { fase: 'codigo', enlace: ev.enlace, error: null } : e
    case 'enviar':
      return e.fase === 'codigo' ? { ...e, fase: 'enviando', error: null } : e
    case 'conectada':
      return e.fase === 'enviando' ? { fase: 'lista', enlace: null, error: null } : e
    case 'fallo':
      if (e.fase === 'abriendo' && esSinPty(ev.mensaje)) return { fase: 'sinpty', enlace: null, error: null }
      return e.fase === 'abriendo' || e.fase === 'enviando' ? { fase: 'error', enlace: null, error: ev.mensaje } : e
    case 'reiniciar':
      return CUENTA_INICIAL
    case 'otra':
      return e.fase === 'conectada' ? CUENTA_INICIAL : e
    case 'volver':
      return e.fase === 'sinpty' ? { ...CUENTA_INICIAL, fase: 'conectada' } : e
  }
}

// El código que enseña Claude, tal como se pega (con espacios o saltos de línea de más).
export const codigoLimpio = (texto: string): string => texto.replace(/\s+/g, '')

export const codigoPosible = (texto: string): boolean => codigoLimpio(texto).length >= 8

// Solo se abre en otra pestaña un enlace https de Claude: lo que llega del servidor no se abre a ciegas.
export function enlaceSeguro(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/.test(u.hostname)
  } catch {
    return false
  }
}

// El fallo del servidor cuando claude dice que la cuenta no vale (cerebro/cuenta.py, MENSAJE_CUENTA).
export const esErrorDeCuenta = (texto: string | null | undefined): boolean => /cuenta de Claude no está conectada/i.test(texto ?? '')

export const EVENTO_CUENTA_CAIDA = 'magister-cuenta-caida'
export const EVENTO_BIENVENIDA = 'magister-bienvenida'

// ===== Adónde lleva cada botón =====

export const RUTA_PLAN = '#/nuevo-plan' // el cuestionario de «Crear mi plan»
export const RUTA_APUNTES = '#/temas' // Biblioteca > Tus fuentes, donde se suben los ficheros
