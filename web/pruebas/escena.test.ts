// El vídeo: frases, pausas para respirar y duración de cada tramo según la velocidad de voz.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duracionTramo, frases, respiros } from '../src/escena/tipos.ts'

test('las pausas cortan en comas, pero no en la coma decimal', () => {
  assert.deepEqual(respiros('Está en el punto A, de coordenadas: mil, dos mil.'), ['Está en el punto A,', 'de coordenadas:', 'mil,', 'dos mil.'])
  assert.deepEqual(respiros('B queda en 1121,353, 2088,168.'), ['B queda en 1121,353,', '2088,168.'])
})

test('las frases se separan en el punto y la siguiente mayúscula', () => {
  assert.deepEqual(frases('Ana paga. ¿Y si falla? El servidor cobra.'), ['Ana paga.', '¿Y si falla?', 'El servidor cobra.'])
})

test('con voz lenta el tramo dura más, con voz rápida menos', () => {
  const t = { concepto: 'x', tesis: 'y', narracion: Array(60).fill('palabra').join(' '), escena: { tipo: 'pregunta', pregunta: '?' } } as const
  assert.ok(duracionTramo(t, 0.8) > duracionTramo(t, 1) && duracionTramo(t, 1) > duracionTramo(t, 1.5))
})
