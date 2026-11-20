import { t } from '../i18n/i18n.ts'
// La pequeña biblioteca de cada lección del Roadmap: qué frase toca en cada estado. Lógica pura, sin React: se prueba
// en web/pruebas/bibliotecaLeccion.test.ts. Los tipos van escritos aquí (y no importados de api.ts) para que el test
// corra con Node sin el resto de la app.

export interface Fuente {
  titulo: string
  dominio: string
  tipo: string | null
  cubre: number[]
  estado: 'lista' | 'indexando' | 'problema' | 'propuesta'
  incompleta?: string | null
}

export interface Biblioteca {
  fuentes: Fuente[]
  sin_fuente: number[]
  research: 'sin_lanzar' | 'buscando' | 'acabada' | 'cortada'
  cobertura_conocida?: boolean
}

export type EstadoApuntes = 'sin_fuentes' | 'nuevas' | 'al_dia' | 'desconocido' | null | undefined

// «1», «1 y 3», «1, 2 y 3».
export function enLista(cosas: readonly (string | number)[]): string {
  const xs = cosas.map(String)
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

// Los tipos que pone el juez del research (research/fijo.py, `Tipo`).
const TIPOS: Record<string, string> = {
  oficial: 'documentación oficial',
  referencia: 'referencia',
  tutorial: 'tutorial',
  articulo: 'artículo',
  foro: 'foro',
  portada: 'portada',
  comercial: 'comercial',
  espejo: 'copia',
  muro: 'con muro de pago',
}

const ESTADOS: Record<Fuente['estado'], string> = {
  lista: '',
  indexando: 'indexándose',
  problema: 'no se pudo leer',
  propuesta: 'aún no ha entrado',
}

// Las que ya están (o están entrando) en tus fuentes; lo que falló o no ha entrado se cuenta aparte.
export const enTusFuentes = (b: Biblioteca) => b.fuentes.filter((f) => f.estado === 'lista' || f.estado === 'indexando')

// Una línea por fuente: «título · dominio · tipo · cubre 1 y 3», y el estado si no está lista.
export function lineaFuente(f: Fuente): string {
  const partes = [f.titulo || f.dominio]
  if (f.dominio && f.dominio !== f.titulo) partes.push(f.dominio)
  if (f.tipo) partes.push(TIPOS[f.tipo] ?? f.tipo)
  if (f.cubre.length) partes.push(`cubre ${enLista(f.cubre)}`)
  if (ESTADOS[f.estado]) partes.push(ESTADOS[f.estado])
  return partes.join(' · ')
}

// El resumen de una línea de la biblioteca plegada: «3 fuentes · cubre 3 de 4 objetivos».
export function resumenBiblioteca(b: Biblioteca, nObjetivos: number): string {
  const n = enTusFuentes(b).length
  const pendientes = b.fuentes.filter((f) => f.estado === 'propuesta').length
  const partes: string[] = []
  if (b.research === 'buscando') partes.push('Buscando fuentes…')
  if (n) partes.push(`${n} ${n === 1 ? 'fuente' : 'fuentes'}`)
  else if (b.research !== 'buscando') partes.push('Sin fuentes todavía')
  if (n && b.cobertura_conocida !== false && nObjetivos > 0) {
    const cubiertos = Math.max(0, nObjetivos - b.sin_fuente.length)
    partes.push(`cubre ${cubiertos} de ${nObjetivos} ${nObjetivos === 1 ? 'objetivo' : 'objetivos'}`)
  }
  if (pendientes) partes.push(`${pendientes} sin entrar`)
  if (b.research === 'cortada') partes.push('la búsqueda se cortó')
  return partes.join(' · ')
}

// «Sin fuente para: Calcular precisión, recall y F1 y Leer un JSON»: los nombres de los objetivos (desde 1).
export function textoSinFuente(sinFuente: readonly number[], objetivos: readonly string[]): string {
  const nombres = sinFuente.map((i) => objetivos[i - 1]).filter(Boolean)
  return nombres.length ? `Sin fuente para: ${nombres.join(' · ')}` : ''
}

// Qué decir de la búsqueda de la lección, si hay algo que decir.
export function textoResearch(r: Biblioteca['research']): string {
  if (r === 'buscando') return 'Buscando fuentes…'
  if (r === 'cortada') return 'La búsqueda se cortó.'
  return ''
}

// Los apuntes se hicieron sin las fuentes que hay ahora: el aviso con «Rehacerlos con ellas». Vacío si no toca.
// Sin fuentes del research, cuentan los fragmentos de tus fuentes que apoyan la lección (`unidad: 'fragmento'`).
export function textoApuntes(estado: EstadoApuntes, fuentes: number, unidad: 'fuente' | 'fragmento' = 'fuente'): string {
  if (fuentes < 1) return ''
  const nombre = unidad === 'fuente' ? (fuentes === 1 ? 'fuente' : 'fuentes') : fuentes === 1 ? 'fragmento de tus fuentes' : 'fragmentos de tus fuentes'
  const hay = `Ya hay ${fuentes} ${nombre} para esta lección.`
  if (estado === 'sin_fuentes') return `Estos apuntes se hicieron sin tus fuentes. ${hay}`
  if (estado === 'nuevas') return `Desde que se hicieron estos apuntes han llegado fuentes nuevas. ${hay}`
  if (estado === 'desconocido') return `Estos apuntes son de antes de que llegaran tus fuentes. ${hay}`
  return ''
}

// Un documento que entró a medias (un muro de pago, solo el resumen).
export const avisoIncompleta = (motivo: string) =>
  t('fuen.soloParte', { motivo: motivo.trim().replace(/[.\s]+$/, '') })

// Mientras alguna lección está buscando, el Roadmap se refresca; en cuanto ninguna busca, para.
export const algunaBuscando = (lecciones: readonly { biblioteca?: Biblioteca }[]) =>
  lecciones.some((l) => l.biblioteca?.research === 'buscando')

// El chip «¿hace falta buscar fuentes?» de una lección: el select enseña la etiqueta guardada (la del plan o la tuya),
// para que elegir otra la cambie de verdad; si tu material la cambia (un «no» que se busca igual), `nota` lo dice.
const NECESIDADES = ['no', 'conviene', 'imprescindible']
export function chipNecesidad(l: { necesita_fuentes?: string | null; necesita_fuentes_guardada?: string | null }): {
  valor: string
  nota: string
} {
  const efectiva = l.necesita_fuentes ?? 'conviene'
  const guardada = l.necesita_fuentes_guardada && NECESIDADES.includes(l.necesita_fuentes_guardada) ? l.necesita_fuentes_guardada : efectiva
  // «Se busca igual» chocaba con «tu material ya la cubre» en la misma fila: la nota dice solo qué etiqueta cuenta.
  return { valor: guardada, nota: guardada !== efectiva ? `tu material manda: cuenta como «${efectiva}»` : '' }
}

// Al aceptar un plan con «buscar fuentes»: las lecciones sin material que sí necesitan fuentes (las marcadas «no» se
// explican bien sin ellas; `necesita_fuentes` es la que se usa, con tu material por delante).
export function clavesParaBuscar(
  lecciones: readonly { clave: string; sin_material: boolean; necesita_fuentes?: string | null }[],
): string[] {
  return lecciones.filter((l) => l.sin_material && l.necesita_fuentes !== 'no').map((l) => l.clave)
}

// Lo que se dice al aceptar un plan con «buscar fuentes»: dos búsquedas a la vez, unos 2 minutos cada una. `lecciones`
// son las tareas que de verdad se lanzaron y `aviso`, lo que el servidor dice de las que se saltó.
export function avisoAlAceptar(lecciones: number, aviso?: string | null): string {
  const extra = aviso ? ` ${aviso}` : ''
  if (lecciones < 1) return aviso || t('acepta.sinBuscar')
  const minutos = Math.max(2, Math.ceil(lecciones / 2) * 2)
  return `${t('acepta.busco', { n: lecciones, lecciones: lecciones === 1 ? t('acepta.leccion') : t('acepta.lecciones'), min: minutos })}${extra}`
}
