// El plan con el que estás es uno para toda la app: qué plan abre cada pantalla.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { masReciente, planQueToca, temaActivo } from '../src/componentes/planActivo.ts'

const planes = [{ tema_id: 2, tema: 'Fullstack' }, { tema_id: 3, tema: 'Topografía' }]

test('se abre el plan que tenías elegido, no el primero de la lista', () => {
  assert.equal(planQueToca(planes, null, 3)?.tema, 'Topografía')
})

test('un enlace a un plan concreto manda sobre el elegido', () => {
  assert.equal(planQueToca(planes, 2, 3)?.tema, 'Fullstack')
})

test('si el elegido ya no existe (lo borraste) o no hay ninguno, el primero', () => {
  assert.equal(planQueToca(planes, null, 9)?.tema, 'Fullstack')
  assert.equal(planQueToca(planes, null, null)?.tema, 'Fullstack')
  assert.equal(planQueToca([], null, 3), undefined)
})

test('al borrar un plan queda activo el más reciente de los que quedan, o ninguno', () => {
  const quedan = [{ plan_id: 4, tema_id: 2 }, { plan_id: 9, tema_id: 5 }, { plan_id: 7, tema_id: 3 }]
  assert.equal(masReciente(quedan)?.tema_id, 5)
  assert.equal(masReciente([]), undefined)
})

test('sin almacenamiento no revienta: no hay plan elegido', () => {
  assert.equal(temaActivo(), null)
})
