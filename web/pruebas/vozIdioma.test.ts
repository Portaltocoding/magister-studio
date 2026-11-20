// Qué voz suena en cada idioma: la de Magister (Piper) si hay una de ese idioma; si no, la del navegador en ese idioma.
// voz.ts toca `window` y `fetch` al cargarse: unos mínimos de mentira antes.
import { test } from 'node:test'
import assert from 'node:assert/strict'

;(globalThis as unknown as { window: unknown }).window = { addEventListener() {}, dispatchEvent() {} }
;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {}
globalThis.fetch = (async () => new Response('[]')) as typeof fetch

const { elegirVozMagister, elegirVozNavegador, mejorVozLocal, pronunciar, LENGUA } = await import('../src/componentes/voz.ts')
const { fijarIdioma } = await import('../src/i18n/i18n.ts')

const piper = [
  { id: 'sharvard-f', nombre: 'Sharvard' },
  { id: 'davefx', nombre: 'Davefx', idioma: 'es' as const },
]
const navegador = [
  { name: 'Microsoft Helena', lang: 'es-ES', localService: true },
  { name: 'Microsoft Zira', lang: 'en-US', localService: true },
  { name: 'Google UK English', lang: 'en-GB', localService: false },
  { name: 'Microsoft Aria Online (Natural)', lang: 'en-US', localService: false },
]

test('sin voz de Magister en inglés, el inglés va por el navegador', () => {
  assert.equal(elegirVozMagister(piper, null, 'es'), 'sharvard-f')
  assert.equal(elegirVozMagister(piper, 'piper:davefx', 'es'), 'davefx')
  assert.equal(elegirVozMagister(piper, null, 'en'), null)
  assert.equal(elegirVozMagister(piper, 'piper:davefx', 'en'), null)
  assert.equal(elegirVozMagister(piper, 'navegador', 'es'), null)
})

test('con una voz de Magister en inglés, esa suena en inglés y las españolas siguen en español', () => {
  const con = [...piper, { id: 'lessac', nombre: 'Lessac', idioma: 'en' as const }]
  assert.equal(elegirVozMagister(con, null, 'en'), 'lessac')
  assert.equal(elegirVozMagister(con, 'piper:davefx', 'en'), 'lessac')
  assert.equal(elegirVozMagister(con, null, 'es'), 'sharvard-f')
})

test('la voz del navegador es del idioma pedido: la natural si hay, si no la local', () => {
  assert.equal(elegirVozNavegador(navegador, null, 'es')?.name, 'Microsoft Helena')
  assert.equal(elegirVozNavegador(navegador, null, 'en')?.name, 'Microsoft Aria Online (Natural)')
  assert.equal(elegirVozNavegador(navegador.slice(0, 3), null, 'en')?.name, 'Microsoft Zira')
  // Una voz elegida de otro idioma no vale.
  assert.equal(elegirVozNavegador(navegador, 'Microsoft Helena', 'en')?.name, 'Microsoft Aria Online (Natural)')
  assert.equal(mejorVozLocal([navegador[0]], 'en'), null)
  assert.equal(LENGUA.en, 'en-US')
})

test('en inglés la voz no pasa por el glosario español', () => {
  assert.notEqual(pronunciar('Cada pedido tiene su id'), 'Cada pedido tiene su id')
  fijarIdioma('en')
  assert.equal(pronunciar('Each order has its id'), 'Each order has its id')
  fijarIdioma('es')
})
