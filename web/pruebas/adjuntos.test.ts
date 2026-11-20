import test from 'node:test'
import assert from 'node:assert/strict'
import { clasificar, paraEnviar, MAX_BYTES } from '../src/componentes/adjuntosPuro.ts'

const f = (name: string, size = 1000) => ({ name, size })

test('acepta los tipos que lee el servidor, sin mirar mayúsculas', () => {
  const r = clasificar([f('Guia agente cloud.PDF'), f('notas.md'), f('x.htm')], [])
  assert.equal(r.aceptados.length, 3)
  assert.deepEqual(r.rechazados, [])
})

test('un clic que no puede adjuntar dice por qué', () => {
  const r = clasificar([f('foto.png'), f('vacio.pdf', 0), f('enorme.pdf', MAX_BYTES + 1)], [])
  assert.deepEqual(r.rechazados.map((x) => x.motivo), ['tipo', 'vacio', 'grande'])
})

test('el mismo fichero dos veces: el segundo se rechaza como repetido, salvo que el primero fallara', () => {
  const ya = [{ nombre: 'a.pdf', tamano: 1000, estado: 'listo' as const }]
  assert.equal(clasificar([f('a.pdf')], ya).rechazados[0].motivo, 'repetido')
  assert.equal(clasificar([f('a.pdf')], [{ ...ya[0], estado: 'error' }]).aceptados.length, 1)
  assert.equal(clasificar([f('a.pdf', 2000)], ya).aceptados.length, 1) // otro tamaño: otro fichero
  const lote = clasificar([f('b.pdf'), f('b.pdf')], [])
  assert.equal(lote.aceptados.length, 1)
  assert.equal(lote.rechazados[0].motivo, 'repetido')
})

test('con el mensaje viajan los adjuntos listos o leyéndose, sin repetir', () => {
  const adj = [
    { estado: 'listo', version_id: 4 },
    { estado: 'indexando', version_id: 5 },
    { estado: 'subiendo', version_id: null },
    { estado: 'error', version_id: 6 },
    { estado: 'listo', version_id: 4 },
  ]
  assert.deepEqual(paraEnviar(adj), [4, 5])
})
