// La bienvenida de la primera vez: qué pasos hay, cuáles se saltan y cómo avanza la conexión con Claude. Puro, con
// pruebas en web/pruebas/bienvenida.test.ts; Bienvenida.tsx solo pinta y llama a la API.

export type Paso = 'nombre' | 'cuenta' | 'prueba' | 'plan' | 'apuntes'

// «completa»: la primera vez (o «Ver la bienvenida otra vez» en Ajustes). «reconectar»: ya la viste, pero la cuenta de
// Claude ha caducado: solo se vuelve al paso de Claude y a la prueba.
export type Modo = 'completa' | 'reconectar'

export interface EstadoBienvenida {
  estado: 'pendiente' | 'hecha' | 'omitida'
  nombre: string
  cuenta: { conectada: boolean; caida: boolean }
}

// null: no hay nada que enseñar.
export function modoDe(e: Pick<EstadoBienvenida, 'estado' | 'cuenta'>): Modo | null {
  if (e.estado === 'pendiente') return 'completa'
  return e.cuenta.caida ? 'reconectar' : null
}

// El paso de Claude se enseña siempre: si ya hay cuenta, dice cuál está conectada y deja cambiarla.
export function pasosDe(modo: Modo): Paso[] {
  if (modo === 'reconectar') return ['cuenta', 'prueba']
  return ['nombre', 'cuenta', 'prueba', 'plan', 'apuntes']
}

export const siguiente = (pasos: Paso[], actual: Paso): Paso | null => pasos[pasos.indexOf(actual) + 1] ?? null

export const posicion = (pasos: Paso[], actual: Paso): { n: number; de: number } => ({ n: pasos.indexOf(actual) + 1, de: pasos.length })

// ===== Textos =====

export function limpiarNombre(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, 60)
}

export const saludo = (nombre: string): string => (nombre ? `Hola, ${nombre}` : 'Hola')

export const TITULOS: Record<Paso, string> = {
  nombre: '¿Cómo te llamo?',
  cuenta: 'Tu cuenta de Claude',
  prueba: 'Una prueba rápida',
  plan: '¿Qué quieres aprender?',
  apuntes: '¿Tienes apuntes o PDF?',
}

// Lo que dice la mascota (y lo que sale en pantalla debajo de su cara).
export function textoMascota(paso: Paso, nombre: string, modo: Modo = 'completa'): string {
  switch (paso) {
    case 'nombre':
      return 'Hola, soy Magister, tu tutor. Vamos a dejarlo todo listo en un momento. ¿Cómo quieres que te llame?'
    case 'cuenta':
      return modo === 'reconectar'
        ? 'Tu conexión con Claude ha caducado o ya no vale. Se arregla en un minuto: vuelve a conectarla.'
        : `${nombre ? `${limpiarNombre(nombre)}, p` : 'P'}ara pensar y explicarte uso tu cuenta de Claude. Te enseño cuál tengo conectada.`
    case 'prueba':
      return 'Pulsa el botón: te saludaré en voz alta y le haré una pregunta corta a Claude.'
    case 'plan':
      return 'Cuéntame qué quieres aprender y te preparo un plan con sus lecciones, fechas y fuentes.'
    case 'apuntes':
      return 'Si ya tienes apuntes o PDF, súbelos y estudiaremos con lo tuyo. También puedes hacerlo luego.'
  }
}

// Lo que dice en voz alta al probar.
export const fraseDePrueba = (nombre: string): string =>
  `${saludo(limpiarNombre(nombre))}. Soy Magister, tu tutor. Si me estás oyendo, la voz funciona.`

// ===== La prueba: dos resultados, voz y Claude =====

export interface Resultado {
  ok: boolean
  texto: string
}

// El navegador no puede saber si de verdad se oye: solo si ha podido empezar a hablar.
export const resultadoVoz = (pudoHablar: boolean): Resultado =>
  pudoHablar
    ? { ok: true, texto: 'Voz: te he saludado. Si no me has oído, sube el volumen y pulsa «Probar otra vez».' }
    : { ok: false, texto: 'Voz: no he podido hablar desde este navegador. Sube el volumen, mira que no esté en silencio y pulsa «Probar otra vez».' }

export const resultadoClaude = (r: { ok: boolean; cuenta: boolean }): Resultado =>
  r.ok
    ? { ok: true, texto: 'Claude: me ha contestado, tu cuenta funciona.' }
    : r.cuenta
      ? { ok: false, texto: 'Claude: no me ha contestado. Pulsa «Probar otra vez» en un momento.' }
      : { ok: false, texto: 'Claude: no me deja entrar con esta cuenta. Conecta tu cuenta y vuelve a probar.' }

export const TRAS_LA_PRUEBA: Record<Modo, string> = {
  completa: 'Lo siguiente: me cuentas qué quieres aprender y te preparo tu plan.',
  reconectar: 'Ya está: puedes seguir con lo tuyo.',
}

// ===== La conexión con Claude =====

export type FaseCuenta = 'conectada' | 'inicio' | 'abriendo' | 'codigo' | 'enviando' | 'lista' | 'error' | 'sinpty'

export const PASOS_CONEXION = [
  'Pulsa «Abrir Claude»: se abre la página de Claude.',
  'Inicia sesión y pulsa «Authorize».',
  'Claude te enseña un código: cópialo y pégalo aquí.',
]

// Sin pty (el desarrollo en Windows) el servidor no puede hacer el alta: lo dice sin jerga (cerebro/cuenta.py).
export const esSinPty = (texto: string | null | undefined): boolean => /versión de Docker/i.test(texto ?? '')

export const inicialCuenta = (conectada: boolean): EstadoCuenta => ({ ...CUENTA_INICIAL, fase: conectada ? 'conectada' : 'inicio' })

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
