// El cuestionario del plan: la fecha límite y las horas que se ofrecen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorFecha, explicarHoras, fechaMaxima, fechaMinima, mensajePlan, sugerirHoras } from '../src/componentes/cuestionarios.ts'

const HOY = new Date(2026, 10, 19, 10) // 19 de noviembre de 2026, 10:00

test('la fecha mínima es mañana y la máxima, dentro de cinco años', () => {
  assert.equal(fechaMinima(HOY), '2026-11-20')
  assert.equal(fechaMaxima(HOY).slice(0, 4), '2031')
})

test('una fecha pasada, de hoy o absurda no vale; mañana sí, y lo que no es fecha no se juzga', () => {
  assert.match(errorFecha('2026-11-18', HOY)!, /ya ha pasado/)
  assert.match(errorFecha('2026-11-19', HOY)!, /ya ha pasado o es hoy/)
  assert.match(errorFecha('2999-01-01', HOY)!, /cinco años/)
  assert.equal(errorFecha('2026-11-20', HOY), null)
  assert.equal(errorFecha('en un mes', HOY), null)
  assert.equal(errorFecha(undefined, HOY), null)
})

const fondo = { profundidad: 'fondo', nivel: 'basico' } // 50 h

test('si la fecha no da para un ritmo humano, no hay opciones y se avisa (en singular con un día)', () => {
  const r = { ...fondo, plazo: '2026-11-20' }
  assert.deepEqual(sugerirHoras(r, HOY), [])
  const ayuda = explicarHoras(r, HOY)
  assert.match(ayuda, /en 1 día no caben/)
  assert.doesNotMatch(ayuda, /1 días/)
})

test('la opción con holgura solo sale si también cabe', () => {
  // 50 h en unas tres semanas: de lunes a viernes pasa de 4 h al día con holgura.
  const justo = sugerirHoras({ ...fondo, plazo: '2026-12-12' }, HOY)
  assert.ok(justo.every((o) => !o.desc?.includes('holgura')), JSON.stringify(justo))
  // Con tres meses, sí hay holgura y todas las opciones son razonables.
  const holgado = sugerirHoras({ ...fondo, plazo: 'en tres meses' }, HOY)
  assert.ok(holgado.some((o) => o.desc?.includes('holgura')))
  for (const o of holgado) {
    const h = /^(\d+) h/.exec(o.etiqueta)
    assert.ok(!h || Number(h[1]) <= 6, o.etiqueta)
  }
})

test('con tiempo de sobra, la ayuda dice días en plural y las horas por semana', () => {
  assert.match(explicarHoras({ ...fondo, plazo: 'en tres meses' }, HOY), /^Unas 50 h en 90 días: unas \d+ h por semana/)
})

test('el mensaje del plan escribe la fecha en letra', () => {
  const m = mensajePlan({ tema: 'SQL', objetivo: 'un examen', nivel: 'nada', profundidad: 'esencial', plazo: '2026-12-20', horas: '1 h', franja: 'por las tardes' })
  assert.match(m, /antes del 20 de diciembre de 2026/)
  assert.match(m, /Mi nivel: empiezo de cero\./)
  assert.match(mensajePlan({ tema: 'SQL', nivel: 'basico' }), /Mi nivel: lo básico\./)
})
