import type { Pregunta, Respuestas } from './Cuestionario.tsx'

// Antes de un plan: lo que el diagnóstico necesita, en cuatro pasos. Con esto suele salir el plan a la primera.
export const PREGUNTAS_PLAN: Pregunta[] = [
  { id: 'tema', titulo: '¿Qué quieres aprender?', tipo: 'texto', placeholder: 'Por ejemplo: conceptos de un fullstack senior, cálculo de primero, redes...' },
  {
    id: 'objetivo', titulo: '¿Para qué?', tipo: 'una', otro: true,
    opciones: [
      { valor: 'una entrevista de trabajo', etiqueta: 'Una entrevista', desc: 'Con preguntas de nivel y simulacros' },
      { valor: 'un examen', etiqueta: 'Un examen', desc: 'Con fecha y temario' },
      { valor: 'un proyecto o el trabajo', etiqueta: 'Un proyecto o el trabajo', desc: 'Para aplicarlo ya' },
      { valor: 'curiosidad y base sólida', etiqueta: 'Curiosidad', desc: 'Sin prisa, a fondo' },
    ],
  },
  {
    id: 'nivel', titulo: '¿Qué sabes ya?', tipo: 'una',
    opciones: [
      { valor: 'nada', etiqueta: 'Nada', desc: 'Empiezo de cero' },
      { valor: 'basico', etiqueta: 'Lo básico', desc: 'Me suena, pero con huecos' },
      { valor: 'intermedio', etiqueta: 'Intermedio', desc: 'Lo uso con soltura' },
      { valor: 'avanzado', etiqueta: 'Avanzado', desc: 'Quiero pulir y profundizar' },
    ],
  },
  {
    id: 'horas', titulo: '¿Cuánto tiempo tienes?', tipo: 'una', otro: true,
    opciones: [
      { valor: 'media hora al día entre semana', etiqueta: '30 min entre semana' },
      { valor: 'una hora al día entre semana', etiqueta: '1 h entre semana' },
      { valor: 'hora y media al día entre semana', etiqueta: '1,5 h entre semana' },
      { valor: 'una hora todos los días', etiqueta: '1 h todos los días' },
      { valor: 'dos horas al día todos los días', etiqueta: '2 h todos los días' },
      { valor: 'tres horas los sábados y domingos', etiqueta: '3 h los fines de semana' },
    ],
  },
  {
    id: 'plazo', titulo: '¿Hasta cuándo?', ayuda: 'Elige una fecha o una de las opciones.', tipo: 'fecha',
    opciones: [
      { valor: 'en un mes', etiqueta: 'Un mes' },
      { valor: 'en tres meses', etiqueta: 'Tres meses' },
      { valor: 'sin fecha límite', etiqueta: 'Sin fecha' },
    ],
  },
]

export function mensajePlan(r: Respuestas): string {
  const plazo = /^\d{4}-\d{2}-\d{2}$/.test(String(r.plazo)) ? `antes del ${r.plazo}` : String(r.plazo ?? 'sin fecha límite')
  return (
    `Quiero aprender ${r.tema}, para ${r.objetivo}. Mi nivel: ${r.nivel}. Tengo ${r.horas}. ` +
    `Lo quiero ${plazo === 'sin fecha límite' ? 'sin fecha límite' : plazo}.`
  )
}

// Antes de generar el material de una lección.
export const PREGUNTAS_MATERIAL: Pregunta[] = [
  {
    id: 'tipos', titulo: '¿Qué te preparo?', tipo: 'varias', porDefecto: ['apuntes', 'preguntas', 'diapositivas'],
    opciones: [
      { valor: 'apuntes', etiqueta: 'Apuntes en PDF', desc: 'Siempre: lo demás sale de aquí' },
      { valor: 'preguntas', etiqueta: 'Fichas de repaso', desc: 'Con respuesta fantasma' },
      { valor: 'diapositivas', etiqueta: 'Diapositivas' },
      { valor: 'guion', etiqueta: 'Guion de vídeo' },
    ],
  },
  {
    id: 'profundidad', titulo: '¿Con qué profundidad?', tipo: 'una',
    opciones: [
      { valor: 'intro', etiqueta: 'Introducción', desc: 'Lo esencial, rápido' },
      { valor: 'estandar', etiqueta: 'Estándar', desc: 'Intuición, lo formal y un ejemplo' },
      { valor: 'fondo', etiqueta: 'A fondo', desc: 'Casos límite y errores típicos' },
    ],
  },
  {
    id: 'preguntas', titulo: '¿Qué tipo de preguntas?', tipo: 'una',
    opciones: [
      { valor: 'conceptuales', etiqueta: 'Conceptuales', desc: 'Explicar el porqué' },
      { valor: 'practicas', etiqueta: 'Prácticas', desc: 'Cálculo, casos y encontrar el fallo' },
      { valor: 'mezcla', etiqueta: 'Mezcla', desc: 'Un poco de todo' },
    ],
  },
  {
    id: 'cantidad', titulo: '¿Cuántas fichas?', tipo: 'una',
    opciones: [
      { valor: 'pocas', etiqueta: 'Pocas', desc: '4 a 6' },
      { valor: 'normal', etiqueta: 'Normal', desc: '6 a 10' },
      { valor: 'muchas', etiqueta: 'Muchas', desc: '10 a 12' },
    ],
  },
  {
    id: 'estilo', titulo: '¿Con qué estilo?', tipo: 'una',
    opciones: [
      { valor: 'libro', etiqueta: 'Libro', desc: 'Portada, teoría en amarillo, repaso en verde' },
      { valor: 'ficha', etiqueta: 'Ficha general', desc: 'Sobria y densa, para imprimir y escribir' },
    ],
  },
  {
    id: 'enfoque', titulo: '¿Algún enfoque? (opcional)', tipo: 'texto', opcional: true,
    placeholder: 'Por ejemplo: con ejemplos en TypeScript, pensando en entrevistas, sin matemáticas...',
  },
]
