// Los modos de la barra lateral, en el orden del mapa de la aplicación.
// Solo los que ya tienen lógica detrás van encendidos.

export type IdModo =
  | 'libre'
  | 'tutor'
  | 'roadmap'
  | 'calendario'
  | 'temas'
  | 'proyectos'
  | 'fichas'
  | 'video'
  | 'repaso'
  | 'progreso'
  | 'construccion'
  | 'etiquetar'
  | 'triaje'
  | 'hablar'

export interface Modo {
  id: IdModo
  nombre: string
  encendido: boolean
}

export const MODOS: Modo[] = [
  { id: 'libre', nombre: 'Estudio libre', encendido: true },
  { id: 'tutor', nombre: 'Tutor', encendido: true },
  { id: 'roadmap', nombre: 'Roadmap', encendido: true },
  { id: 'calendario', nombre: 'Calendario', encendido: true },
  { id: 'temas', nombre: 'Temas y fuentes', encendido: true },
  { id: 'proyectos', nombre: 'Proyectos', encendido: false },
  { id: 'fichas', nombre: 'Fichas', encendido: true },
  { id: 'video', nombre: 'Vídeo', encendido: true },
  { id: 'repaso', nombre: 'Repaso', encendido: true },
  { id: 'progreso', nombre: 'Progreso', encendido: true },
  { id: 'etiquetar', nombre: 'Etiquetar tono', encendido: true },
  { id: 'triaje', nombre: 'Triaje del banco', encendido: true },
  { id: 'construccion', nombre: 'Construcción', encendido: false },
  { id: 'hablar', nombre: 'Hablar', encendido: false },
]
