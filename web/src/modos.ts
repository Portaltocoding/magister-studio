// Los modos de la barra lateral, agrupados por para qué sirven.
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
  | 'examen'
  | 'progreso'
  | 'construccion'
  | 'etiquetar'
  | 'triaje'
  | 'hablar'
  | 'animaciones'

export interface Modo {
  id: IdModo
  nombre: string
  encendido: boolean
  // Una línea bajo el nombre al pasar el ratón: qué haces ahí.
  ayuda: string
}

export interface Grupo {
  nombre: string
  modos: Modo[]
  // Los del taller van plegados: son para calibrar Magister, no para estudiar.
  plegado?: boolean
}

export const GRUPOS: Grupo[] = [
  // Lo primero, solo y sin título: preguntar lo que sea.
  {
    nombre: '',
    modos: [{ id: 'libre', nombre: 'Estudio libre', encendido: true, ayuda: 'Pregunta lo que quieras al tutor' }],
  },
  {
    nombre: 'Cada día',
    modos: [
      { id: 'tutor', nombre: 'Hoy', encendido: true, ayuda: 'Lo que toca hoy: la lección, los repasos y el examen' },
      { id: 'repaso', nombre: 'Repaso', encendido: true, ayuda: 'Lo que toca recordar hoy' },
      { id: 'examen', nombre: 'Examen', encendido: true, ayuda: 'Ponte a prueba y saca nota' },
    ],
  },
  {
    nombre: 'Estudiar',
    modos: [
      { id: 'fichas', nombre: 'Lecciones', encendido: true, ayuda: 'Apuntes, fichas, diapositivas y guion de cada lección' },
      { id: 'hablar', nombre: 'Hablar', encendido: true, ayuda: 'Pregunta en voz alta y escucha la respuesta' },
      { id: 'video', nombre: 'Vídeo', encendido: true, ayuda: 'Entender un tema antes de estudiarlo' },
    ],
  },
  {
    nombre: 'Tu plan',
    modos: [
      { id: 'roadmap', nombre: 'Roadmap', encendido: true, ayuda: 'Las lecciones del plan y su orden' },
      { id: 'calendario', nombre: 'Calendario', encendido: true, ayuda: 'Tu mes: sesiones, deberes y exámenes' },
      { id: 'progreso', nombre: 'Progreso', encendido: true, ayuda: 'Cuánto llevas y qué dominas' },
    ],
  },
  {
    nombre: 'Biblioteca',
    modos: [
      { id: 'temas', nombre: 'Temas y fuentes', encendido: true, ayuda: 'Tus PDF, libros y webs' },
      { id: 'proyectos', nombre: 'Proyectos', encendido: false, ayuda: 'El camino que sale de lo que construyes' },
      { id: 'construccion', nombre: 'Construcción', encendido: false, ayuda: 'Un libro a tu medida, por bloques' },
    ],
  },
  {
    nombre: 'Taller',
    plegado: true,
    modos: [
      { id: 'etiquetar', nombre: 'Etiquetar tono', encendido: true, ayuda: 'Calibrar el juez de tono' },
      { id: 'triaje', nombre: 'Triaje del banco', encendido: true, ayuda: 'Revisar preguntas del banco' },
      { id: 'animaciones', nombre: 'Animaciones', encendido: true, ayuda: 'Las animaciones de espera, todas juntas' },
    ],
  },
]

export const MODOS: Modo[] = GRUPOS.flatMap((g) => g.modos)
