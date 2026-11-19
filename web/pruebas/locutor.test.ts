// El Locutor con la voz de Magister: decirTodo encola todo antes de empezar, así la primera frase ya pide el audio de
// las dos siguientes (sin hueco de silencio), y la petición es la misma que usa el vídeo para medir.
// voz.ts toca `window`, `fetch` y `Audio` al cargarse: se ponen unos mínimos de mentira antes.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const pedidas: { url: string; cuerpo: { texto: string; voz: string } | null }[] = []
;(globalThis as unknown as { window: unknown }).window = { addEventListener() {}, dispatchEvent() {} }
;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {}
;(globalThis as unknown as { Audio: unknown }).Audio = class {
  playbackRate = 1
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  play() {
    return new Promise(() => undefined)
  }
  pause() {}
}
globalThis.fetch = (async (url: string, init?: { body?: string }) => {
  pedidas.push({ url, cuerpo: init?.body ? JSON.parse(init.body) : null })
  if (url === '/api/voz/voces') return new Response(JSON.stringify([{ id: 'davefx', nombre: 'Davefx' }]))
  return new Response(new Uint8Array([1, 2, 3]))
}) as typeof fetch

const { Locutor, pedirVozMagister, pronunciar, vocesMagisterListas } = await import('../src/componentes/voz.ts')
await vocesMagisterListas
const tic = () => new Promise((r) => setTimeout(r, 5))
const dichas = () => pedidas.filter((p) => p.url === '/api/voz').map((p) => p.cuerpo?.texto)

test('decirTodo pide ya las dos frases siguientes', async () => {
  pedidas.length = 0
  const l = new Locutor()
  l.decirTodo(['Ana paga,', 'el servidor cobra.', 'Y responde.', 'Fin.'])
  await tic()
  assert.deepEqual(dichas().sort(), ['Ana paga,', 'el servidor cobra.', 'Y responde.'].map(pronunciar).sort())
  l.parar()
})

test('con decir() una a una, al empezar solo se pide la primera (el hueco que arregla decirTodo)', async () => {
  pedidas.length = 0
  const l = new Locutor()
  for (const f of ['Ana paga,', 'el servidor cobra.', 'Y responde.']) l.decir(f)
  await tic()
  assert.deepEqual(dichas(), [pronunciar('Ana paga,')])
  l.parar()
})

test('el vídeo pide exactamente lo mismo que el Locutor (así el servidor tira de su caché)', async () => {
  pedidas.length = 0
  await pedirVozMagister('Idempotency-Key, otra vez.', 'davefx')
  assert.deepEqual(pedidas[0].cuerpo, { texto: pronunciar('Idempotency-Key, otra vez.'), voz: 'davefx' })
})
