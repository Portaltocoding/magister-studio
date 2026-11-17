// Los modos. La barra lateral enseña solo siete entradas; el resto son pestañas dentro de su entrada
// (Practicar: Repaso y Examen; Plan: Roadmap, Calendario…). Todos conservan su ruta (#/examen sigue valiendo).
// Solo los que ya tienen lógica detrás van encendidos.

export type IdModo =
  | 'libre'
  | 'tutor'
  | 'hoy'
  | 'foco'
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
  | 'automatizar'
  | 'llamada'

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
}

export const GRUPOS: Grupo[] = [
  // Estudio libre va siempre suelto, arriba del todo y sin título: preguntar lo que sea.
  {
    nombre: '',
    modos: [{ id: 'libre', nombre: 'Estudio libre', encendido: true, ayuda: 'Pregunta lo que quieras al tutor' }],
  },
  // Las seis entradas, cada una responde a una pregunta: qué hago hoy, qué aprendo, cómo me lo explicas,
  // me pongo a prueba, cómo voy y de dónde sale.
  {
    nombre: 'principal',
    modos: [
      { id: 'tutor', nombre: 'Tutor', encendido: true, ayuda: 'Lo de hoy, paso a paso: repasos, lección y examen' },
      { id: 'fichas', nombre: 'Lecciones', encendido: true, ayuda: 'Tus lecciones: leerlas, en modo foco, diapositivas y vídeos' },
      { id: 'llamada', nombre: 'Llamada', encendido: true, ayuda: 'Habla con tu tutor como por teléfono' },
      { id: 'repaso', nombre: 'Practicar', encendido: true, ayuda: 'Repasa de memoria y hazte exámenes' },
      { id: 'roadmap', nombre: 'Plan', encendido: true, ayuda: 'Tu plan, tu calendario y cómo vas' },
      { id: 'temas', nombre: 'Biblioteca', encendido: true, ayuda: 'Tus PDF, libros y webs' },
    ],
  },
]

// Los que no salen en la barra: se llega por las pestañas de su entrada, por Ctrl+K o por un enlace.
const OTROS: Modo[] = [
  { id: 'hoy', nombre: 'Tu día', encendido: true, ayuda: 'Tus cifras, tu semana y lo que toca hoy' },
  { id: 'foco', nombre: 'Modo foco', encendido: true, ayuda: 'Estudia una lección a pantalla completa, idea a idea' },
  { id: 'video', nombre: 'Vídeos', encendido: true, ayuda: 'Entender un tema antes de estudiarlo' },
  { id: 'hablar', nombre: 'Pregunta rápida', encendido: true, ayuda: 'Pregunta en voz alta y escucha la respuesta' },
  { id: 'examen', nombre: 'Examen', encendido: true, ayuda: 'Ponte a prueba y saca nota' },
  { id: 'calendario', nombre: 'Calendario', encendido: true, ayuda: 'Tu mes: sesiones, deberes y exámenes' },
  { id: 'progreso', nombre: 'Progreso', encendido: true, ayuda: 'Cuánto llevas y qué dominas' },
  { id: 'automatizar', nombre: 'Automatizar', encendido: true, ayuda: 'Lo que Magister hace solo: preparar, diapositivas, vídeos' },
  { id: 'etiquetar', nombre: 'Etiquetar tono', encendido: true, ayuda: 'Taller: calibrar el juez de tono' },
  { id: 'triaje', nombre: 'Triaje del banco', encendido: true, ayuda: 'Taller: revisar preguntas del banco' },
  { id: 'animaciones', nombre: 'Animaciones', encendido: true, ayuda: 'Taller: las animaciones de espera, todas juntas' },
  { id: 'proyectos', nombre: 'Proyectos', encendido: false, ayuda: 'El camino que sale de lo que construyes' },
  { id: 'construccion', nombre: 'Construcción', encendido: false, ayuda: 'Un libro a tu medida, por bloques' },
]

export const MODOS: Modo[] = [...GRUPOS.flatMap((g) => g.modos), ...OTROS]

// Las pestañas de cada entrada: el primero es la entrada de la barra.
export const FAMILIAS: [IdModo, string][][] = [
  [
    ['tutor', 'Sesión de hoy'],
    ['hoy', 'Tu día'],
  ],
  [
    ['fichas', 'Lecciones'],
    ['foco', 'Modo foco'],
    ['video', 'Vídeos'],
  ],
  [
    ['llamada', 'Llamada'],
    ['hablar', 'Pregunta rápida'],
  ],
  [
    ['repaso', 'Repaso'],
    ['examen', 'Examen'],
  ],
  [
    ['roadmap', 'Roadmap'],
    ['calendario', 'Calendario'],
    ['progreso', 'Progreso'],
    ['automatizar', 'Automatizar'],
  ],
  [
    ['etiquetar', 'Etiquetar tono'],
    ['triaje', 'Triaje del banco'],
    ['animaciones', 'Animaciones'],
  ],
]

export const familiaDe = (m: IdModo) => FAMILIAS.find((f) => f.some(([id]) => id === m)) ?? null
// La entrada de la barra que se ilumina estando en un modo (en Examen se ilumina Practicar).
export const padreDe = (m: IdModo): IdModo => familiaDe(m)?.[0][0] ?? m
