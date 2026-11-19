// Ctrl+K: el nombre que coincide gana a una coincidencia en la descripción.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filtrarPaleta, plano } from '../src/componentes/buscarPaleta.ts'
import { MODOS } from '../src/modos.ts'

const pantallas = MODOS.filter((m) => m.encendido).map((m) => ({ grupo: 'Ir a', texto: m.nombre, detalle: m.ayuda }))
const entradas = [
  { grupo: 'Acciones', texto: 'Nuevo plan' },
  ...pantallas,
  { grupo: 'Conversaciones', texto: 'Dudas sobre el roadmap de React' },
]

test('«roadmap» lleva a Roadmap aunque la ayuda de Proyectos diga «roadmap»', () => {
  assert.ok(pantallas.find((p) => p.texto === 'Proyectos')!.detalle!.toLowerCase().includes('roadmap'), 'la premisa de la prueba')
  const r = filtrarPaleta(entradas, 'roadmap')
  assert.equal(r[0].texto, 'Roadmap')
  assert.ok(r.some((e) => e.texto === 'Proyectos'), 'Proyectos sigue saliendo, más abajo')
})

test('lo que empieza por lo escrito va antes que lo que solo lo contiene', () => {
  const r = filtrarPaleta(
    [
      { grupo: 'Ir a', texto: 'Buscar fuentes' },
      { grupo: 'Ir a', texto: 'Tus fuentes' },
      { grupo: 'Ir a', texto: 'Fuentes' },
    ],
    'fuentes',
  )
  assert.deepEqual(
    r.map((e) => e.texto),
    ['Fuentes', 'Buscar fuentes', 'Tus fuentes'],
  )
  const s = filtrarPaleta([{ grupo: 'Ir a', texto: 'Mis notas' }, { grupo: 'Ir a', texto: 'Notas de voz' }], 'not')
  assert.equal(s[0].texto, 'Notas de voz')
})

test('sin tildes ni mayúsculas, todas las palabras tienen que estar', () => {
  assert.equal(plano('Lección Única'), 'leccion unica')
  assert.deepEqual(
    filtrarPaleta(entradas, 'MODO foco').map((e) => e.texto),
    ['Modo foco'],
  )
  assert.equal(filtrarPaleta(entradas, 'zzz').length, 0)
})

test('sin consulta salen las primeras, sin las conversaciones', () => {
  const r = filtrarPaleta(entradas, '  ')
  assert.ok(r.length <= 14)
  assert.ok(r.every((e) => e.grupo !== 'Conversaciones'))
})
