// Leer en voz alta en el foco: qué se lee y qué solo se anuncia (código, tablas, fórmulas), y en qué frases.
// voz.ts toca `window` y `fetch` al cargarse: se ponen unos mínimos antes.
import { test } from 'node:test'
import assert from 'node:assert/strict'

;(globalThis as unknown as { window: unknown }).window = { addEventListener() {}, dispatchEvent() {} }
;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {}
const { frasesDe, PAUSA_MS, queDecir } = await import('../src/componentes/lecturaVoz.ts')

test('un párrafo se lee, sin espacios de más', () => {
  assert.deepEqual(queDecir({ tag: 'P', texto: '  Una petición lleva\n cuatro piezas.  ' }), { leer: true, texto: 'Una petición lleva cuatro piezas.' })
})

test('el código se anuncia con sus líneas y no se lee', () => {
  assert.deepEqual(queDecir({ tag: 'PRE', texto: 'a\nb\nc\n' }), { leer: false, texto: 'Bloque de código, 3 líneas' })
  assert.deepEqual(queDecir({ tag: 'PRE', texto: 'solo una' }), { leer: false, texto: 'Bloque de código, 1 línea' })
  assert.deepEqual(queDecir({ tag: 'DIV', texto: 'x', lineas: 12 }), { leer: false, texto: 'Bloque de código, 12 líneas' })
})

test('las tablas y las fórmulas en bloque se anuncian', () => {
  assert.deepEqual(queDecir({ tag: 'TABLE', texto: '', filas: 4 }), { leer: false, texto: 'Tabla, 4 filas' })
  assert.deepEqual(queDecir({ tag: 'TABLE', texto: '', filas: 1 }), { leer: false, texto: 'Tabla, 1 fila' })
  assert.deepEqual(queDecir({ tag: 'P', texto: '', formula: true }), { leer: false, texto: 'Fórmula, en pantalla' })
})

test('una imagen sin texto se anuncia; algo vacío no dice nada', () => {
  assert.deepEqual(queDecir({ tag: 'FIGURE', texto: ' ', imagen: true }), { leer: false, texto: 'Imagen, en pantalla' })
  assert.deepEqual(frasesDe(queDecir({ tag: 'DIV', texto: '' })), [])
})

test('frasesDe: lo que se lee va por frases; lo anunciado, de una vez', () => {
  assert.deepEqual(frasesDe(queDecir({ tag: 'P', texto: 'El cliente pide. El servidor contesta, p. ej. con un 200.' })), [
    'El cliente pide.',
    'El servidor contesta, p. ej. con un 200.',
  ])
  assert.deepEqual(frasesDe(queDecir({ tag: 'PRE', texto: 'x\ny' })), ['Bloque de código, 2 líneas'])
})

test('entre párrafo y párrafo, una pausa corta', () => {
  assert.equal(PAUSA_MS, 600)
})
