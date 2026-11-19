// Las marcas [n] del tutor pasan a enlaces de cita, salvo dentro del código, donde el Markdown no se interpreta.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conMarcas } from '../src/componentes/marcas.ts'

const CITA = '[\\[7\\]](#cita-7)'

test('una marca fuera del código pasa a enlace', () => {
  assert.equal(conMarcas('Los delirios no ceden [7].'), `Los delirios no ceden ${CITA}.`)
})

test('dentro de código en línea no se toca', () => {
  assert.equal(conMarcas('Usa `arr[0]` y mira [7].'), `Usa \`arr[0]\` y mira ${CITA}.`)
})

test('dentro de un bloque cerrado no se toca', () => {
  const texto = 'Antes [7]\n```js\nconst x = arr[0]\n```\nDespués [7]'
  assert.equal(conMarcas(texto), `Antes ${CITA}\n\`\`\`js\nconst x = arr[0]\n\`\`\`\nDespués ${CITA}`)
})

test('un bloque que aún no se ha cerrado mientras llega tampoco se toca', () => {
  const texto = 'Mira [7]\n```js\nconst x = arr[0]'
  assert.equal(conMarcas(texto), `Mira ${CITA}\n\`\`\`js\nconst x = arr[0]`)
})
