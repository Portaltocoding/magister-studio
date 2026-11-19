// Números, fechas, plurales y títulos como se leen en España.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cortarTitulo, fechaLarga, numero, plural, textoSustituye } from '../src/componentes/formato.ts'

test('los decimales van con coma y sin ceros de más', () => {
  assert.equal(numero(2.5), '2,5')
  assert.equal(numero(3), '3')
  assert.equal(numero(6.25, 2), '6,25')
  assert.equal(numero(6.25), '6,3')
  assert.equal(numero(null), '0')
  assert.equal(numero(Number.NaN), '0')
})

test('el plural sale en singular con uno', () => {
  assert.equal(plural(1, 'propuesta', 'propuestas'), '1 propuesta')
  assert.equal(plural(0, 'propuesta', 'propuestas'), '0 propuestas')
  assert.equal(plural(3, 'sesión', 'sesiones'), '3 sesiones')
})

test('una fecha ISO se escribe con el mes en letra; lo demás, tal cual', () => {
  assert.equal(fechaLarga('2026-11-20'), '20 de noviembre de 2026')
  assert.equal(fechaLarga('2027-01-05'), '5 de enero de 2027')
  assert.equal(fechaLarga('en un mes'), 'en un mes')
  assert.equal(fechaLarga('2026-13-01'), '2026-13-01')
})

test('un título largo se corta por palabra y lleva «…»', () => {
  const t = cortarTitulo('Quiero entender cómo funcionan los índices de una base de datos relacional por dentro', 40)
  assert.ok(t.length <= 40, t)
  assert.ok(t.endsWith('…'))
  // No deja media palabra: lo que hay antes de «…» es una palabra entera del original.
  const ultima = t.slice(0, -1).split(' ').pop()!
  assert.ok('Quiero entender cómo funcionan los índices de una base de datos relacional por dentro'.split(' ').includes(ultima), ultima)
  assert.equal(cortarTitulo('Corto', 40), 'Corto')
  assert.equal(cortarTitulo('  con   espacios  ', 40), 'con espacios')
  // Una sola palabra larguísima se corta donde toque.
  assert.equal(cortarTitulo('a'.repeat(80), 10), `${'a'.repeat(9)}…`)
  // Sin coma colgando antes de «…».
  assert.equal(cortarTitulo('uno, dos, tres, cuatro', 10), 'uno, dos…')
})

test('el aviso de sustitución dice lo hecho del plan que se va', () => {
  assert.equal(
    textoSustituye({ horas_hechas: 3, conserva: { lecciones: ['L1', 'L2'], horas_hechas: 2.5, fuentes: 12 } }),
    'Ya tienes un plan de este tema, con 3 h hechas. Si aceptas este, lo sustituye: se conservan 2,5 h y 12 fuentes de las lecciones que siguen.',
  )
  assert.equal(
    textoSustituye({ horas_hechas: 0, conserva: { lecciones: [], horas_hechas: 0, fuentes: 1 } }),
    'Ya tienes un plan de este tema, aún sin horas hechas. Si aceptas este, lo sustituye: se conserva 1 fuente de las lecciones que siguen.',
  )
  assert.equal(
    textoSustituye({ horas_hechas: 1, conserva: { lecciones: ['L1'], horas_hechas: 0, fuentes: 0 } }),
    'Ya tienes un plan de este tema, con 1 h hecha. Si aceptas este, lo sustituye: 1 lección sigue, aún sin nada hecho que conservar.',
  )
  assert.equal(
    textoSustituye({ horas_hechas: 2, conserva: { lecciones: [], horas_hechas: 0, fuentes: 0 } }),
    'Ya tienes un plan de este tema, con 2 h hechas. Si aceptas este, lo sustituye: no se conserva nada, porque ninguna lección sigue.',
  )
  // Sin `conserva` (un servidor de antes): solo el aviso.
  assert.equal(textoSustituye({ horas_hechas: 2.5 }), 'Ya tienes un plan de este tema, con 2,5 h hechas. Si aceptas este, lo sustituye.')
})
