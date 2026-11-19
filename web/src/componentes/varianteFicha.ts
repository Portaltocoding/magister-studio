// Con qué estilo se pinta la ficha (los apuntes) de una lección. Solo cambia la presentación, nunca el contenido:
// «limpia» (estilo C, sobria), «cuaderno» (estilo D: hoja, margen con etiquetas, resaltador y notas al margen) y
// «mixta» (C con el resaltador y las notas al margen de D). Las reglas CSS cuelgan de `data-ficha` en .lector-texto.
//
// El frontend no sabe si una lección es «de conceptos» o «de práctica»: el plan no trae tipo y todos los apuntes
// tienen la misma forma (teoría, avisos, un repaso). Así que se reparte de forma fija por el plan y el número de la
// lección (L1, L2...): la misma lección sale siempre igual, en Lecciones y en el foco.
//
// Cada tanda de cuatro lecciones seguidas (L1-L4, L5-L8...) lleva una mixta, una limpia, una cuaderno y una cuarta
// limpia o cuaderno, en un orden que sale del plan y de la tanda. Si ese orden dejara tres iguales seguidas (o dos
// mixtas seguidas) al juntarlo con la tanda anterior, se toma el siguiente orden posible.

export type VarianteFicha = 'limpia' | 'cuaderno' | 'mixta'

// FNV-1a de 32 bits: un número estable a partir de un texto.
function resumen(t: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

// Los órdenes distintos de cuatro elementos (con uno repetido salen 12).
function ordenes(xs: VarianteFicha[]): VarianteFicha[][] {
  if (xs.length <= 1) return [xs]
  const vistos = new Set<string>()
  const salida: VarianteFicha[][] = []
  xs.forEach((x, i) => {
    for (const resto of ordenes([...xs.slice(0, i), ...xs.slice(i + 1)])) {
      const o = [x, ...resto]
      const k = o.join()
      if (!vistos.has(k)) {
        vistos.add(k)
        salida.push(o)
      }
    }
  })
  return salida
}

// Tres iguales seguidas, o dos mixtas seguidas, en algún punto de la lista.
const hayTrio = (xs: VarianteFicha[]) =>
  xs.some((x, i) => i >= 1 && x === xs[i - 1] && (x === 'mixta' || (i >= 2 && x === xs[i - 2])))

function tanda(plan: number, t: number, antes: VarianteFicha[]): VarianteFicha[] {
  const h = resumen(`${plan}/${t}`)
  const cuarta: VarianteFicha = h & 1 ? 'limpia' : 'cuaderno'
  const posibles = ordenes(['mixta', 'limpia', 'cuaderno', cuarta])
  const inicio = (h >>> 1) % posibles.length
  const cola = antes.slice(-2)
  for (let k = 0; k < posibles.length; k++) {
    const o = posibles[(inicio + k) % posibles.length]
    if (!hayTrio([...cola, ...o])) return o
  }
  return posibles[inicio] // no pasa: siempre hay un orden que empieza por algo distinto de la última
}

// La variante de las lecciones 1..n de un plan, en orden.
export function variantesDelPlan(plan: number, n: number): VarianteFicha[] {
  const xs: VarianteFicha[] = []
  for (let t = 0; xs.length < n; t++) xs.push(...tanda(plan, t, xs))
  return xs.slice(0, n)
}

// La variante de una lección por su clave («L7») y el plan. Sin número en la clave, sale del resumen de la clave
// (una de cada cuatro, mixta), sin la garantía de no repetir tres seguidas.
export function varianteFicha(clave: string, plan = 0): VarianteFicha {
  const m = clave.match(/\d+/)
  const n = m ? Number(m[0]) : 0
  if (n >= 1 && n <= 1000) return variantesDelPlan(plan, n)[n - 1]
  const h = resumen(`${plan}/${clave}`)
  return h % 4 === 0 ? 'mixta' : (h >>> 2) & 1 ? 'limpia' : 'cuaderno'
}
