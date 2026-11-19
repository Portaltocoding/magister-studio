// Un solo reloj en el foco: el pomodoro manda; sin él, el reloj cuenta lo que llevas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearPomodoro, mmssDe, relojParado, textoReloj } from '../src/componentes/relojFoco.ts'

const corriendo = { fase: 'foco' as const, fin: 1_000_000 }
const pausadoPomo = { fase: 'foco' as const, fin: null }
const parado = { fase: null, fin: null }

test('crearPomodoro: solo sin ninguno en marcha, con pausa elegida y la lección abierta', () => {
  assert.equal(crearPomodoro(parado, 25, false), true)
  assert.equal(crearPomodoro(corriendo, 25, false), false) // el que traías de fuera se respeta
  assert.equal(crearPomodoro({ fase: 'descanso', fin: 5 }, 25, false), false)
  assert.equal(crearPomodoro(parado, 0, false), false) // «sin pausa»
  assert.equal(crearPomodoro(parado, 25, true), false) // en el cierre, no
})

test('relojParado: con pomodoro, el suyo; sin él, la pausa del foco', () => {
  assert.equal(relojParado(corriendo, true), false)
  assert.equal(relojParado(pausadoPomo, false), true)
  assert.equal(relojParado(parado, true), true)
  assert.equal(relojParado(parado, false), false)
})

test('textoReloj: cuenta atrás con su fase; en zen, minutos redondeando hacia arriba', () => {
  assert.deepEqual(textoReloj({ p: corriendo, quedan: 12 * 60_000 + 7_000, segundos: 999, zen: false }), { tiempo: '12:07', fase: 'pomodoro' })
  assert.deepEqual(textoReloj({ p: corriendo, quedan: 12 * 60_000 + 7_000, segundos: 999, zen: true }), { tiempo: '13 min', fase: 'pomodoro' })
  assert.deepEqual(textoReloj({ p: corriendo, quedan: 20_000, segundos: 0, zen: true }), { tiempo: '1 min', fase: 'pomodoro' })
  assert.deepEqual(textoReloj({ p: { fase: 'descanso', fin: 1 }, quedan: 4 * 60_000 + 1_500, segundos: 0, zen: false }), { tiempo: '4:02', fase: 'descanso' })
  assert.deepEqual(textoReloj({ p: pausadoPomo, quedan: null, segundos: 0, zen: false }), { tiempo: '0:00', fase: 'pomodoro' })
})

test('textoReloj: sin pomodoro, lo que llevas (y en zen, en minutos)', () => {
  assert.deepEqual(textoReloj({ p: parado, quedan: null, segundos: 125, zen: false }), { tiempo: '2:05', fase: null })
  assert.deepEqual(textoReloj({ p: parado, quedan: null, segundos: 3725, zen: false }), { tiempo: '1:02:05', fase: null })
  assert.deepEqual(textoReloj({ p: parado, quedan: null, segundos: 725, zen: true }), { tiempo: '12 min', fase: null })
})

test('mmssDe redondea hacia arriba y no baja de cero', () => {
  assert.equal(mmssDe(1), '0:01')
  assert.equal(mmssDe(-5), '0:00')
  assert.equal(mmssDe(25 * 60_000), '25:00')
})
