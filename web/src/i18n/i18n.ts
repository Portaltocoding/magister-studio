// Traducción mínima, sin dependencias: un diccionario por idioma y `t(clave, vars)`. El español manda: es el idioma de
// partida, el de reserva si falta una clave en inglés y el tipo de las claves (`Clave`). Puro y con pruebas en
// web/pruebas/i18n.test.ts; el hook que sigue a `preferencias.idioma` está en usarIdioma.ts.
import { es } from './es.ts'
import { en } from './en.ts'

export type Idioma = 'es' | 'en'
export type Clave = keyof typeof es
export type Vars = Record<string, string | number>

export const IDIOMAS: { id: Idioma; nombre: string }[] = [
  { id: 'es', nombre: 'Español' },
  { id: 'en', nombre: 'English' },
]

export const DICCIONARIOS: Record<Idioma, Record<string, string>> = { es, en }

export const esIdioma = (x: unknown): x is Idioma => x === 'es' || x === 'en'

// Sustituye {nombre} por vars.nombre; un hueco sin valor se deja tal cual.
export function rellenar(texto: string, vars?: Vars): string {
  if (!vars) return texto
  return texto.replace(/\{(\w+)\}/g, (hueco, k: string) => (k in vars ? String(vars[k]) : hueco))
}

// Puro: el idioma entra como argumento. Con una clave que falta en ese idioma, el español; sin ella, la propia clave.
export function traducir(idioma: Idioma, clave: Clave, vars?: Vars): string {
  return rellenar(DICCIONARIOS[idioma][clave] ?? es[clave] ?? clave, vars)
}

// ===== El idioma de ahora =====
// Se recuerda en este navegador para que la bienvenida y la barra salgan en tu idioma antes de que lleguen las
// preferencias del servidor, que son las que mandan (preferencias.ts llama a `fijarIdioma`).
const CLAVE_IDIOMA = 'magister-idioma'
export const EVENTO_IDIOMA = 'magister-idioma'

function guardado(): Idioma {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(CLAVE_IDIOMA)
    return esIdioma(v) ? v : 'es'
  } catch {
    return 'es'
  }
}

let actual: Idioma = guardado()

export const idiomaActual = (): Idioma => actual

export function fijarIdioma(idioma: Idioma): void {
  if (idioma === actual) return
  actual = idioma
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CLAVE_IDIOMA, idioma)
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO_IDIOMA, { detail: idioma }))
}

// Para el código que no es un componente (errores, textos de la voz): traduce al idioma de ahora.
export const t = (clave: Clave, vars?: Vars): string => traducir(actual, clave, vars)
