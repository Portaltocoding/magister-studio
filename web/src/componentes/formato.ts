import { idiomaActual, t, type Clave } from '../i18n/i18n.ts'

// Números, fechas, plurales y títulos tal como se leen en España. Puro (sin React ni navegador), con pruebas en
// web/pruebas/formato.test.ts.

// 2.5 -> «2,5»; 3 -> «3». Redondea a `decimales` y quita los ceros que sobran.
export function numero(n: number | null | undefined, decimales = 1): string {
  if (n == null || !Number.isFinite(n)) return '0'
  const f = 10 ** decimales
  const x = String(Math.round(n * f) / f)
  return idiomaActual() === 'en' ? x : x.replace('.', ',')
}

// Lo mismo con las palabras del diccionario (la de uno y la de varios).
export const pluralT = (n: number, uno: Clave, varios: Clave) => plural(n, t(uno), t(varios))

// «1 sesión», «3 sesiones».
export const plural = (n: number, uno: string, varios: string) => `${numero(n, 2)} ${n === 1 ? uno : varios}`

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const MESES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// «2026-11-20» -> «20 de noviembre de 2026». Lo que no es una fecha ISO sale tal cual.
export function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return iso
  if (idiomaActual() === 'en') return `${MESES_EN[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`
}

// El aviso de la propuesta de plan cuando ya tienes uno aceptado del mismo tema (campo `sustituye`): qué tiene el que
// se va y qué se conserva en las lecciones que siguen.
export function textoSustituye(s: {
  horas_hechas?: number | null
  conserva?: { lecciones?: string[] | null; horas_hechas?: number | null; fuentes?: number | null } | null
}): string {
  const horas = s.horas_hechas ?? 0
  const hecho = horas > 0 ? t('sust.con', { h: numero(horas), hechas: horas === 1 ? t('sust.horaHecha') : t('sust.horasHechas') }) : t('sust.sinHoras')
  const c = s.conserva
  const partes = [
    c?.horas_hechas ? `${numero(c.horas_hechas)} h` : '',
    c?.fuentes ? pluralT(c.fuentes, 'sust.fuente', 'sust.fuentes') : '',
  ].filter(Boolean)
  let conserva = ''
  // «se conserva 1 fuente», «se conservan 2,5 h y 12 fuentes».
  const una = partes.length === 1 && (c?.horas_hechas === 1 || (!c?.horas_hechas && c?.fuentes === 1))
  if (partes.length) conserva = t('sust.conserva', { verbo: una ? t('sust.seConserva') : t('sust.seConservan'), partes: partes.join(t('sust.y')) })
  else if (c?.lecciones?.length) conserva = t('sust.sinNada', { n: pluralT(c.lecciones.length, 'sust.leccionSigue', 'sust.leccionesSiguen') })
  else if (c) conserva = t('sust.nada')
  return t('sust.aviso', { hecho, conserva })
}

// Un título de como mucho `max` caracteres, cortado por palabra y con «…» si se ha cortado.
export function cortarTitulo(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  if (limpio.length <= max) return limpio
  const hueco = max - 1 // lo que ocupa «…»
  let corte = limpio.lastIndexOf(' ', hueco)
  // Una sola palabra larguísima (una URL): se corta donde toque.
  if (corte < hueco / 2) corte = hueco
  return `${limpio.slice(0, corte).replace(/[\s,.;:–-]+$/, '')}…`
}
