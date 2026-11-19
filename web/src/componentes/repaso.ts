// Lógica pura de Repaso y Examen (sin React): qué tipo de intento es, qué se promete, cómo se pinta un error del
// corrector, cuándo seguir una tanda a medias y qué guardar de un examen en marcha. La prueban los tests de Node.

export const MAX_RESPUESTA = 8000

// La vuelta de hoy a algo que fallaste («otra vez») o «Reintentar (no cuenta)»: no mueve el repaso ni el modelo.
export function tipoDeIntento(otraVez: boolean | undefined, reintentando: boolean): 'espaciado' | 'reintento' {
  return otraVez || reintentando ? 'reintento' : 'espaciado'
}

// Lo que se dice al servir una vuelta: «otra pregunta» solo si de verdad la hay.
export function textoOtraVez(otraPregunta: boolean | undefined): string {
  return otraPregunta === false
    ? 'Otra vez, con la misma pregunta: hoy la fallaste y este concepto no tiene otra. Acertarla basta. No cuenta para tu repaso.'
    : 'Otra vez, con otra pregunta: hoy lo fallaste. Acertarlo una vez basta. No cuenta para tu repaso.'
}

// Un error del corrector: entre «» solo si la afirmación está tal cual en tu respuesta (el servidor lo comprueba);
// si no, es un resumen del corrector y se dice como tal.
export function textoError(e: { afirmacion: string; por_que: string; literal?: boolean }): string {
  return e.literal ? `«${e.afirmacion}»: ${e.por_que}` : `${e.afirmacion}: ${e.por_que}`
}

// El contador de la caja de respuesta: se enseña al acercarse al tope.
export function contador(n: number, max = MAX_RESPUESTA): { texto: string; visible: boolean; pasado: boolean } {
  // A mano: en es-ES, toLocaleString no agrupa los números de cuatro cifras (8000, no 8.000).
  const miles = (x: number) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return { texto: `${miles(n)} / ${miles(max)}`, visible: n >= max * 0.8, pasado: n > max }
}

export interface TandaGuardada {
  total: number
  hechas: number
  en: number
}

// «Seguir repasando»: una tanda guardada de hace menos de 12 horas continúa sola, con su contador (2 de 4, no 1 de 3).
// Si la cola ha crecido (algo nuevo vence), el total crece con ella.
export function tandaQueSigue(
  guardada: TandaGuardada | null,
  ahora: number,
  enCola: number,
): { total: number; hechas: number } | null {
  if (!guardada || enCola <= 0 || ahora - guardada.en > 12 * 3600 * 1000) return null
  return { total: Math.max(guardada.total, guardada.hechas + enCola), hechas: guardada.hechas }
}

// Tras recargar a mitad de una corrección: se enseña el último intento si es de hace poco y aún no lo viste entero.
export function ultimoSinVer(
  ultimo: { intento_id: string; momento: string } | null,
  visto: string | null,
  ahora: number,
  minutos = 60,
): boolean {
  if (!ultimo || ultimo.intento_id === visto) return false
  return ahora - Date.parse(ultimo.momento) <= minutos * 60 * 1000
}

// ---------- Examen ----------

// La clave de una respuesta de examen: la misma que usa el servidor al corregir de una vez, así corregir de una en una
// después de un fallo no duplica intentos.
export const claveExamen = (examenId: number, preguntaId: string) => `examen-${examenId}-${preguntaId}`

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const CLAVE_EXAMEN = 'magister-examen-en-curso'

export interface ExamenGuardado<E, R> {
  examen: E
  respuestas: Record<string, R>
  i: number
  inicio: number
}

function almacen(a?: Almacen): Almacen | null {
  if (a) return a
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

// El examen en marcha y lo que llevas respondido, en sessionStorage: recargar no lo pierde (cerrar la pestaña, sí).
export function guardarExamen<E extends { id: number }, R>(g: ExamenGuardado<E, R>, a?: Almacen): void {
  try {
    almacen(a)?.setItem(CLAVE_EXAMEN, JSON.stringify(g))
  } catch {
    /* sin almacenamiento o lleno: se sigue sin guardar */
  }
}

export function leerExamen<E extends { id: number }, R>(a?: Almacen): ExamenGuardado<E, R> | null {
  try {
    const g = JSON.parse(almacen(a)?.getItem(CLAVE_EXAMEN) ?? 'null')
    return g && g.examen && typeof g.examen.id === 'number' && g.respuestas && typeof g.inicio === 'number'
      ? { ...g, i: Number.isInteger(g.i) ? g.i : 0 }
      : null
  } catch {
    return null
  }
}

export function borrarExamen(a?: Almacen): void {
  try {
    almacen(a)?.removeItem(CLAVE_EXAMEN)
  } catch {
    /* nada que borrar */
  }
}

// ---------- Progreso ----------

// «Lo siguiente» de un plan: su primera lección sin hacer, en el orden del plan (no la de otro plan).
export function siguienteLeccion<L extends { clave: string; estado: string }>(lecciones: L[]): L | null {
  return lecciones.find((l) => l.estado !== 'hecha') ?? null
}

// Los repasos pendientes de un plan (la cola es de todos los planes).
export const repasosDelPlan = (cola: { plan_id: number }[], planId: number) => cola.filter((c) => c.plan_id === planId).length
