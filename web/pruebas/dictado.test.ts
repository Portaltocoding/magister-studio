// El dictado de las comprobaciones habladas: apagado hasta que dices que sí (el audio sale al servicio del navegador),
// la respuesta se recuerda y lo dictado se suma a lo escrito. voz.ts toca `window` al cargarse: se pone uno mínimo antes.
import { test } from 'node:test'
import assert from 'node:assert/strict'

;(globalThis as unknown as { window: unknown }).window = { addEventListener() {}, dispatchEvent() {} }
const { AVISO_DICTADO, enVivo, guardarPermisoDictado, leerPermisoDictado, unirDictado } = await import('../src/componentes/dictado.ts')

const almacen = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

test('sin respuesta guardada no hay permiso: se pregunta', () => {
  assert.equal(leerPermisoDictado(almacen()), null)
  assert.equal(leerPermisoDictado(null), null)
})

test('la respuesta (sí o no) se recuerda', () => {
  const a = almacen()
  guardarPermisoDictado(a, 'si')
  assert.equal(leerPermisoDictado(a), 'si')
  guardarPermisoDictado(a, 'no')
  assert.equal(leerPermisoDictado(a), 'no')
})

test('un almacén que falla no rompe nada', () => {
  const roto = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
  assert.equal(leerPermisoDictado(roto), null)
  guardarPermisoDictado(roto, 'si')
})

test('el aviso dice a dónde va el audio, en una frase', () => {
  assert.match(AVISO_DICTADO, /sale de tu ordenador hacia el servicio de voz del navegador/)
  assert.equal(AVISO_DICTADO.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, 1)
})

test('lo dictado se suma a lo escrito con un espacio; lo provisional se ve detrás', () => {
  assert.equal(unirDictado('', ' Porque HTTP no recuerda '), 'Porque HTTP no recuerda')
  assert.equal(unirDictado('Porque HTTP', 'no recuerda nada'), 'Porque HTTP no recuerda nada')
  assert.equal(unirDictado('Hola  ', 'adiós'), 'Hola adiós')
  assert.equal(unirDictado('Hola', '   '), 'Hola')
  assert.equal(enVivo('Porque', 'el servidor'), 'Porque el servidor')
  assert.equal(enVivo('Porque', ''), 'Porque')
})
