// Ningún fallo se enseña como texto técnico crudo. `errorLegible` traduce los errores que conocemos del servidor
// (trabajos, el modelo, la base de datos) a una frase que dice qué ha pasado y qué hacer, y guarda el original en
// `detalle` para poder copiarlo. Un texto que ya se entiende sale tal cual, con `detalle` a null.
// Los patrones salen de servidor/src/magister: trabajos/trabajador.py, cerebro/modelo.py, cerebro/estructura.py y
// cerebro/freno.py. Si allí cambia un mensaje, se cambia aquí.
// Las frases que se enseñan viven en el diccionario (i18n/es.ts, i18n/en.ts) y salen en el idioma de ahora.
import { DICCIONARIOS, idiomaActual, traducir, type Clave, type Idioma } from '../i18n/i18n.ts'

export interface Legible {
  mensaje: string
  detalle: string | null
}

// La versión en español: la que el servidor, las pruebas y lo ya guardado conocen.
const en_es = (c: Clave) => traducir('es', c)
export const MENSAJE_FRENO = en_es('err.freno')
export const MENSAJE_ESTRUCTURA = en_es('err.estructura')
// Enviar un mensaje sin conexión (el texto vuelve a la caja, usarConversacion.ts).
export const MENSAJE_SIN_CONEXION = en_es('err.sinConexion')
export const mensajeSinConexion = (idioma: Idioma = idiomaActual()) => traducir(idioma, 'err.sinConexion')
// Vale en cualquiera de los dos idiomas: la burbuja pudo guardarse antes de cambiar de idioma.
export const esSinConexion = (texto: string | undefined) => !!texto && Object.values(DICCIONARIOS).some((d) => d['err.sinConexion'] === texto)

// Un 422 de FastAPI trae una lista de fallos de validación en inglés («String should have at least 1 character»). Se
// dice en el idioma de la pantalla, una sola vez cada cosa: los de nuestros validadores («Value error, el mensaje está
// vacío») ya vienen en castellano; el resto se resume en una frase general.
export function textoValidacion(fallos: { msg?: unknown; loc?: unknown }[], idioma: Idioma = idiomaActual()): string {
  const general = traducir(idioma, 'err.valida.general')
  const dato = traducir(idioma, 'err.valida.dato')
  const frases: string[] = []
  for (const f of fallos) {
    const msg = typeof f.msg === 'string' ? f.msg : ''
    const campo = Array.isArray(f.loc) ? String(f.loc[f.loc.length - 1] ?? '') : ''
    let frase: string
    const propio = /^(?:Value error|Assertion failed),\s*(.+)$/.exec(msg)
    if (propio) frase = propio[1]
    else if (campo === 'contenido' && /at least 1 character|Field required/i.test(msg)) frase = traducir(idioma, 'err.valida.vacio')
    else if (/at most \d+ characters?/i.test(msg)) frase = traducir(idioma, 'err.valida.largo')
    else frase = dato
    frase = frase.charAt(0).toUpperCase() + frase.slice(1).replace(/\.$/, '')
    if (!frases.includes(frase)) frases.push(frase)
  }
  if (!frases.length) return general
  if (frases.length === 1 && frases[0] === dato) return general
  return `${frases.join('. ')}.`
}

// Frases ya legibles que llegan tal cual, en cualquiera de los dos idiomas: se enseñan en el idioma que toca.
const YA_LEGIBLES: Clave[] = ['err.freno', 'err.estructura']
const claveYaLegible = (texto: string): Clave | undefined => YA_LEGIBLES.find((c) => Object.values(DICCIONARIOS).some((d) => d[c] === texto))

// En orden: la primera que encaja manda. Las causas concretas (el freno, un plazo) van antes que el envoltorio
// («tras 5 intentos: …», «N intentos sin salida válida; último: error del modelo: plazo agotado»).
const REGLAS: [RegExp, Clave][] = [
  [/freno:|por demasiadas llamadas seguidas/i, 'err.freno'],
  [/cuenta de Claude no está conectada/i, 'err.cuenta'],
  [/en pausa tras varios fallos seguidos/i, 'err.pausaFallos'],
  [/no encuentro el programa claude/i, 'err.sinClaude'],
  [/usage limit|hit your limit|limit reached|rate[ _-]?limit|\b429\b/i, 'err.limite'],
  [/overloaded|\b529\b/i, 'err.saturado'],
  [/plazo agotado|tard[oó] m[aá]s de \d+|TimeoutError|timed out/i, 'err.plazo'],
  [/intentos sin salida v[aá]lida|no devolvi[oó] salida estructurada|ValidationError/i, 'err.estructura'],
  [/asyncpg|sqlalchemy|OperationalError|InterfaceError|PostgresError|could not connect to server|connection was closed/i, 'err.baseDatos'],
  [/Connection(Refused|Reset|Aborted)?Error|Failed to fetch|NetworkError|Load failed/i, 'err.red'],
  [/ErrorModelo|claude (sali[oó] con c[oó]digo|termin[oó] sin resultado)|error del modelo/i, 'err.modelo'],
  [/^Internal Server Error$/i, 'err.servidor'],
  [/^tras \d+ intentos/i, 'err.intentos'],
  [/Traceback|tipo de trabajo desconocido|historial vac[ií]o|\[(Errno|WinError) \d+\]|Cannot read propert|is not a function|is not defined|Unexpected token/i, 'err.interno'],
  // Un nombre de clase: «KeyError: …», «RoadmapGen: …».
  [/\b[A-Z][A-Za-z]*(Error|Exception)\b|^[A-Z][a-z]+[A-Z]\w*:/, 'err.interno'],
]

const claveDe = (texto: string): Clave | null => REGLAS.find(([patron]) => patron.test(texto))?.[1] ?? null

// «No he podido cancelar: ErrorModelo: …»: se guarda lo que ya decía la pantalla y se traduce el resto.
const CON_PREFIJO = /^(no (?:he podido|se pudo|se pudieron|se ha)\b[^:.]*)[:.]\s+([\s\S]+)$/i

export function errorLegible(texto: string | null | undefined, idioma: Idioma = idiomaActual()): Legible {
  // `String(e)` de un Error de JavaScript antepone «Error: »; eso no le dice nada a nadie.
  const limpio = (texto ?? '').trim().replace(/^Error:\s*/, '')
  if (!limpio) return { mensaje: traducir(idioma, 'err.desconocido'), detalle: null }
  const ya = claveYaLegible(limpio)
  if (ya) return { mensaje: traducir(idioma, ya), detalle: null }
  const partes = CON_PREFIJO.exec(limpio)
  if (partes) {
    const resto = partes[2].trim()
    if (claveYaLegible(resto)) return { mensaje: limpio, detalle: null }
    const clave = claveDe(resto)
    if (!clave) return { mensaje: limpio, detalle: null }
    const prefijo = partes[1].charAt(0).toUpperCase() + partes[1].slice(1)
    return { mensaje: `${prefijo}. ${traducir(idioma, clave)}`, detalle: limpio }
  }
  const clave = claveDe(limpio)
  return clave ? { mensaje: traducir(idioma, clave), detalle: limpio } : { mensaje: limpio, detalle: null }
}
