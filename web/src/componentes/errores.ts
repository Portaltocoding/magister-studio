// Ningún fallo se enseña como texto técnico crudo. `errorLegible` traduce los errores que conocemos del servidor
// (trabajos, el modelo, la base de datos) a una frase que dice qué ha pasado y qué hacer, y guarda el original en
// `detalle` para poder copiarlo. Un texto que ya se entiende sale tal cual, con `detalle` a null.
// Los patrones salen de servidor/src/magister: trabajos/trabajador.py, cerebro/modelo.py, cerebro/estructura.py y
// cerebro/freno.py. Si allí cambia un mensaje, se cambia aquí.

export interface Legible {
  mensaje: string
  detalle: string | null
}

export const MENSAJE_FRENO = 'Hay demasiadas llamadas al modelo seguidas y están en pausa unos minutos. Vuelve a pedirlo luego.'
export const MENSAJE_ESTRUCTURA =
  'No he conseguido un resultado válido tras varios intentos. Vuelve a pedirlo; si se repite, cambia algo de lo que pides.'
// Enviar un mensaje sin conexión (el texto vuelve a la caja, usarConversacion.ts).
export const MENSAJE_SIN_CONEXION = 'No hay conexión con Magister. Tu mensaje sigue en la caja: vuelve a enviarlo cuando vuelva.'

// Un 422 de FastAPI trae una lista de fallos de validación en inglés («String should have at least 1 character»). Se
// dice en castellano, una sola vez cada cosa: los de nuestros validadores («Value error, el mensaje está vacío») ya
// vienen en castellano; el resto se resume en una frase general.
export function textoValidacion(fallos: { msg?: unknown; loc?: unknown }[]): string {
  const frases: string[] = []
  for (const f of fallos) {
    const msg = typeof f.msg === 'string' ? f.msg : ''
    const campo = Array.isArray(f.loc) ? String(f.loc[f.loc.length - 1] ?? '') : ''
    let frase: string
    const propio = /^(?:Value error|Assertion failed),\s*(.+)$/.exec(msg)
    if (propio) frase = propio[1]
    else if (campo === 'contenido' && /at least 1 character|Field required/i.test(msg)) frase = 'el mensaje está vacío'
    else if (/at most \d+ characters?/i.test(msg)) frase = 'el texto es demasiado largo'
    else frase = 'algún dato no es válido'
    frase = frase.charAt(0).toUpperCase() + frase.slice(1).replace(/\.$/, '')
    if (!frases.includes(frase)) frases.push(frase)
  }
  if (!frases.length) return 'Algún dato no es válido. Revisa lo que has escrito y vuelve a probar.'
  if (frases.length === 1 && frases[0] === 'Algún dato no es válido') return 'Algún dato no es válido. Revisa lo que has escrito y vuelve a probar.'
  return `${frases.join('. ')}.`
}

const MENSAJE_INTERNO ='Algo ha fallado por dentro. Vuelve a probar; si se repite, copia el detalle técnico.'

const YA_LEGIBLES = new Set([MENSAJE_FRENO, MENSAJE_ESTRUCTURA])

// En orden: la primera que encaja manda. Las causas concretas (el freno, un plazo) van antes que el envoltorio
// («tras 5 intentos: …», «N intentos sin salida válida; último: error del modelo: plazo agotado»).
const REGLAS: [RegExp, string][] = [
  [/freno:|por demasiadas llamadas seguidas/i, MENSAJE_FRENO],
  [/cuenta de Claude no está conectada/i, 'Tu cuenta de Claude no está conectada o ha caducado. Vuelve a conectarla desde Ajustes, en «Bienvenida».'],
  [/en pausa tras varios fallos seguidos/i, 'El modelo ha fallado varias veces seguidas y descansa un minuto. Vuelve a pedirlo luego.'],
  [/no encuentro el programa claude/i, 'No encuentro el programa del modelo (claude) en tu equipo. Comprueba que está instalado y reinicia Magister.'],
  [/usage limit|hit your limit|limit reached|rate[ _-]?limit|\b429\b/i, 'Has llegado al límite de uso del modelo. Vuelve a pedirlo cuando se renueve.'],
  [/overloaded|\b529\b/i, 'El modelo está saturado ahora mismo. Espera un poco y vuelve a pedirlo.'],
  [/plazo agotado|tard[oó] m[aá]s de \d+|TimeoutError|timed out/i, 'El modelo ha tardado demasiado en contestar. Vuelve a pedirlo; si se repite, pide algo más corto.'],
  [/intentos sin salida v[aá]lida|no devolvi[oó] salida estructurada|ValidationError/i, MENSAJE_ESTRUCTURA],
  [/asyncpg|sqlalchemy|OperationalError|InterfaceError|PostgresError|could not connect to server|connection was closed/i,
    'No llego a la base de datos. Comprueba que está en marcha y vuelve a probar.'],
  [/Connection(Refused|Reset|Aborted)?Error|Failed to fetch|NetworkError|Load failed/i, 'Se ha cortado la conexión. Vuelve a probar en un momento.'],
  [/ErrorModelo|claude (sali[oó] con c[oó]digo|termin[oó] sin resultado)|error del modelo/i, 'El modelo ha fallado al contestar. Vuelve a pedirlo en un momento.'],
  [/^Internal Server Error$/i, 'Algo ha fallado en el servidor. Vuelve a probar; si se repite, reinicia Magister.'],
  [/^tras \d+ intentos/i, 'No ha salido tras varios intentos. Vuelve a pedirlo en un rato.'],
  [/Traceback|tipo de trabajo desconocido|historial vac[ií]o|\[(Errno|WinError) \d+\]|Cannot read propert|is not a function|is not defined|Unexpected token/i,
    MENSAJE_INTERNO],
  // Un nombre de clase: «KeyError: …», «RoadmapGen: …».
  [/\b[A-Z][A-Za-z]*(Error|Exception)\b|^[A-Z][a-z]+[A-Z]\w*:/, MENSAJE_INTERNO],
]

const traducir = (texto: string): string | null => REGLAS.find(([patron]) => patron.test(texto))?.[1] ?? null

// «No he podido cancelar: ErrorModelo: …»: se guarda lo que ya decía la pantalla y se traduce el resto.
const CON_PREFIJO = /^(no (?:he podido|se pudo|se pudieron|se ha)\b[^:.]*)[:.]\s+([\s\S]+)$/i

export function errorLegible(texto: string | null | undefined): Legible {
  // `String(e)` de un Error de JavaScript antepone «Error: »; eso no le dice nada a nadie.
  const limpio = (texto ?? '').trim().replace(/^Error:\s*/, '')
  if (!limpio) return { mensaje: 'Algo ha fallado, pero no sé qué. Vuelve a probar.', detalle: null }
  if (YA_LEGIBLES.has(limpio)) return { mensaje: limpio, detalle: null }
  const partes = CON_PREFIJO.exec(limpio)
  if (partes) {
    const resto = partes[2].trim()
    if (YA_LEGIBLES.has(resto)) return { mensaje: limpio, detalle: null }
    const traducido = traducir(resto)
    if (!traducido) return { mensaje: limpio, detalle: null }
    const prefijo = partes[1].charAt(0).toUpperCase() + partes[1].slice(1)
    return { mensaje: `${prefijo}. ${traducido}`, detalle: limpio }
  }
  const traducido = traducir(limpio)
  return traducido ? { mensaje: traducido, detalle: limpio } : { mensaje: limpio, detalle: null }
}
