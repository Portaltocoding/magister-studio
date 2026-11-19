// La baraja de las opciones tipo test: estable por pregunta e igual que la del PDF (servidor, plantillas.barajar).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barajar } from '../src/barajar.ts'

test('barajar: los mismos vectores que el servidor', () => {
  assert.deepEqual(barajar(['a', 'b', 'c', 'd'], '1'), ['a', 'b', 'd', 'c'])
  assert.deepEqual(barajar(['a', 'b', 'c', 'd'], '42'), ['d', 'a', 'c', 'b'])
  assert.deepEqual(barajar(['a', 'b', 'c', 'd'], '1234'), ['c', 'a', 'b', 'd'])
  assert.deepEqual(barajar(['a', 'b', 'c'], '1234'), ['b', 'a', 'c'])
})

test('barajar: misma pregunta, mismo orden; la buena no siempre arriba', () => {
  const opciones = [{ texto: 'buena', buena: true }, { texto: 'x', buena: false }, { texto: 'y', buena: false }]
  assert.deepEqual(barajar(opciones, '77'), barajar(opciones, '77'))
  assert.equal(opciones[0].texto, 'buena') // no toca la lista original
  const sitios = new Set<number>()
  for (let s = 1; s < 40; s++) sitios.add(barajar(opciones, String(s)).findIndex((o) => o.buena))
  assert.deepEqual([...sitios].sort(), [0, 1, 2])
})
