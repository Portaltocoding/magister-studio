import { frases, paraLeer } from './voz.ts'

// La clase por voz a partir de los apuntes. No se leen enteros (secciones de 30 frases con código, tablas y fórmulas
// no se entienden de oído): por apartado se dice el arranque, una idea por subtítulo, el aviso («ojo con esto») y la
// frase con la que quedarse. El glosario y el repaso no se narran: el glosario sale en las notas de la llamada y el
// repaso lleva las respuestas. Lo que se ve (código, fórmulas, el diagrama) va a la pizarra.

export interface FraseClase {
  marca: string
  texto: string
  bloque?: string // la clave del apartado (b1, b2…), para la pizarra
  pregunta?: string // la clase se para aquí: el tutor te ha preguntado esto y espera tu respuesta
}

// Como un profesor, pregunta de vez en cuando, no tras cada apartado: tras el segundo, el cuarto y el sexto (si
// tienen pregunta preparada), como mucho tres por clase. La pregunta va al final del apartado, antes del siguiente.
export function conPreguntas(lista: FraseClase[], preguntas: Record<string, string>, maximo = 3): FraseClase[] {
  const orden = [...new Set(lista.map((x) => x.bloque).filter((b): b is string => !!b))]
  const toca = new Set(orden.filter((b, i) => i % 2 === 1 && preguntas[b]).slice(0, maximo))
  const salida: FraseClase[] = []
  lista.forEach((x, i) => {
    salida.push(x)
    const fin = x.bloque && toca.has(x.bloque) && lista[i + 1]?.bloque !== x.bloque
    if (fin && x.bloque) {
      const enunciado = preguntas[x.bloque].trim()
      salida.push({ marca: x.marca, bloque: x.bloque, pregunta: enunciado, texto: `Antes de seguir, te pregunto una cosa. ${enunciado}` })
    }
  })
  return salida
}

export interface BloqueContrato {
  clave: string
  titulo: string
}

const NUMEROS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez']
const numero = (n: number) => NUMEROS[n] ?? String(n)

// Una cabecera «## Título {.nb etq="Teoría · 2 de 5"}» -> el título, y si la sección no se narra.
export function cabecera(linea: string): { titulo: string; saltar: boolean } {
  const titulo = linea.replace(/^#+\s*/, '').replace(/\s*\{[^}]*\}\s*$/, '').trim()
  const saltar = /etq="[^"]*(Definiciones|Práctica|Repaso)/i.test(linea) || /^(las palabras de la lección|repaso)/i.test(titulo)
  return { titulo, saltar }
}

interface Partes {
  parrafos: string[] // fuera de recuadros, en orden, con los «### » como «§Título»
  avisos: string[]
  ideas: string[]
}

// Separa el cuerpo de un apartado de sus recuadros (::: aviso, ::: frase…). Los envoltorios (teoria, capitulo,
// practica) no cuentan: su texto es cuerpo. Código, fórmulas en bloque y tablas no se narran.
function partir(seccion: string): Partes {
  const partes: Partes = { parrafos: [], avisos: [], ideas: [] }
  const pila: string[] = []
  let actual: string[] = []
  let dentroCodigo = false
  let dentroFormula = false
  const cerrar = () => {
    const t = actual.join('\n').trim()
    actual = []
    if (!t) return
    const tipo = [...pila].reverse().find((x) => ['aviso', 'frase', 'marco', 'rejilla'].includes(x))
    if (tipo === 'aviso') partes.avisos.push(t)
    else if (tipo === 'frase') partes.ideas.push(t)
    else if (!tipo) partes.parrafos.push(t)
  }
  for (const linea of seccion.split('\n')) {
    const l = linea.trim()
    if (l.startsWith('```')) {
      cerrar()
      dentroCodigo = !dentroCodigo
      continue
    }
    if (dentroCodigo) continue
    if (l.startsWith('$$')) {
      cerrar()
      if (!(l.length > 2 && l.endsWith('$$'))) dentroFormula = !dentroFormula
      continue
    }
    if (dentroFormula) continue
    const recuadro = l.match(/^:::+\s*([\w-]+)?/)
    if (recuadro) {
      cerrar()
      if (recuadro[1]) pila.push(recuadro[1].toLowerCase())
      else pila.pop()
      continue
    }
    if (l.startsWith('|')) continue
    if (/^###\s+/.test(l)) {
      cerrar()
      partes.parrafos.push(`§${cabecera(l).titulo}`)
      continue
    }
    if (!l) {
      cerrar()
      continue
    }
    actual.push(linea)
  }
  cerrar()
  return partes
}

