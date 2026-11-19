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

// Las reglas del <style> de un diagrama («.c{fill:#e8e6e0;stroke:#333}»), en su orden. El dibujante pone ahí los estilos
// por clase, que gasta mucho menos que repetirlos en cada elemento; Diagrama.tsx los pasa a atributos. Solo selectores
// de tipo, de clase o de los dos («rect.c»); lo demás (@import, selectores compuestos, url() hacia fuera) se ignora.
export type ReglaEstilo = { tipo?: string; clase?: string; propiedades: [string, string][] }

export function reglasDeEstilo(css: string): ReglaEstilo[] {
  const salida: ReglaEstilo[] = []
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[^;{}]*;/g, '')
  for (const [, selectores, cuerpo] of limpio.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const propiedades: [string, string][] = []
    for (const declaracion of cuerpo.split(';')) {
      const i = declaracion.indexOf(':')
      if (i < 0) continue
      const nombre = declaracion.slice(0, i).trim().toLowerCase()
      const valor = declaracion.slice(i + 1).replace(/!important/i, '').trim()
      if (!nombre || !valor || /url\(\s*(?!['"]?#)|javascript:|expression/i.test(valor)) continue
      propiedades.push([nombre, valor])
    }
    for (const selector of selectores.split(',')) {
      const m = selector.trim().match(/^([a-z]+)?(?:\.([\w-]+))?$/i)
      if (m && (m[1] || m[2])) salida.push({ tipo: m[1]?.toLowerCase(), clase: m[2], propiedades })
    }
  }
  return salida
}
