// El tamaño de la interfaz: un zoom en <html>, como el del navegador, para que al 100 % del navegador la app se vea
// cómoda (antes había que bajar el navegador al 75 %). Se guarda en este navegador.
//
// Lo que el zoom no hace solo, y se compensa:
// - Las alturas relativas a la ventana (vh, vw) se encogen con él: en el CSS van divididas por var(--zoom-ui).
// - Las coordenadas del puntero y de getBoundingClientRect llegan en píxeles de pantalla, y los left/top del CSS se
//   multiplican por el zoom: al colocar algo donde está el puntero, se pasa por aCss().

export const TAMANOS = [
  { id: 'compacto', zoom: 0.75, nombre: 'Compacto' },
  { id: 'medio', zoom: 0.875, nombre: 'Medio' },
  { id: 'grande', zoom: 1, nombre: 'Grande' },
] as const
export type IdTamano = (typeof TAMANOS)[number]['id']

const CLAVE = 'magister-tamano'
const POR_DEFECTO: IdTamano = 'compacto'

export function tamanoGuardado(): IdTamano {
  try {
    const v = localStorage.getItem(CLAVE)
    return TAMANOS.some((t) => t.id === v) ? (v as IdTamano) : POR_DEFECTO
  } catch {
    return POR_DEFECTO
  }
}

export function aplicarTamano(id: IdTamano = tamanoGuardado()) {
  const zoom = TAMANOS.find((t) => t.id === id)?.zoom ?? 1
  const raiz = document.documentElement
  raiz.style.zoom = String(zoom)
  raiz.style.setProperty('--zoom-ui', String(zoom))
  try {
    localStorage.setItem(CLAVE, id)
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
  window.dispatchEvent(new Event('resize')) // lo que mide la ventana (la mascota flotante, el vídeo) se recoloca
}

export const zoomUi = () => Number(document.documentElement.style.zoom) || 1

// Píxeles de pantalla (clientX, getBoundingClientRect, innerWidth) a píxeles de CSS para left/top.
export const aCss = (px: number) => px / zoomUi()
