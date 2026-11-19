// Proyectos: referencias por bloque, el paso de una decisión que ya no está y la idea que llega del plan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparReferencias, CLAVE_IDEA, leerIdea, olvidarIdea, PARECIDOS, tituloDePaso } from '../src/paneles/referenciasProyecto.ts'

const ref = (url: string, bloque?: number | null, bloque_id?: string | null) => ({ url, titulo: url, motivo: '', bloque, bloque_id })
const BLOQUES = [
  { id: 'b-api', titulo: 'La API' },
  { id: 'b-cola', titulo: 'La cola' },
]

test('las referencias se agrupan por bloque, con los proyectos parecidos delante', () => {
  const g = agruparReferencias([ref('c', 2, 'b-cola'), ref('p', null, null), ref('a', 1, 'b-api'), ref('c2', 2, 'b-cola')], BLOQUES)
  assert.deepEqual(
    g.map((x) => [x.titulo, x.referencias.map((r) => r.url)]),
    [
      [PARECIDOS, ['p']],
      ['La API', ['a']],
      ['La cola', ['c', 'c2']],
    ],
  )
})

test('un bloque que ya no está en el roadmap se llama por su número', () => {
  const g = agruparReferencias([ref('x', 3, 'b-quitado')], BLOQUES)
  assert.deepEqual(g.map((x) => x.titulo), ['Bloque 3'])
  // Sin id, por su posición en el nivel 1.
  assert.deepEqual(agruparReferencias([ref('y', 2, null)], BLOQUES).map((x) => x.titulo), ['La cola'])
})

test('las referencias de antes (sin bloque) van en una lista sin título', () => {
  const viejas = [{ url: 'u', titulo: 't', motivo: 'm' }]
  assert.deepEqual(agruparReferencias(viejas, BLOQUES), [{ titulo: null, referencias: viejas }])
  assert.deepEqual(agruparReferencias([], BLOQUES), [])
})

test('el paso de una decisión se busca también en lo que ya no está', () => {
  const pasos = [{ id: 'p1', titulo: 'Montar la API' }]
  const idos = [{ id: 'p0', titulo: 'Probar con la CLI' }]
  assert.deepEqual(tituloDePaso('p1', pasos, idos), { titulo: 'Montar la API', yaNoEsta: false })
  assert.deepEqual(tituloDePaso('p0', pasos, idos), { titulo: 'Probar con la CLI', yaNoEsta: true })
  assert.equal(tituloDePaso('p9', pasos, idos), null)
  assert.equal(tituloDePaso(null, pasos, idos), null)
})

test('la idea del plan se lee y se olvida; sin almacenamiento, vacía', () => {
  const datos = new Map<string, string>([[CLAVE_IDEA, 'Un agente para AWS']])
  const almacen = { getItem: (k: string) => datos.get(k) ?? null, removeItem: (k: string) => void datos.delete(k) }
  assert.equal(leerIdea(almacen), 'Un agente para AWS')
  olvidarIdea(almacen)
  assert.equal(leerIdea(almacen), '')
  const roto = {
    getItem: (): string | null => {
      throw new Error('bloqueado')
    },
  }
  assert.equal(leerIdea(roto), '')
})
