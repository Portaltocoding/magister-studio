// Medir la voz antes de reproducir: cuánto dura un WAV (leído de su cabecera) y pedir muchas cosas de pocas en pocas.
// Código puro, sin navegador: lo prueban los tests de web/pruebas.

const etiqueta = (v: DataView, p: number) => String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3))

// Los segundos de un WAV: bytes de datos entre bytes por segundo (del bloque «fmt »). null si no es un WAV que se entienda.
// Si el bloque de datos dice ser más largo que el fichero (un WAV escrito al vuelo), cuenta lo que hay.
export function duracionWav(datos: ArrayBuffer): number | null {
  const v = new DataView(datos)
  if (v.byteLength < 12 || etiqueta(v, 0) !== 'RIFF' || etiqueta(v, 8) !== 'WAVE') return null
  let p = 12
  let porSegundo = 0
  while (p + 8 <= v.byteLength) {
    const id = etiqueta(v, p)
    const tam = v.getUint32(p + 4, true)
    if (id === 'fmt ' && p + 20 <= v.byteLength) porSegundo = v.getUint32(p + 16, true)
    if (id === 'data') return porSegundo > 0 ? Math.min(tam, v.byteLength - p - 8) / porSegundo : null
    p += 8 + tam + (tam % 2)
  }
  return null
}

// Hace las tareas de `n` en `n`, guarda cada resultado en su sitio y avisa de cuántas van. Si una falla, no empieza
// ninguna más y devuelve ese error.
export async function enParalelo<T>(tareas: (() => Promise<T>)[], n: number, alAvance?: (hechas: number) => void): Promise<T[]> {
  const salida: T[] = new Array(tareas.length)
  let siguiente = 0
  let hechas = 0
  let roto = false
  const obrero = async () => {
    while (!roto && siguiente < tareas.length) {
      const i = siguiente++
      try {
        salida[i] = await tareas[i]()
      } catch (e) {
        roto = true
        throw e
      }
      alAvance?.(++hechas)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, tareas.length)) }, obrero))
  return salida
}
