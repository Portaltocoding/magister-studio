// Retomar el foco: la ruta de una lección abierta, a dónde se vuelve al salir y el «Seguir · idea 3, párrafo 6 · hace 2 días».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aplicarIdea, esRutaLeccion, haceCuanto, leerRutaFoco, rutaDeVuelta, rutaFoco, textoSeguir } from '../src/componentes/retomar.ts'

const AHORA = new Date(2026, 10, 19, 10, 0).getTime()
const MIN = 60_000

test('leerRutaFoco: la lista, la de hoy, unos apuntes y su idea', () => {
  assert.deepEqual(leerRutaFoco('#/foco', 'foco'), { entrar: false, mid: null, idea: null })
  assert.deepEqual(leerRutaFoco('#/foco/hoy', 'foco'), { entrar: true, mid: null, idea: null })
  assert.deepEqual(leerRutaFoco('#/foco/12', 'foco'), { entrar: true, mid: 12, idea: null })
  assert.deepEqual(leerRutaFoco('#/foco/12/3', 'foco'), { entrar: true, mid: 12, idea: 3 })
  assert.deepEqual(leerRutaFoco('#/foco/12/x', 'foco'), { entrar: true, mid: 12, idea: null })
  assert.deepEqual(leerRutaFoco('#/foco/abc', 'foco'), { entrar: false, mid: null, idea: null })
  assert.deepEqual(leerRutaFoco('#/hoy/foco', 'hoy'), { entrar: true, mid: null, idea: null })
  assert.deepEqual(leerRutaFoco('#/hoy/foco/12', 'hoy'), { entrar: true, mid: 12, idea: null })
  assert.deepEqual(leerRutaFoco('#/hoy', 'hoy'), { entrar: false, mid: null, idea: null })
})

test('rutaFoco lleva la idea desde 1 y esRutaLeccion la reconoce (la lista y la de hoy no)', () => {
  assert.equal(rutaFoco(12, 2), '#/foco/12/3')
  assert.equal(esRutaLeccion('#/foco/12/3'), true)
  assert.equal(esRutaLeccion('#/foco/12'), true)
  assert.equal(esRutaLeccion('#/hoy/foco/12'), true)
  assert.equal(esRutaLeccion('#/foco'), false)
  assert.equal(esRutaLeccion('#/foco/hoy'), false)
  assert.equal(esRutaLeccion('#/fichas/3/L2'), false)
})

test('aplicarIdea: la ruta solo lleva hacia atrás, y en otra idea se empieza por arriba', () => {
  const av = { i: 3, u: 5, comprobado: {} }
  assert.equal(aplicarIdea(av, null), av)
  assert.equal(aplicarIdea(av, 4), av) // la misma idea: sigue en su párrafo
  assert.deepEqual(aplicarIdea(av, 2), { i: 1, u: 0, comprobado: {} })
  assert.equal(aplicarIdea(av, 6), av) // más adelante, no (puede haber comprobaciones sin contestar)
  assert.equal(aplicarIdea(null, 3), null)
})

test('rutaDeVuelta: la historia, luego lo recordado al llegar, luego donde estabas; nunca otra lección', () => {
  assert.equal(rutaDeVuelta({ estado: { desde: '#/fichas/3/L2' }, recordada: '#/hoy', actual: '#/foco' }), '#/fichas/3/L2')
  assert.equal(rutaDeVuelta({ estado: null, recordada: '#/fichas/3/L2', actual: '#/foco' }), '#/fichas/3/L2')
  assert.equal(rutaDeVuelta({ estado: null, recordada: null, actual: '#/hoy' }), '#/hoy')
  assert.equal(rutaDeVuelta({ estado: { desde: '#/foco/9/2' }, recordada: null, actual: '#/tutor' }), '#/tutor')
  assert.equal(rutaDeVuelta({ estado: { desde: 42 }, recordada: 'nada', actual: '#/foco/9/1' }), '#/foco')
})

test('haceCuanto: un momento, minutos, hoy, ayer y días', () => {
  assert.equal(haceCuanto(AHORA - 30_000, AHORA), 'hace un momento')
  assert.equal(haceCuanto(AHORA - 20 * MIN, AHORA), 'hace 20 min')
  assert.equal(haceCuanto(AHORA - 3 * 60 * MIN, AHORA), 'hoy')
  assert.equal(haceCuanto(new Date(2026, 10, 18, 22, 0).getTime(), AHORA), 'ayer')
  assert.equal(haceCuanto(new Date(2026, 10, 17, 9, 0).getTime(), AHORA), 'hace 2 días')
})

test('textoSeguir: idea y párrafo desde 1, y cuándo', () => {
  assert.equal(textoSeguir({ i: 2, u: 5, en: new Date(2026, 10, 17, 9, 0).getTime() }, AHORA), 'Seguir · idea 3, párrafo 6 · hace 2 días')
  assert.equal(textoSeguir({ i: 0, u: 0, en: AHORA - 10_000 }, AHORA), 'Seguir · idea 1 · hace un momento')
  assert.equal(textoSeguir({ i: 1 }, AHORA), 'Seguir · idea 2')
})
