// Las teclas de los reproductores de vídeo: cuándo son suyas y cuándo de otro.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accionDeTecla, fotogramaTrasTecla, teclaDelReproductor, type Destino } from '../src/escena/teclas.ts'
import { SOLAPE } from '../src/escena/tipos.ts'

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

// Un <input> de verdad que no es para escribir: `closest` devuelve el propio elemento, con su tipo.
const entrada = (type: string): Destino => ({ closest: (s: string) => (s.includes('input') ? { tagName: 'INPUT', type } : null) })

test('una casilla no es una caja: el espacio la marca, las demás teclas siguen siendo del vídeo', () => {
  assert.equal(teclaDelReproductor({ key: ' ' }, entrada('checkbox')), false)
  assert.equal(teclaDelReproductor({ key: 'ArrowRight' }, entrada('checkbox')), true)
  assert.equal(teclaDelReproductor({ key: 'm' }, entrada('checkbox')), true)
  // Un deslizador (el volumen) o una opción se mueven con las flechas.
  assert.equal(teclaDelReproductor({ key: 'ArrowLeft' }, entrada('range')), false)
  assert.equal(teclaDelReproductor({ key: 'k' }, entrada('range')), true)
  assert.equal(teclaDelReproductor({ key: 'ArrowRight' }, en('[role="slider"]')), false)
  // En un campo de texto, nada.
  assert.equal(teclaDelReproductor({ key: 'k' }, entrada('text')), false)
  assert.equal(teclaDelReproductor({ key: 'f' }, entrada('search')), false)
})

test('cada tecla hace lo de cualquier reproductor', () => {
  const casos: [Parameters<typeof accionDeTecla>[0], string | null][] = [
    [{ key: ' ' }, 'tocar'],
    [{ key: 'k' }, 'tocar'],
    [{ key: 'K' }, 'tocar'],
    [{ key: 'ArrowLeft' }, 'atras'],
    [{ key: 'ArrowRight' }, 'adelante'],
    [{ key: 'ArrowLeft', shiftKey: true }, 'tramoAnterior'],
    [{ key: 'ArrowRight', shiftKey: true }, 'tramoSiguiente'],
    [{ key: 'j' }, 'tramoAnterior'],
    [{ key: 'l' }, 'tramoSiguiente'],
    [{ key: 'm' }, 'silencio'],
    [{ key: 'f' }, 'pantalla'],
    [{ key: 'ArrowUp' }, null],
    [{ key: 's' }, null],
    [{ key: 'Enter' }, null],
  ]
  for (const [tecla, accion] of casos) assert.equal(accionDeTecla(tecla, en()), accion, tecla.key)
})

test('las teclas no pisan los atajos de la app ni lo que se escribe', () => {
  // Ctrl+K abre la paleta y Ctrl+B la barra lateral; Cmd igual en Mac.
  assert.equal(accionDeTecla({ key: 'k', ctrlKey: true }, en()), null)
  assert.equal(accionDeTecla({ key: 'k', metaKey: true }, en()), null)
  assert.equal(accionDeTecla({ key: 'b', ctrlKey: true }, en()), null)
  assert.equal(accionDeTecla({ key: 'f', ctrlKey: true }, en()), null)
  for (const key of [' ', 'k', 'm', 'f', 'j', 'ArrowLeft']) assert.equal(accionDeTecla({ key }, en('textarea')), null, key)
  // Sobre un botón: el espacio lo pulsa; K, M, F y las flechas son del vídeo.
  assert.equal(accionDeTecla({ key: ' ' }, en('button')), null)
  assert.equal(accionDeTecla({ key: 'k' }, en('button')), 'tocar')
  assert.equal(accionDeTecla({ key: 'ArrowRight', shiftKey: true }, en('button')), 'tramoSiguiente')
})

test('los saltos caen dentro del vídeo y en escenas ya entradas', () => {
  const fps = 30
  const desde = [0, 300, 600]
  const total = 900
  const primero = SOLAPE
  // ← → 5 s, sin pasar del principio (ya entrado) ni del final.
  assert.equal(fotogramaTrasTecla('adelante', 400, desde, total, fps), 550)
  assert.equal(fotogramaTrasTecla('adelante', 850, desde, total, fps), 899)
  assert.equal(fotogramaTrasTecla('atras', 400, desde, total, fps), 250)
  assert.equal(fotogramaTrasTecla('atras', 100, desde, total, fps), primero)
  assert.equal(fotogramaTrasTecla('atras', 3, desde, total, fps), 3) // ya antes de la entrada: no se mueve
  // Siguiente tesis; en la última no hay adónde.
  assert.equal(fotogramaTrasTecla('tramoSiguiente', 10, desde, total, fps), 300 + SOLAPE)
  assert.equal(fotogramaTrasTecla('tramoSiguiente', 700, desde, total, fps), null)
  // Anterior: con la tesis ya empezada (más de 2 s), a su principio; recién entrada, a la de antes.
  assert.equal(fotogramaTrasTecla('tramoAnterior', 500, desde, total, fps), 300 + SOLAPE)
  assert.equal(fotogramaTrasTecla('tramoAnterior', 300 + SOLAPE + 10, desde, total, fps), primero)
  assert.equal(fotogramaTrasTecla('tramoAnterior', 30, desde, total, fps), primero)
})
