// El plan con el que estás: uno solo para toda la app. Lo eliges en cualquier pantalla (Roadmap, Lecciones, Vídeo,
// Progreso, Examen) y las demás lo respetan. Antes cada pantalla abría por su cuenta el primer plan de la lista, así
// que elegías Topografía en Roadmap y en Lecciones volvía a salir el otro.
// Se guarda en el navegador por tema (no por id de plan: el plan cambia de versión, el tema no).

const CLAVE = 'magister-plan-activo'

export function temaActivo(): number | null {
  try {
    const n = Number(localStorage.getItem(CLAVE))
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null // sin almacenamiento: vale el primero
  }
}

export function recordarPlan(temaId: number | null | undefined): void {
  if (!temaId) return
  try {
    localStorage.setItem(CLAVE, String(temaId))
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}

// Lógica pura: qué plan abrir. Manda el que pide la ruta (un enlace a una lección concreta); si no, el que tenías
// elegido; si ese ya no existe (lo borraste), el primero.
export function planQueToca<T extends { tema_id: number }>(planes: T[], deLaRuta: number | null | undefined, guardado: number | null): T | undefined {
  return planes.find((p) => p.tema_id === deLaRuta) ?? planes.find((p) => p.tema_id === guardado) ?? planes[0]
}

// Lo mismo, leyendo lo guardado y dejando apuntado el que sale (así un enlace a otro plan también lo cambia).
export function planActivo<T extends { tema_id: number }>(planes: T[], deLaRuta?: number | null): T | undefined {
  const p = planQueToca(planes, deLaRuta, temaActivo())
  if (p && deLaRuta && p.tema_id === deLaRuta) recordarPlan(p.tema_id)
  return p
}
