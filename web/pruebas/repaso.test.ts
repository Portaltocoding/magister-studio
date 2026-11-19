// Repaso, examen y progreso: la lógica pura detrás de lo que encontró el probador.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  borrarExamen,
  claveExamen,
  contador,
  guardarExamen,
  leerExamen,
  repasosDelPlan,
  siguienteLeccion,
  tandaQueSigue,
  textoError,
  textoOtraVez,
  tipoDeIntento,
  ultimoSinVer,
} from '../src/componentes/repaso.ts'

test('la vuelta de hoy (también la de tipo test) es un reintento, no un repaso', () => {
  assert.equal(tipoDeIntento(true, false), 'reintento')
  assert.equal(tipoDeIntento(false, true), 'reintento')
  assert.equal(tipoDeIntento(undefined, false), 'espaciado')
})

test('no se promete «otra pregunta» si el concepto solo tiene una', () => {
  assert.match(textoOtraVez(false), /misma pregunta/)
  assert.doesNotMatch(textoOtraVez(false), /otra pregunta/)
  assert.match(textoOtraVez(true), /otra pregunta/)
})

test('un error solo va entre comillas si es una cita literal tuya', () => {
  assert.equal(textoError({ afirmacion: 'se repite', por_que: 'no', literal: true }), '«se repite»: no')
  assert.equal(textoError({ afirmacion: 'Dice que se repite', por_que: 'no', literal: false }), 'Dice que se repite: no')
  assert.equal(textoError({ afirmacion: 'x', por_que: 'y' }), 'x: y')
})

test('el contador de la caja aparece cerca del tope y avisa al pasarse', () => {
  assert.deepEqual(contador(100), { texto: '100 / 8.000', visible: false, pasado: false })
  assert.equal(contador(7000).visible, true)
  assert.deepEqual(contador(9000), { texto: '9.000 / 8.000', visible: true, pasado: true })
})

test('«Seguir repasando» continúa la tanda con su contador', () => {
  const ahora = 1_000_000_000
  const guardada = { total: 4, hechas: 1, en: ahora - 60_000 }
  assert.deepEqual(tandaQueSigue(guardada, ahora, 3), { total: 4, hechas: 1 })
  assert.deepEqual(tandaQueSigue(guardada, ahora, 5), { total: 6, hechas: 1 })
  assert.equal(tandaQueSigue(guardada, ahora, 0), null)
  assert.equal(tandaQueSigue({ ...guardada, en: ahora - 13 * 3600_000 }, ahora, 3), null)
  assert.equal(tandaQueSigue(null, ahora, 3), null)
})

test('tras recargar se enseña el último intento si es reciente y no lo viste', () => {
  const ahora = Date.parse('2026-11-19T21:00:00Z')
  const u = { intento_id: 'a', momento: '2026-11-19T20:50:00Z' }
  assert.equal(ultimoSinVer(u, null, ahora), true)
  assert.equal(ultimoSinVer(u, 'a', ahora), false)
  assert.equal(ultimoSinVer({ ...u, momento: '2026-11-19T18:00:00Z' }, null, ahora), false)
  assert.equal(ultimoSinVer(null, null, ahora), false)
})

function almacenFalso() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

test('un examen en marcha se guarda y se recupera al recargar', () => {
  const a = almacenFalso()
  assert.equal(leerExamen(a), null)
  guardarExamen({ examen: { id: 7 }, respuestas: { p1: { texto: 'hola' } }, i: 2, inicio: 123 }, a)
  const g = leerExamen<{ id: number }, { texto: string }>(a)
  assert.equal(g?.examen.id, 7)
  assert.equal(g?.respuestas.p1.texto, 'hola')
  assert.equal(g?.i, 2)
  borrarExamen(a)
  assert.equal(leerExamen(a), null)
  a.setItem('magister-examen-en-curso', '{roto')
  assert.equal(leerExamen(a), null)
})

test('la clave de una respuesta de examen es estable (la misma que la del servidor)', () => {
  assert.equal(claveExamen(12, 'p-3-L1-02'), 'examen-12-p-3-L1-02')
  assert.equal(claveExamen(12, 'p-3-L1-02'), claveExamen(12, 'p-3-L1-02'))
})

test('lo siguiente de un plan es su primera lección sin hacer', () => {
  const ls = [
    { clave: 'L1', estado: 'hecha' },
    { clave: 'L2', estado: 'empezada' },
    { clave: 'L3', estado: 'pendiente' },
  ]
  assert.equal(siguienteLeccion(ls)?.clave, 'L2')
  assert.equal(siguienteLeccion([{ clave: 'L1', estado: 'hecha' }]), null)
  assert.equal(repasosDelPlan([{ plan_id: 1 }, { plan_id: 2 }, { plan_id: 1 }], 1), 2)
})
