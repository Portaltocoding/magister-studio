// «Esta semana» en Hoy junta todos los planes, de lunes a domingo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limitesSemana, semanaDeTodos } from '../src/componentes/semana.ts'

test('la semana va de lunes a domingo', () => {
  assert.deepEqual(limitesSemana('2026-11-19'), ['2026-11-16', '2026-11-22']) // jueves
  assert.deepEqual(limitesSemana('2026-11-16'), ['2026-11-16', '2026-11-22']) // lunes
  assert.deepEqual(limitesSemana('2026-11-22'), ['2026-11-16', '2026-11-22']) // domingo
  assert.deepEqual(limitesSemana('2026-12-31'), ['2026-12-28', '2027-01-03'])
})

const plan = (dias: [string, number, string][]) => ({
  semanas: [{ dias: dias.map(([fecha, horas, estado]) => ({ fecha, sesiones: [{ horas, estado }] })) }],
})

test('suma las sesiones de esta semana de todos los planes y nada de otras semanas', () => {
  const s = semanaDeTodos(
    [
      plan([
        ['2026-11-19', 1, 'hecha'],
        ['2026-11-20', 1, 'pendiente'],
        ['2026-11-24', 2, 'pendiente'], // la semana que viene
      ]),
      plan([['2026-11-19', 0.5, 'pendiente']]),
      plan([['2026-11-30', 3, 'pendiente']]), // empieza más adelante: no cuenta esta semana
    ],
    '2026-11-19',
  )
  assert.deepEqual(s, { total: 2.5, hechas: 1, sesiones: 3, hechasN: 1 })
})

test('sin planes, todo a cero', () => {
  assert.deepEqual(semanaDeTodos([], '2026-11-19'), { total: 0, hechas: 0, sesiones: 0, hechasN: 0 })
})
