// El texto del asesor: sin ids del roadmap y sin la promesa que la tarjeta ya cuenta con lo que de verdad se preparó.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sinIds, sinPromesa } from '../src/componentes/textoAsesor.ts'

const titulos = new Map([
  ['n3-b3-p3', '«Probar el comando»'],
  ['n3-b3', '«Comandos»'],
  ['n3', 'el nivel 3 «Comandos y avisos»'],
])

test('los ids se cambian por sus títulos, salvo en el código', () => {
  assert.equal(sinIds('Lo pongo en el paso n3-b3-p3, dentro de n3-b3.', titulos), 'Lo pongo en el paso «Probar el comando», dentro de «Comandos».')
  assert.equal(sinIds('Va en el nivel n3.', titulos), 'Va en el nivel 3 «Comandos y avisos».')
  assert.equal(sinIds('Lo paso a n3.', titulos), 'Lo paso al nivel 3 «Comandos y avisos».')
  // Lo que no es un id del proyecto, y lo que va en código, tal cual.
  assert.equal(sinIds('Usa n9-b1 y `n3-b3`.', titulos), 'Usa n9-b1 y `n3-b3`.')
  assert.equal(sinIds('```acciones\nVer | paso:n3-b3-p3\n```', titulos), '```acciones\nVer | paso:n3-b3-p3\n```')
  assert.equal(sinIds('n3-b3-p3', new Map()), 'n3-b3-p3')
})

test('con la tarjeta ya preparada, la promesa de antes del bloque cambio se va', () => {
  const texto = 'El nivel 4 es el despliegue.\n\nAñado un bloque con cinco pasos para los tests.\n\n```cambio\nAñade al nivel n4 un bloque…\n```'
  assert.equal(sinPromesa(texto), 'El nivel 4 es el despliegue.\n\n```cambio\nAñade al nivel n4 un bloque…\n```')
  // Solo la promesa: no queda nada más que el bloque (que la pantalla ya no enseña).
  assert.equal(sinPromesa('Lo preparo.\n```cambio\nX\n```'), '```cambio\nX\n```')
  // Sin bloque cambio, o con un párrafo largo (no es una promesa), tal cual.
  assert.equal(sinPromesa('Hola.'), 'Hola.')
  const largo = `${'Una explicación larga. '.repeat(30)}\n\n\`\`\`cambio\nX\n\`\`\``
  assert.equal(sinPromesa(largo), largo)
})
