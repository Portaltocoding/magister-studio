// La variante de estilo de cada ficha: fija para cada lección, la mixta en minoría y sin tres iguales seguidas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { varianteFicha, variantesDelPlan, type VarianteFicha } from '../src/componentes/varianteFicha.ts'

const VARIANTES: VarianteFicha[] = ['limpia', 'cuaderno', 'mixta']

test('varianteFicha: la misma lección sale siempre igual', () => {
  for (const plan of [0, 2, 3, 41]) {
    for (let n = 1; n <= 30; n++) {
      const v = varianteFicha(`L${n}`, plan)
      assert.ok(VARIANTES.includes(v))
      assert.equal(varianteFicha(`L${n}`, plan), v)
    }
  }
  assert.equal(varianteFicha('repaso', 2), varianteFicha('repaso', 2))
})

test('varianteFicha: no depende de cuántas lecciones se miren antes', () => {
  const todas = variantesDelPlan(7, 40)
  for (let n = 1; n <= 40; n++) assert.equal(varianteFicha(`L${n}`, 7), todas[n - 1])
})

test('variantesDelPlan: en cada tanda de cuatro, una mixta y al menos una limpia y una cuaderno', () => {
  for (let plan = 0; plan < 200; plan++) {
    const xs = variantesDelPlan(plan, 24)
    for (let t = 0; t < 24; t += 4) {
      const tanda = xs.slice(t, t + 4)
      assert.equal(tanda.filter((x) => x === 'mixta').length, 1, `plan ${plan}, tanda ${t / 4}`)
      assert.ok(tanda.includes('limpia') && tanda.includes('cuaderno'))
    }
  }
})

test('variantesDelPlan: nunca tres iguales seguidas ni dos mixtas seguidas', () => {
  for (let plan = 0; plan < 500; plan++) {
    const xs = variantesDelPlan(plan, 40)
    for (let i = 1; i < xs.length; i++) {
      assert.ok(!(xs[i] === 'mixta' && xs[i - 1] === 'mixta'), `plan ${plan}, L${i + 1}: dos mixtas`)
      if (i >= 2) assert.ok(!(xs[i] === xs[i - 1] && xs[i] === xs[i - 2]), `plan ${plan}, L${i + 1}: ${xs.slice(i - 2, i + 1)}`)
    }
  }
})

test('variantesDelPlan: los planes no salen todos con el mismo orden', () => {
  const distintos = new Set(Array.from({ length: 30 }, (_, p) => variantesDelPlan(p, 8).join()))
  assert.ok(distintos.size > 5)
})

test('varianteFicha: claves sin número también reparten, con la mixta en minoría', () => {
  const xs = Array.from({ length: 400 }, (_, i) => varianteFicha(`tema-${i}`, 1))
  const mixtas = xs.filter((x) => x === 'mixta').length
  assert.ok(mixtas > 60 && mixtas < 140, `mixtas: ${mixtas}`)
  assert.ok(xs.includes('limpia') && xs.includes('cuaderno'))
})
