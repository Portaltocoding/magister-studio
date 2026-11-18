// Los bloques ```diagrama ya cerrados de una respuesta (con su cierre en el texto), con el texto que va antes de cada
// uno. Uno a medio llegar no sale: así nunca se pide el dibujo de un encargo incompleto.
export function bloquesDiagrama(texto: string): { encargo: string; contexto: string }[] {
  const salida: { encargo: string; contexto: string }[] = []
  const apertura = '```diagrama\n'
  let desde = 0
  for (;;) {
    const i = texto.indexOf(apertura, desde)
    if (i < 0) break
    const fin = texto.indexOf('\n```', i + apertura.length)
    if (fin < 0) break
    salida.push({ encargo: texto.slice(i + apertura.length, fin).trim(), contexto: texto.slice(0, i) })
    desde = fin + 4
  }
  return salida
}
