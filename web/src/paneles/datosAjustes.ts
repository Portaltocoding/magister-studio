// Tus datos en Ajustes: lo que se puede decidir sin pantalla (tamaños, nombres de las copias, la palabra de restaurar).

export const PALABRA_RESTAURAR = 'RESTAURAR'

export const confirmaRestaurar = (escrito: string) => escrito.trim() === PALABRA_RESTAURAR

export function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

const CARPETAS: Record<string, string> = {
  diarias: 'Diaria',
  semanales: 'Semanal',
  mensuales: 'Mensual',
  'antes-de-restaurar': 'Antes de restaurar',
}

export const tipoCopia = (carpeta: string) => CARPETAS[carpeta] ?? carpeta.replace(/-/g, ' ')

// La fecha y la hora de la copia, en tu zona: «18 nov 2026, 13:00».
export function fechaCopia(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Lo que se avisa antes de restaurar: la fecha de la copia y qué se pierde.
export const avisoRestaurar = (iso: string) =>
  `Vas a volver a como estaba todo el ${fechaCopia(iso)}. Se pierde lo que hayas hecho después: conversaciones, ` +
  'repasos, notas, planes y material. Antes guardo una copia de cómo está ahora, por si quieres deshacerlo.'

// El nombre del fichero que manda el servidor (Content-Disposition), o uno con la fecha de hoy.
export function nombreDescarga(cabecera: string | null, hoy: Date): string {
  const m = cabecera?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
  if (m) return decodeURIComponent(m[1])
  const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
  return `magister-${dia}.zip`
}
