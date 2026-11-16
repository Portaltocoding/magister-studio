import { useEffect, useState, type CSSProperties } from 'react'

// Solo cambia el acento (número, etiquetas, botón principal); la maqueta del libro se queda:
// cabecera negra, papel crema, tinta negra.
export interface Acento {
  id: string
  nombre: string
  color: string
}

export const ACENTOS: Acento[] = [
  // Por defecto, un gris cálido que juega con el negro de la cabecera: sobrio.
  { id: 'gris', nombre: 'Gris', color: '#bdb9b0' },
  { id: 'amarillo', nombre: 'Amarillo', color: '#f2c200' },
  { id: 'naranja', nombre: 'Naranja', color: '#f08a24' },
  { id: 'rojo', nombre: 'Rojo', color: '#e0533d' },
  { id: 'verde', nombre: 'Verde', color: '#3faa66' },
  { id: 'azul', nombre: 'Azul', color: '#3d8fd9' },
  { id: 'violeta', nombre: 'Violeta', color: '#9a7ae0' },
]

export interface AjusteColores {
  // auto: cada lección su acento, por turnos; fijo: el elegido para todas.
  modo: 'auto' | 'fijo'
  acento: string
}

// v2: el gris pasa a ser el acento por defecto.
const CLAVE = 'magister-acento-v2'
const EVENTO = 'magister-acento'
const INICIAL: AjusteColores = { modo: 'fijo', acento: 'gris' }

function leer(): AjusteColores {
  try {
    const t = localStorage.getItem(CLAVE)
    return t ? { ...INICIAL, ...(JSON.parse(t) as AjusteColores) } : INICIAL
  } catch {
    return INICIAL
  }
}

// El ajuste compartido entre Lecciones y el foco: cambiarlo en uno repinta el otro al momento.
export function usarColores(): [AjusteColores, (a: AjusteColores) => void] {
  const [ajuste, setAjuste] = useState(leer)
  useEffect(() => {
    const cambio = () => setAjuste(leer())
    window.addEventListener(EVENTO, cambio)
    return () => window.removeEventListener(EVENTO, cambio)
  }, [])
  const guardar = (a: AjusteColores) => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(a))
    } catch {
      /* sin almacenamiento: vale hasta recargar */
    }
    setAjuste(a)
    window.dispatchEvent(new Event(EVENTO))
  }
  return [ajuste, guardar]
}

export function acentoDe(ajuste: AjusteColores, leccion?: string | null): Acento {
  if (ajuste.modo === 'auto' && leccion) {
    const n = Number(leccion.replace(/\D/g, '')) || 1
    return ACENTOS[(n - 1) % ACENTOS.length]
  }
  return ACENTOS.find((a) => a.id === ajuste.acento) ?? ACENTOS[0]
}

export const variables = (a: Acento) =>
  ({
    '--t-acento': a.color,
    // El fondo del código en línea, un tono claro del mismo acento.
    '--t-resalte': `color-mix(in srgb, ${a.color} 30%, #fff)`,
    // El acento como texto sobre el papel crema (etiquetas de los bloques): oscurecido para que se lea.
    '--t-acento-tinta': `color-mix(in srgb, ${a.color} 45%, #23211c)`,
  }) as CSSProperties
