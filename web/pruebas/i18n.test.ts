// El diccionario: cada clave está en los dos idiomas con los mismos {huecos}, y traducir() tiene reserva en español.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DICCIONARIOS, esIdioma, fijarIdioma, idiomaActual, rellenar, t, traducir, type Clave } from '../src/i18n/i18n.ts'
import { en } from '../src/i18n/en.ts'
import { es } from '../src/i18n/es.ts'

const huecos = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('todas las claves están en español y en inglés, y ninguna sobra', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort())
  for (const [idioma, dic] of Object.entries(DICCIONARIOS))
    for (const [clave, texto] of Object.entries(dic)) assert.ok(texto.trim().length > 0, `${idioma}: «${clave}» está vacía`)
})

test('los dos idiomas llevan los mismos huecos {así}', () => {
  for (const clave of Object.keys(es) as Clave[]) assert.deepEqual(huecos(en[clave]), huecos(es[clave]), `huecos distintos en «${clave}»`)
})

test('traducir rellena los huecos y cae al español si falta la clave', () => {
  assert.equal(traducir('es', 'bienvenida.paso', { n: 2, de: 5 }), 'Paso 2 de 5')
  assert.equal(traducir('en', 'bienvenida.paso', { n: 2, de: 5 }), 'Step 2 of 5')
  assert.equal(rellenar('Hola {x} y {y}', { x: 'a' }), 'Hola a y {y}')
  const antes = DICCIONARIOS.en['ajustes.titulo']
  delete DICCIONARIOS.en['ajustes.titulo']
  assert.equal(traducir('en', 'ajustes.titulo'), 'Ajustes')
  DICCIONARIOS.en['ajustes.titulo'] = antes
})

test('el idioma de ahora cambia lo que devuelve t()', () => {
  assert.equal(esIdioma('en') && esIdioma('es') && !esIdioma('fr'), true)
  assert.equal(idiomaActual(), 'es')
  assert.equal(t('ajustes.titulo'), 'Ajustes')
  fijarIdioma('en')
  assert.equal(t('ajustes.titulo'), 'Settings')
  fijarIdioma('es')
  assert.equal(t('ajustes.titulo'), 'Ajustes')
})
