// El aspecto de Magister: «clásico» (el de siempre, claro u oscuro según el sistema) o «Parchís» (id «riso»: blanco,
// líneas negras y rojo, azul, amarillo y verde, uno por sección). Se guarda en el navegador y se aplica a <html data-tema>.

export type Tema = 'clasico' | 'riso'
export const TEMAS: { id: Tema; nombre: string; descripcion: string }[] = [
  { id: 'clasico', nombre: 'Clásico', descripcion: 'Sobrio, claro u oscuro según tu equipo' },
  { id: 'riso', nombre: 'Parchís', descripcion: 'Blanco, líneas negras y rojo, azul, amarillo y verde' },
]
const CLAVE = 'magister-tema'
export const EVENTO_TEMA = 'magister-tema'

export function temaGuardado(): Tema {
  try {
    const t = localStorage.getItem(CLAVE)
    return TEMAS.some((x) => x.id === t) ? (t as Tema) : 'clasico'
  } catch {
    return 'clasico'
  }
}

export function aplicarTema(t: Tema = temaGuardado()) {
  document.documentElement.dataset.tema = t
}

export function elegirTema(t: Tema) {
  try {
    localStorage.setItem(CLAVE, t)
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
  aplicarTema(t)
  window.dispatchEvent(new CustomEvent(EVENTO_TEMA, { detail: t }))
}

// La sección como palabra sencilla, para que cada una tenga su tinta: «Hoy» -> «hoy», «Biblioteca» -> «biblioteca».
export const claveSeccion = (nombre: string) =>
  (nombre || 'libre')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, '-')
