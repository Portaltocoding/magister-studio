// Lo que enseña el asesor en su ventanita, en lógica pura (con test en pruebas/textoAsesor.test.ts):
// - sin los ids del roadmap (n3-b3-p3): el alumno no los ve, así que se cambian por el título;
// - sin la frase con la que prometió el cambio («Añado un bloque con cinco pasos»), cuando ya ha llegado la tarjeta con
//   lo que de verdad se preparó: esa frase se escribe antes de prepararlo y podía no cuadrar.

const ID = /(?<![\w-])(n\d+(?:-b\d+(?:-p\d+)?)?)(?![\w-])/g
const CODIGO = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g

// Cambia los ids conocidos por su título, fuera de los bloques de código (los botones `paso:n1-b1-p3` van aparte).
export function sinIds(texto: string, titulos: Map<string, string>): string {
  if (!titulos.size) return texto
  const cambiar = (t: string) =>
    t
      .replace(ID, (id) => titulos.get(id) ?? id)
      // «el paso «X»» está bien; «en el nivel el nivel 2 «X»», no.
      .replace(/\b(el|del|al) nivel el nivel /g, '$1 nivel ')
      .replace(/\bde el nivel\b/g, 'del nivel')
      .replace(/\ba el nivel\b/g, 'al nivel')
  let salida = ''
  let desde = 0
  for (const m of texto.matchAll(CODIGO)) {
    salida += cambiar(texto.slice(desde, m.index)) + m[0]
    desde = m.index + m[0].length
  }
  return salida + cambiar(texto.slice(desde))
}

const MAX_PROMESA = 400

// El texto de la respuesta sin el párrafo que va justo antes del bloque ```cambio (la promesa), si es corto. Lo demás
// (la explicación de antes, los botones de después) se queda.
export function sinPromesa(texto: string): string {
  const i = texto.search(/```cambio/)
  if (i < 0) return texto
  const antes = texto.slice(0, i).replace(/\s+$/, '')
  const despues = texto.slice(i)
  const corte = antes.search(/\n\s*\n(?![\s\S]*\n\s*\n)/)
  const ultimo = corte < 0 ? antes : antes.slice(corte)
  if (ultimo.trim().length > MAX_PROMESA) return texto
  const resto = corte < 0 ? '' : antes.slice(0, corte)
  return `${resto}${resto ? '\n\n' : ''}${despues}`
}
