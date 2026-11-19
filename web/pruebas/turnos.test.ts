// El hilo del chat: qué flujo manda, qué queda si el envío falla, cuándo se recarga una conversación y cuánto cabe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearTurnos, demasiadoLargo, largoMensaje, LIMITE_MENSAJE, recienCreadaTras, trasFalloAlEnviar } from '../src/componentes/turnos.ts'

test('al soltar, el flujo anterior deja de mandar y el siguiente sí manda', () => {
  const t = crearTurnos()
  const a = t.nuevo()
  assert.ok(t.vigente(a))
  t.soltar() // cambias de conversación mientras responde
  assert.ok(!t.vigente(a), 'sus eventos ya no tocan el hilo nuevo')
  const b = t.nuevo()
  assert.ok(t.vigente(b))
  assert.ok(!t.vigente(a))
})

test('un flujo nuevo deja atrás al anterior aunque no se haya soltado', () => {
  const t = crearTurnos()
  const a = t.nuevo()
  const b = t.nuevo()
  assert.ok(!t.vigente(a))
  assert.ok(t.vigente(b))
})

test('si el envío falla antes de empezar, tu mensaje se queda y solo se cambia la burbuja vacía del tutor', () => {
  const previas = ['antiguo', 'tu mensaje', 'tutor vacío']
  assert.deepEqual(trasFalloAlEnviar(previas, 'error'), ['antiguo', 'tu mensaje', 'error'])
  // Al aceptar un plan no hay mensaje tuyo: solo se cambia la del tutor.
  assert.deepEqual(trasFalloAlEnviar(['antiguo', 'tutor vacío'], 'error'), ['antiguo', 'error'])
})

test('la recién creada deja de serlo al abrir otra, y al volver se recarga', () => {
  assert.equal(recienCreadaTras(7, 7), 7, 'mientras sigues en ella, no se recarga')
  assert.equal(recienCreadaTras(7, 9), null, 'abres otra')
  assert.equal(recienCreadaTras(7, null), null, 'pulsas «nueva conversación»')
  assert.equal(recienCreadaTras(null, 7), null)
})

test('el límite de longitud cuenta como el servidor', () => {
  assert.equal(LIMITE_MENSAJE, 20_000)
  assert.ok(!demasiadoLargo('a'.repeat(20_000)))
  assert.ok(demasiadoLargo('a'.repeat(20_001)))
  // Los espacios de los bordes no cuentan: se recortan antes de enviar.
  assert.ok(!demasiadoLargo(`  ${'a'.repeat(20_000)}\n\n`))
  // Un emoji es un carácter para el servidor aunque en JavaScript ocupe dos unidades.
  const emojis = '😀'.repeat(15_000)
  assert.equal(emojis.length, 30_000)
  assert.equal(largoMensaje(emojis), 15_000)
  assert.ok(!demasiadoLargo(emojis))
})
