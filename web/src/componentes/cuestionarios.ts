import type { Pregunta, Respuestas } from './Cuestionario.tsx'
import { fechaLarga } from './formato.ts'

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
    id: 'profundidad', titulo: '¿Con qué profundidad?', tipo: 'una',
    opciones: [
      { valor: 'esencial', etiqueta: 'Lo esencial', desc: 'Unas 10 h: las ideas clave y saber usarlas' },
      { valor: 'estandar', etiqueta: 'Estándar', desc: 'Unas 25 h: con práctica y casos típicos' },
      { valor: 'fondo', etiqueta: 'A fondo', desc: 'Unas 50 h: casos límite, por qué funciona y mucha práctica' },
    ],
  },
  {
    id: 'plazo', titulo: '¿Para cuándo lo necesitas?', ayuda: 'Con la fecha te propongo cuántas horas y cuándo.', tipo: 'fecha',
    opciones: [
      { valor: 'en un mes', etiqueta: 'En un mes' },
      { valor: 'en tres meses', etiqueta: 'En tres meses' },
      { valor: 'sin fecha límite', etiqueta: 'Sin fecha' },
    ],
  },
  {
    id: 'horas', titulo: '¿Cuánto tiempo le dedicas?', tipo: 'una', otro: true,
    opcionesSegun: (r) => sugerirHoras(r),
    ayudaSegun: (r) => explicarHoras(r),
  },
  {
    id: 'franja', titulo: '¿A qué hora te viene mejor?', tipo: 'una',
    opciones: [
      { valor: 'por las mañanas, empezando a las 9:00', etiqueta: 'Mañanas', desc: 'Desde las 9:00' },
      { valor: 'a mediodía, empezando a las 14:00', etiqueta: 'Mediodía', desc: 'Desde las 14:00' },
      { valor: 'por las tardes, empezando a las 18:00', etiqueta: 'Tardes', desc: 'Desde las 18:00' },
      { valor: 'por las noches, empezando a las 21:30', etiqueta: 'Noches', desc: 'Desde las 21:30' },
      { valor: 'a cualquier hora', etiqueta: 'Me da igual' },
    ],
  },
]

// Horas totales según la profundidad, ajustadas por lo que ya sabes.
const HORAS_BASE: Record<string, number> = { esencial: 10, estandar: 25, fondo: 50 }
const AJUSTE_NIVEL: Record<string, number> = { nada: 1.2, basico: 1, intermedio: 0.85, avanzado: 0.7 }

export function horasTotales(r: Respuestas): number {
  return Math.round((HORAS_BASE[String(r.profundidad)] ?? 25) * (AJUSTE_NIVEL[String(r.nivel)] ?? 1))
}

// La fecha local como ISO (AAAA-MM-DD), sin pasar por UTC.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const masDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12)

// La fecha límite más cercana que se admite (mañana) y la más lejana (dentro de cinco años): fuera de eso es un error al
// escribirla, no un plan.
export const fechaMinima = (hoy = new Date()) => iso(masDias(hoy, 1))
export const fechaMaxima = (hoy = new Date()) => iso(masDias(hoy, 5 * 365))

// Qué tiene de malo la fecha escrita, o null si vale (o si no es una fecha: «en un mes», «sin fecha límite»).
export function errorFecha(v: string | string[] | undefined, hoy = new Date()): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  if (v < fechaMinima(hoy)) return 'Esa fecha ya ha pasado o es hoy: elige una a partir de mañana.'
  if (v > fechaMaxima(hoy)) return 'Esa fecha queda a más de cinco años: revisa el año o elige «Sin fecha».'
  return null
}

