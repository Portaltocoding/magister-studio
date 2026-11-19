// La ruta de la app: qué pantalla pide y cuándo hay que escribirla.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hayQueEscribir, leerRuta, rutaDe } from '../src/rutas.ts'

test('cada ruta abre su pantalla', () => {
  assert.deepEqual(leerRuta(''), { modo: 'hoy', conversacion: null, nuevoPlan: false })
  assert.deepEqual(leerRuta('#/roadmap'), { modo: 'roadmap', conversacion: null, nuevoPlan: false })
  assert.deepEqual(leerRuta('#/conversacion/6'), { modo: 'libre', conversacion: 6, nuevoPlan: false })
  assert.deepEqual(leerRuta('#/fichas/3/L2'), { modo: 'fichas', conversacion: null, nuevoPlan: false })
  assert.deepEqual(leerRuta('#/no-existe'), { modo: 'libre', conversacion: null, nuevoPlan: false })
})

test('el cuestionario del plan tiene su ruta y se conserva (recargar no lo pierde)', () => {
  const r = leerRuta('#/nuevo-plan')
  assert.deepEqual(r, { modo: 'libre', conversacion: null, nuevoPlan: true })
  assert.equal(rutaDe(r.modo, r.conversacion, 'plan'), '#/nuevo-plan')
  assert.ok(!hayQueEscribir('#/nuevo-plan', rutaDe('libre', null, 'plan')))
})

test('la ruta de cada pantalla', () => {
  assert.equal(rutaDe('libre', 6, 'libre'), '#/conversacion/6')
  assert.equal(rutaDe('libre', 6, 'plan'), '#/conversacion/6')
  assert.equal(rutaDe('libre', null, 'libre'), '#/libre')
  assert.equal(rutaDe('roadmap', null, 'plan'), '#/roadmap')
})

test('no se reescribe la misma ruta ni la que lleva algo detrás para el panel', () => {
  assert.ok(!hayQueEscribir('#/roadmap', '#/roadmap'))
  assert.ok(!hayQueEscribir('#/fichas/3/L2', '#/fichas'))
  assert.ok(!hayQueEscribir('#/foco/12/3', '#/foco'))
  assert.ok(hayQueEscribir('#/fichas', '#/roadmap'))
  assert.ok(hayQueEscribir('#/foco', '#/fichas'), '«#/foco» no empieza por «#/fichas/»')
  assert.ok(hayQueEscribir('', '#/hoy'))
})