// Frases dichas de un trozo de apuntes, ya para la voz. Una frase que anunciaba algo que no se dice («…así:»,
// «…con dos bucles:») acaba en punto; los trozos de menos de cuatro palabras se juntan con el siguiente.
export function decible(t: string): string[] {
  const limpio = paraLeer(
    t
      .replace(/^\*\*(.+?)\*\*\s*$/gm, '$1:')
      // Código en línea con llaves, comillas o etiquetas no se entiende de oído: se ve en la pizarra.
      .replace(/`[^`]*[{}"=<>][^`]*`/g, 'lo que tienes en la pizarra'),
  )
  const salida: string[] = []
  for (const f of frases(limpio)) {
    const x = f.replace(/[:;]\s*$/, '.').trim()
    if (!x || x === '.') continue
    const previa = salida[salida.length - 1]
    if (previa && previa.split(/\s+/).length < 4) salida[salida.length - 1] = `${previa.replace(/[.:]$/, ':')} ${x}`
    else salida.push(x)
  }
  return salida
}

// Las frases de un apartado: arranque (hasta 3), y por cada subtítulo, su nombre y su primera idea (hasta 2 frases);
// después el aviso y la idea con la que quedarse.
export function narrarApartado(seccion: string, bloque: string | undefined, titulo: string, n: number, total: number): FraseClase[] {
  const marca = `la parte «${titulo}»`
  const p = partir(seccion.replace(/^##\s.*\n?/, ''))
  // «El estado…» tras dos puntos sigue la frase: en minúscula (salvo siglas como REST).
  const seguir = (f: string) => (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(f) ? f[0].toLowerCase() + f.slice(1) : f)
  const salida: FraseClase[] = [{ marca, bloque, texto: n === 1 ? `Empezamos con ${titulo}.` : n === total ? `Y por último, ${titulo}.` : `Pasamos a ${titulo}.` }]
  const decir = (xs: string[]) => xs.forEach((texto) => salida.push({ marca, bloque, texto }))
  let i = 0
  const arranque: string[] = []
  while (i < p.parrafos.length && !p.parrafos[i].startsWith('§') && arranque.length < 3) arranque.push(...decible(p.parrafos[i++]))
  decir(arranque.slice(0, 3))
  for (; i < p.parrafos.length; i++) {
    if (!p.parrafos[i].startsWith('§')) continue
    const sub = p.parrafos[i].slice(1)
    const siguiente = p.parrafos[i + 1]
    const idea = siguiente && !siguiente.startsWith('§') ? decible(siguiente).slice(0, 2) : []
    if (!idea.length) continue
    // Si la primera frase ya nombra el subtítulo, no se dice dos veces.
    if (!idea[0].toLowerCase().includes(sub.toLowerCase())) salida.push({ marca, bloque, texto: `${sub}.` })
    decir(idea)
  }
  for (const a of p.avisos.slice(0, 1)) {
    const fs = decible(a).slice(0, 3)
    if (!fs.length) continue
    const tipico = fs[0].match(/^El error típico:\s*(.+)$/i)
    decir([tipico ? `Ojo, el error típico: ${seguir(tipico[1])}` : `Ojo con esto: ${seguir(fs[0])}`, ...fs.slice(1)])
  }
  for (const idea of p.ideas.slice(0, 1)) {
    const fs = decible(idea).slice(0, 2)
    if (fs.length) decir([`Si te quedas con una idea: ${seguir(fs[0])}`, ...fs.slice(1)])
  }
  return salida
}

// La clase entera: saludo, el mapa (las partes numeradas) y cada apartado.
export function narrarApuntes(texto: string, bloques: BloqueContrato[], clave: string, tituloLeccion: string): FraseClase[] {
  const cuerpo = texto.replace(/^---\n[\s\S]*?\n---\n/, '')
  const porTitulo = new Map(bloques.map((b) => [b.titulo.trim().toLowerCase(), b.clave]))
  const secciones = cuerpo
    .split(/\n(?=## )/)
    .filter((s) => s.startsWith('## '))
    .map((s) => ({ s, ...cabecera(s.split('\n')[0]) }))
    .filter((x) => !x.saltar && x.titulo)
  const n = clave.match(/^L(\d+)$/i)?.[1]
  const salida: FraseClase[] = [
    { marca: 'el principio', texto: `Hola. Vamos con ${n ? `la lección ${numero(Number(n))}` : 'la lección'}: ${tituloLeccion}.` },
  ]
  if (secciones.length > 1) {
    salida.push({ marca: 'el mapa', texto: `Primero, el mapa: son ${numero(secciones.length)} partes.` })
    secciones.forEach((x, k) => salida.push({ marca: 'el mapa', texto: `${numero(k + 1).replace(/^./, (c) => c.toUpperCase())}: ${x.titulo}.` }))
    salida.push({ marca: 'el mapa', texto: 'Ve pensando cómo se conectan.' })
  }
  salida.push({ marca: 'el principio', texto: 'Si te surge una duda, interrúmpeme cuando quieras, hablando sin más.' })
  secciones.forEach((x, k) => {
    salida.push(...narrarApartado(x.s, porTitulo.get(x.titulo.toLowerCase()), x.titulo, k + 1, secciones.length))
  })
  return salida
}
