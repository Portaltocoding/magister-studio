// Tus datos en Ajustes: tamaños, nombres de las copias, la palabra para restaurar y el nombre de la descarga.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avisoRestaurar, confirmaRestaurar, nombreDescarga, tamano, tipoCopia } from '../src/paneles/datosAjustes.ts'

test('restaurar solo se confirma escribiendo RESTAURAR', () => {
  assert.equal(confirmaRestaurar('RESTAURAR'), true)
  assert.equal(confirmaRestaurar('  RESTAURAR '), true)
  assert.equal(confirmaRestaurar('restaurar'), false)
  assert.equal(confirmaRestaurar(''), false)
})

test('los tamaños se leen en B, KB y MB', () => {
  assert.equal(tamano(500), '500 B')
  assert.equal(tamano(265739), '260 KB')
  assert.equal(tamano(810140 * 10), '7,7 MB')
})

test('cada carpeta de copias tiene su nombre', () => {
  assert.equal(tipoCopia('diarias'), 'Diaria')
  assert.equal(tipoCopia('antes-de-restaurar'), 'Antes de restaurar')
  assert.equal(tipoCopia('antes-de-empezar-de-0'), 'antes de empezar de 0')
})

test('el aviso dice la fecha y que se pierde lo posterior', () => {
  const aviso = avisoRestaurar('2026-11-18T12:00:00+00:00')
  assert.match(aviso, /2026/)
  assert.match(aviso, /después/)
})

test('la descarga se llama como dice el servidor o magister-AAAA-MM-DD.zip', () => {
  assert.equal(nombreDescarga('attachment; filename="magister-2026-11-19.zip"', new Date(2026, 0, 1)), 'magister-2026-11-19.zip')
  assert.equal(nombreDescarga(null, new Date(2026, 10, 9)), 'magister-2026-11-09.zip')
})
