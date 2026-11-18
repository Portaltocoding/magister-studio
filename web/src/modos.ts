// Los modos. La barra lateral enseña Estudio libre suelto y cinco entradas (Hoy, Lecciones, Practicar, Plan,
// Biblioteca), cada una con sus subsecciones siempre a la vista. Dentro de la pantalla, las mismas subsecciones
// salen como pestañas. Todos conservan su ruta (#/examen sigue valiendo).
// Solo los que ya tienen lógica detrás van encendidos.

export type IdModo =
  | 'libre'
  | 'tutor'
  | 'hoy'
  | 'foco'
  | 'roadmap'
  | 'calendario'
  | 'temas'
  | 'notas'
  | 'buscar'
  | 'web'
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
  | 'pronunciacion'
  | 'automatizar'
  | 'llamada'

export interface Modo {
  id: IdModo
  nombre: string
  encendido: boolean
  // Una línea al pasar el ratón: qué haces ahí.
  ayuda: string
  // No sale en la barra lateral: se llega desde la pantalla de su entrada, con las pestañas de arriba (Tutor, desde Hoy).
  soloDentro?: boolean
}

export interface Grupo {
  // '' = suelto, sin título (Estudio libre).
  nombre: string
  ayuda?: string
  modos: Modo[]
}

export const GRUPOS: Grupo[] = [
  // Estudio libre va siempre suelto, arriba del todo y sin título: preguntar lo que sea.
  {
    nombre: '',
    modos: [{ id: 'libre', nombre: 'Estudio libre', encendido: true, ayuda: 'Pregunta lo que quieras al tutor' }],
  },
  {
    nombre: 'Hoy',
    ayuda: 'Lo que toca hoy',
    modos: [
      // Hoy es una sola pantalla: la entrada, el icono del riel y la ruta vacía llevan aquí, y Tutor se abre desde ella
      // con el conmutador de arriba (no tiene sitio propio en la barra).
      { id: 'hoy', nombre: 'Hoy', encendido: true, ayuda: 'Tus cifras, tu semana y lo que toca hoy' },
      { id: 'tutor', nombre: 'Tutor', encendido: true, ayuda: 'Te guía paso a paso: repasos, lección y examen', soloDentro: true },
    ],
  },
  {
    nombre: 'Lecciones',
    ayuda: 'Aprender algo nuevo',
    modos: [
      { id: 'fichas', nombre: 'Lecciones', encendido: true, ayuda: 'Apuntes, fichas, diapositivas y guion de cada lección' },
      { id: 'foco', nombre: 'Modo foco', encendido: true, ayuda: 'Estudia una lección a pantalla completa, idea a idea' },
      { id: 'video', nombre: 'Vídeos', encendido: true, ayuda: 'Entender un tema antes de estudiarlo' },
    ],
  },
  {
    nombre: 'Practicar',
    ayuda: 'Recordar de memoria y ponerte a prueba',
    modos: [
      { id: 'repaso', nombre: 'Repaso', encendido: true, ayuda: 'Lo que toca recordar hoy' },
      { id: 'examen', nombre: 'Examen', encendido: true, ayuda: 'Ponte a prueba y saca nota' },
      { id: 'llamada', nombre: 'Charla', encendido: true, ayuda: 'Habla con tu tutor en voz: clase, examen oral, entrevista o charla' },
    ],
  },
  {
    nombre: 'Proyectos',
    ayuda: 'Lo que construyes',
    modos: [
      { id: 'proyectos', nombre: 'Proyectos', encendido: true, ayuda: 'El roadmap de construcción de lo que quieres construir, paso a paso, y su diario de decisiones' },
    ],
  },
  {
    nombre: 'Plan',
    ayuda: 'Tu plan y cómo vas',
    modos: [
      { id: 'roadmap', nombre: 'Roadmap', encendido: true, ayuda: 'Las lecciones del plan y su orden' },
      { id: 'calendario', nombre: 'Calendario', encendido: true, ayuda: 'Tu mes: sesiones, deberes y exámenes' },
      { id: 'progreso', nombre: 'Progreso', encendido: true, ayuda: 'Cuánto llevas y qué dominas' },
      { id: 'automatizar', nombre: 'Automatizar', encendido: true, ayuda: 'Lo que Magister hace solo: preparar, diapositivas, vídeos' },
    ],
  },
  {
    nombre: 'Biblioteca',
    ayuda: 'De dónde sale lo que estudias',
    modos: [
      { id: 'temas', nombre: 'Tus fuentes', encendido: true, ayuda: 'Tus PDF, libros, notas y webs guardadas' },
      { id: 'notas', nombre: 'Mis notas', encendido: true, ayuda: 'Lo que guardaste de Estudio libre: respuestas enteras o trozos marcados' },
      { id: 'buscar', nombre: 'Buscar fuentes', encendido: true, ayuda: 'Rastrea la web en busca de buenas fuentes para un tema o una lección' },
      { id: 'web', nombre: 'Guardar de la web', encendido: true, ayuda: 'Pega enlaces (páginas o PDF) y se guardan con su texto' },
    ],
  },
]

// El taller: para calibrar Magister, no para estudiar. Un enlace pequeño al pie de la barra.
export const TALLER: Modo[] = [
  { id: 'etiquetar', nombre: 'Etiquetar tono', encendido: true, ayuda: 'Taller: calibrar el juez de tono' },
  { id: 'triaje', nombre: 'Triaje del banco', encendido: true, ayuda: 'Taller: revisar preguntas del banco' },
  { id: 'animaciones', nombre: 'Animaciones', encendido: true, ayuda: 'Taller: las animaciones de espera, todas juntas' },
  { id: 'pronunciacion', nombre: 'Pronunciación', encendido: true, ayuda: 'Taller: cómo dice la voz cada término técnico; búscalo y escúchalo' },
]

// Sin sitio en la barra: se llega por Ctrl+K (o aún no existen).
const OTROS: Modo[] = [
  { id: 'hablar', nombre: 'Pregunta rápida', encendido: true, ayuda: 'Pregunta en voz alta y escucha la respuesta' },
  { id: 'construccion', nombre: 'Construcción', encendido: false, ayuda: 'Un libro a tu medida, por bloques' },
]

export const MODOS: Modo[] = [...GRUPOS.flatMap((g) => g.modos), ...TALLER, ...OTROS]

// Las pestañas de cada entrada: sus subsecciones (y las del taller).
export const FAMILIAS: [IdModo, string][][] = [
  ...GRUPOS.filter((g) => g.nombre).map((g) => g.modos.filter((m) => m.encendido).map((m): [IdModo, string] => [m.id, m.nombre])),
  TALLER.map((m): [IdModo, string] => [m.id, m.nombre]),
]

export const familiaDe = (m: IdModo) => FAMILIAS.find((f) => f.some(([id]) => id === m)) ?? null
// La entrada de la barra a la que pertenece un modo («Lecciones» para Vídeos): el tema de risografía le da su tinta.
export const grupoDe = (m: IdModo): string => GRUPOS.find((g) => g.modos.some((x) => x.id === m))?.nombre ?? (TALLER.some((x) => x.id === m) ? 'Taller' : '')
// La primera subsección de la entrada en la que estás (en Examen, Repaso): sirve para iluminar la tira de iconos.
export const padreDe = (m: IdModo): IdModo => familiaDe(m)?.[0][0] ?? m
