// Qué sale primero en Ctrl+K. Puro, con pruebas en web/pruebas/buscarPaleta.test.ts.
// Todas las palabras escritas tienen que estar en el texto, la descripción o el grupo; entre las que encajan, gana el
// nombre: igual a lo escrito, luego que empieza por ello, luego con una palabra que empieza por ello, luego que lo
// contiene, y al final las que solo encajan por la descripción («roadmap» en la ayuda de Proyectos).

export interface EntradaBuscable {
  grupo: string
  texto: string
  detalle?: string
}

export const plano = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

function puntuar(e: EntradaBuscable, consulta: string, palabras: string[]): number | null {
  const texto = plano(e.texto)
  const todo = `${texto} ${plano(e.detalle ?? '')} ${plano(e.grupo)}`
  if (!palabras.every((w) => todo.includes(w))) return null
  if (texto === consulta) return 0
  if (texto.startsWith(consulta)) return 1
  const enTexto = palabras.every((w) => texto.includes(w))
  if (enTexto && palabras.every((w) => texto.split(/[\s·,.:;()«»"'-]+/).some((t) => t.startsWith(w)))) return 2
  if (enTexto) return 3
  return 4
}

export function filtrarPaleta<E extends EntradaBuscable>(entradas: E[], q: string, max = 14): E[] {
  const consulta = plano(q).replace(/\s+/g, ' ')
  const palabras = consulta.split(' ').filter(Boolean)
  if (!palabras.length) return entradas.filter((e) => e.grupo !== 'Conversaciones' && e.grupo !== 'Conversations').slice(0, max)
  return entradas
    .map((e, i) => ({ e, i, p: puntuar(e, consulta, palabras) }))
    .filter((x): x is { e: E; i: number; p: number } => x.p != null)
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .slice(0, max)
    .map((x) => x.e)
}
