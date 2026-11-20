import type { Pregunta, Respuestas } from './Cuestionario.tsx'
import { fechaLarga } from './formato.ts'
import { t } from '../i18n/i18n.ts'

// Antes de un plan: lo que el diagnóstico necesita, en cuatro pasos. Con esto suele salir el plan a la primera.
// Los textos salen del diccionario (i18n/): el `valor` de cada opción es lo que acaba en el mensaje que se manda al tutor,
// así que también va en el idioma de ahora. Las únicas claves internas son las de `plazo`, `profundidad` y `nivel`.
export const preguntasPlan = (): Pregunta[] => [
  { id: 'tema', titulo: t('cuest.tema.titulo'), tipo: 'texto', placeholder: t('cuest.tema.placeholder') },
  {
    id: 'objetivo', titulo: t('cuest.objetivo.titulo'), tipo: 'una', otro: true,
    opciones: [
      { valor: t('cuest.objetivo.entrevista.valor'), etiqueta: t('cuest.objetivo.entrevista'), desc: t('cuest.objetivo.entrevista.desc') },
      { valor: t('cuest.objetivo.examen.valor'), etiqueta: t('cuest.objetivo.examen'), desc: t('cuest.objetivo.examen.desc') },
      { valor: t('cuest.objetivo.proyecto.valor'), etiqueta: t('cuest.objetivo.proyecto'), desc: t('cuest.objetivo.proyecto.desc') },
      { valor: t('cuest.objetivo.curiosidad.valor'), etiqueta: t('cuest.objetivo.curiosidad'), desc: t('cuest.objetivo.curiosidad.desc') },
    ],
  },
  {
    id: 'nivel', titulo: t('cuest.nivel.titulo'), tipo: 'una',
    opciones: [
      { valor: 'nada', etiqueta: t('cuest.nivel.nada'), desc: t('cuest.nivel.nada.desc') },
      { valor: 'basico', etiqueta: t('cuest.nivel.basico'), desc: t('cuest.nivel.basico.desc') },
      { valor: 'intermedio', etiqueta: t('cuest.nivel.intermedio'), desc: t('cuest.nivel.intermedio.desc') },
      { valor: 'avanzado', etiqueta: t('cuest.nivel.avanzado'), desc: t('cuest.nivel.avanzado.desc') },
    ],
  },
  {
    id: 'profundidad', titulo: t('cuest.profundidad.titulo'), tipo: 'una',
    opciones: [
      { valor: 'esencial', etiqueta: t('cuest.profundidad.esencial'), desc: t('cuest.profundidad.esencial.desc') },
      { valor: 'estandar', etiqueta: t('cuest.profundidad.estandar'), desc: t('cuest.profundidad.estandar.desc') },
      { valor: 'fondo', etiqueta: t('cuest.profundidad.fondo'), desc: t('cuest.profundidad.fondo.desc') },
    ],
  },
  {
    id: 'plazo', titulo: t('cuest.plazo.titulo'), ayuda: t('cuest.plazo.ayuda'), tipo: 'fecha',
    opciones: [
      { valor: 'en un mes', etiqueta: t('cuest.plazo.mes') },
      { valor: 'en tres meses', etiqueta: t('cuest.plazo.tresMeses') },
      { valor: 'sin fecha límite', etiqueta: t('cuest.plazo.sin') },
    ],
  },
  {
    id: 'horas', titulo: t('cuest.horas.titulo'), tipo: 'una', otro: true,
    opcionesSegun: (r) => sugerirHoras(r),
    ayudaSegun: (r) => explicarHoras(r),
  },
  {
    id: 'franja', titulo: t('cuest.franja.titulo'), tipo: 'una',
    opciones: [
      { valor: t('cuest.franja.manana.valor'), etiqueta: t('cuest.franja.manana'), desc: t('cuest.franja.manana.desc') },
      { valor: t('cuest.franja.mediodia.valor'), etiqueta: t('cuest.franja.mediodia'), desc: t('cuest.franja.mediodia.desc') },
      { valor: t('cuest.franja.tarde.valor'), etiqueta: t('cuest.franja.tarde'), desc: t('cuest.franja.tarde.desc') },
      { valor: t('cuest.franja.noche.valor'), etiqueta: t('cuest.franja.noche'), desc: t('cuest.franja.noche.desc') },
      { valor: t('cuest.franja.cualquiera.valor'), etiqueta: t('cuest.franja.cualquiera') },
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
  if (v < fechaMinima(hoy)) return t('cuest.fecha.pasada')
  if (v > fechaMaxima(hoy)) return t('cuest.fecha.lejana')
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
      { valor: t('cuest.horas.sin.a.valor'), etiqueta: t('cuest.horas.sin.a') },
      { valor: t('cuest.horas.sin.b.valor'), etiqueta: t('cuest.horas.sin.b') },
      { valor: t('cuest.horas.sin.c.valor'), etiqueta: t('cuest.horas.sin.c') },
      { valor: t('cuest.horas.sin.d.valor'), etiqueta: t('cuest.horas.sin.d') },
    ]
  // Un 15 % de margen para repasos y días que fallan.
  const necesarias = horasTotales(r) * 1.15
  const laborables = Math.max(1, Math.round((dias * 5) / 7))
  const findes = Math.max(1, Math.round((dias * 2) / 7))
  const tramos = [
    { h: necesarias / laborables, texto: t('cuest.tramo.laborables'), corto: t('cuest.tramo.laborables.corto'), max: 4, laborables: true },
    { h: necesarias / dias, texto: t('cuest.tramo.todos'), corto: t('cuest.tramo.todos.corto'), max: 3.5, laborables: false },
    { h: necesarias / findes, texto: t('cuest.tramo.findes'), corto: t('cuest.tramo.findes.corto'), max: 6, laborables: false },
  ]
  const ops = tramos
    .filter((x) => x.h <= x.max)
    .map((x, i) => ({
      valor: `${duracion(x.h)} ${x.texto}`,
      etiqueta: `${duracion(x.h)} ${x.corto}`,
      desc: i === 0 && x.laborables ? t('cuest.tramo.recomendado') : undefined,
    }))
  // La holgura, solo si también cabe en el tope de lunes a viernes.
  const hHolgura = (necesarias / laborables) * 1.3
  if (hHolgura <= tramos[0].max) {
    const holgura = duracion(hHolgura)
    ops.push({ valor: `${holgura} ${tramos[0].texto}`, etiqueta: `${holgura} ${tramos[0].corto}`, desc: t('cuest.tramo.holgura') })
  }
  return ops
}

export function explicarHoras(r: Respuestas, hoy = new Date()): string {
  const total = horasTotales(r)
  const dias = diasHasta(r, hoy)
  if (dias == null) return t('cuest.explica.sinFecha', { total })
  const porSemana = horasPorSemana(r, dias)
  const plazo = `${dias} ${dias === 1 ? t('cuest.dia') : t('cuest.dias')}`
  if (!sugerirHoras(r, hoy).length) return t('cuest.explica.noCabe', { total, plazo, semana: Math.ceil(porSemana) })
  const aviso = porSemana > 20 ? ` ${t('cuest.explica.justo')}` : ''
  return `${t('cuest.explica.cabe', { total, plazo, semana: Math.ceil(porSemana) })}${aviso}`
}

export function mensajePlan(r: Respuestas): string {
  const plazo = /^\d{4}-\d{2}-\d{2}$/.test(String(r.plazo))
    ? t('cuest.msg.antesDel', { fecha: fechaLarga(String(r.plazo)) })
    : r.plazo === 'en un mes'
      ? t('cuest.plazo.mes.msg')
      : r.plazo === 'en tres meses'
        ? t('cuest.plazo.tresMeses.msg')
        : t('cuest.plazo.sin.msg')
  const prof = t(`cuest.msg.prof.${['esencial', 'estandar', 'fondo'].includes(String(r.profundidad)) ? String(r.profundidad) : 'estandar'}` as 'cuest.msg.prof.estandar')
  // El valor de la opción va sin tilde («basico»): en el mensaje, como se lee.
  const nivel = ['nada', 'basico', 'intermedio', 'avanzado'].includes(String(r.nivel)) ? t(`cuest.msg.nivel.${String(r.nivel)}` as 'cuest.msg.nivel.nada') : String(r.nivel)
  return t('cuest.msg.plan', {
    tema: String(r.tema),
    objetivo: String(r.objetivo),
    nivel,
    prof,
    total: horasTotales(r),
    horas: String(r.horas),
    franja: String(r.franja ?? t('cuest.franja.cualquiera.valor')),
    plazo,
  })
}

// Antes de generar el material de una lección.
export const preguntasMaterial = (): Pregunta[] => [
  {
    id: 'profundidad', titulo: t('cuest.profundidad.titulo'), tipo: 'una',
    opciones: [
      { valor: 'intro', etiqueta: t('cuest.mat.intro'), desc: t('cuest.mat.intro.desc') },
      { valor: 'estandar', etiqueta: t('cuest.profundidad.estandar.corto'), desc: t('cuest.mat.estandar.desc') },
      { valor: 'fondo', etiqueta: t('cuest.profundidad.fondo'), desc: t('cuest.mat.fondo.desc') },
    ],
  },
  {
    id: 'preguntas', titulo: t('cuest.mat.preguntas.titulo'), tipo: 'una',
    opciones: [
      { valor: 'conceptuales', etiqueta: t('cuest.mat.conceptuales'), desc: t('cuest.mat.conceptuales.desc') },
      { valor: 'practicas', etiqueta: t('cuest.mat.practicas'), desc: t('cuest.mat.practicas.desc') },
      { valor: 'mezcla', etiqueta: t('cuest.mat.mezcla'), desc: t('cuest.mat.mezcla.desc') },
    ],
  },
  {
    id: 'cantidad', titulo: t('cuest.mat.cantidad.titulo'), tipo: 'una',
    opciones: [
      { valor: 'pocas', etiqueta: t('cuest.mat.pocas'), desc: t('cuest.mat.pocas.desc') },
      { valor: 'normal', etiqueta: t('cuest.mat.normal'), desc: t('cuest.mat.normal.desc') },
      { valor: 'muchas', etiqueta: t('cuest.mat.muchas'), desc: t('cuest.mat.muchas.desc') },
    ],
  },
  {
    id: 'enfoque', titulo: t('cuest.mat.enfoque.titulo'), tipo: 'texto', opcional: true,
    placeholder: t('cuest.mat.enfoque.placeholder'),
  },
]
