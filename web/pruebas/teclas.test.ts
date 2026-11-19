// Las teclas de los reproductores de vídeo: cuándo son suyas y cuándo de otro.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { teclaDelReproductor, type Destino } from '../src/escena/teclas.ts'

// Un elemento falso: `closest` responde si alguno de sus «antepasados» casa con algún selector de la lista.
const en = (...dentro: string[]): Destino => ({
  closest: (selector: string) => (selector.split(',').map((s) => s.trim()).some((s) => dentro.includes(s)) ? {} : null),
})

test('el espacio con el foco en el cuerpo de la página es del vídeo', () => {
  assert.equal(teclaDelReproductor({ key: ' ' }, en()), true)
  assert.equal(teclaDelReproductor({ key: ' ' }, null), true)
})

test('al escribir en una caja ninguna tecla es del vídeo', () => {
  for (const caja of ['input', 'textarea', 'select', '[role="textbox"]', '[contenteditable]:not([contenteditable="false"])'])
    for (const key of [' ', 'ArrowRight', 's'])
      assert.equal(teclaDelReproductor({ key }, en(caja)), false, `${key} en ${caja}`)
})

test('el espacio sobre un botón lo pulsa a él; las flechas y la S siguen siendo del vídeo', () => {
  assert.equal(teclaDelReproductor({ key: ' ' }, en('button')), false)
  assert.equal(teclaDelReproductor({ key: ' ' }, en('a[href]')), false)
  assert.equal(teclaDelReproductor({ key: ' ' }, en('[role="option"]')), false)
  assert.equal(teclaDelReproductor({ key: 'ArrowRight' }, en('button')), true)
  assert.equal(teclaDelReproductor({ key: 's' }, en('button')), true)
})

test('con Ctrl, Cmd o Alt, o si otro ya la ha usado, la tecla no es del vídeo', () => {
  assert.equal(teclaDelReproductor({ key: ' ', ctrlKey: true }, en()), false)
  assert.equal(teclaDelReproductor({ key: 'ArrowLeft', metaKey: true }, en()), false)
  assert.equal(teclaDelReproductor({ key: 'ArrowLeft', altKey: true }, en()), false)
  assert.equal(teclaDelReproductor({ key: ' ', defaultPrevented: true }, en()), false)
})