// Días hasta la fecha límite; null si no hay.
export function diasHasta(r: Respuestas, hoy = new Date()): number | null {
  const v = String(r.plazo ?? '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Math.max(1, Math.round((new Date(v + 'T12:00:00').getTime() - hoy.getTime()) / 86_400_000))
  if (v === 'en un mes') return 30
  if (v === 'en tres meses') return 90
  return null
}

// 1.25 -> «1 h 15 min»; se redondea al cuarto de hora hacia arriba.
const duracion = (h: number) => {
  const m = Math.max(15, Math.ceil((h * 60) / 15) * 15)
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return hh ? `${hh} h${mm ? ` ${mm} min` : ''}` : `${mm} min`
}

const horasPorSemana = (r: Respuestas, dias: number) => (horasTotales(r) * 1.15 * 7) / dias

// Tramos que caben antes de la fecha: entre semana, todos los días o fines de semana, y uno con holgura. Solo los que
// se pueden hacer: si la fecha no da para ninguno, no hay opciones (explicarHoras dice por qué).
export function sugerirHoras(r: Respuestas, hoy = new Date()): { valor: string; etiqueta: string; desc?: string }[] {
  const dias = diasHasta(r, hoy)
  if (dias == null)
    return [
      { valor: 'media hora al día entre semana', etiqueta: '30 min entre semana' },
      { valor: 'una hora al día entre semana', etiqueta: '1 h entre semana' },
      { valor: 'una hora todos los días', etiqueta: '1 h todos los días' },
      { valor: 'tres horas los sábados y domingos', etiqueta: '3 h los fines de semana' },
    ]
  // Un 15 % de margen para repasos y días que fallan.
  const necesarias = horasTotales(r) * 1.15
  const laborables = Math.max(1, Math.round((dias * 5) / 7))
  const findes = Math.max(1, Math.round((dias * 2) / 7))
  const tramos = [
    { h: necesarias / laborables, texto: 'al día de lunes a viernes', corto: 'de lunes a viernes', max: 4 },
    { h: necesarias / dias, texto: 'al día, todos los días', corto: 'todos los días', max: 3.5 },
    { h: necesarias / findes, texto: 'los sábados y los domingos', corto: 'sábados y domingos', max: 6 },
  ]
  const ops = tramos
    .filter((t) => t.h <= t.max)
    .map((t, i) => ({
      valor: `${duracion(t.h)} ${t.texto}`,
      etiqueta: `${duracion(t.h)} ${t.corto}`,
      desc: i === 0 && t.corto === 'de lunes a viernes' ? 'Recomendado: constante y con el fin de semana libre' : undefined,
    }))
  // La holgura, solo si también cabe en el tope de lunes a viernes.
  const hHolgura = (necesarias / laborables) * 1.3
  if (hHolgura <= tramos[0].max) {
    const holgura = duracion(hHolgura)
    ops.push({ valor: `${holgura} al día de lunes a viernes`, etiqueta: `${holgura} de lunes a viernes`, desc: 'Con holgura: acabas antes' })
  }
  return ops
}

export function explicarHoras(r: Respuestas, hoy = new Date()): string {
  const total = horasTotales(r)
  const dias = diasHasta(r, hoy)
  if (dias == null) return `Para esta profundidad calculo unas ${total} h en total. Sin fecha, elige un ritmo que puedas mantener.`
  const porSemana = horasPorSemana(r, dias)
  const plazo = `${dias} ${dias === 1 ? 'día' : 'días'}`
  if (!sugerirHoras(r, hoy).length)
    return (
      `Unas ${total} h en ${plazo} no caben: serían unas ${Math.ceil(porSemana)} h por semana. ` +
      'Vuelve atrás y elige una fecha más lejana o menos profundidad, o escribe en «Otro» lo que de verdad puedes dedicarle.'
    )
  const aviso = porSemana > 20 ? ' Va justo: alarga la fecha o baja la profundidad.' : ''
  return `Unas ${total} h en ${plazo}: unas ${Math.ceil(porSemana)} h por semana, con margen para repasos.${aviso}`
}

export function mensajePlan(r: Respuestas): string {
  const plazo = /^\d{4}-\d{2}-\d{2}$/.test(String(r.plazo)) ? `antes del ${fechaLarga(String(r.plazo))}` : String(r.plazo ?? 'sin fecha límite')
  const prof = ({ esencial: 'lo esencial', estandar: 'a nivel estándar', fondo: 'a fondo' } as Record<string, string>)[String(r.profundidad)] ?? 'a nivel estándar'
  // El valor de la opción va sin tilde («basico»): en el mensaje, como se lee.
  const nivel = ({ nada: 'empiezo de cero', basico: 'lo básico', intermedio: 'intermedio', avanzado: 'avanzado' } as Record<string, string>)[String(r.nivel)] ?? String(r.nivel)
  return (
    `Quiero aprender ${r.tema}, para ${r.objetivo}. Mi nivel: ${nivel}. Lo quiero ${prof} (unas ${horasTotales(r)} h en total). ` +
    `Puedo dedicarle ${r.horas}, ${r.franja ?? 'a cualquier hora'}. Lo quiero ${plazo}.`
  )
}

// Antes de generar el material de una lección.
export const PREGUNTAS_MATERIAL: Pregunta[] = [
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
    id: 'enfoque', titulo: '¿Algún enfoque? (opcional)', tipo: 'texto', opcional: true,
    placeholder: 'Por ejemplo: con ejemplos en TypeScript, pensando en entrevistas, sin matemáticas...',
  },
]
