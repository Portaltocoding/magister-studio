// Cada tema, su color: estable por id, distinto entre los que hay y con su nombre corto para el calendario.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorTema, alternarTema, asignarColores, colorDeTema, nombreCorto, PALETA_TEMAS } from '../src/componentes/colorTema.ts'

const N = PALETA_TEMAS.length

test('el mismo tema, siempre el mismo color, esté donde esté en la lista', () => {
  const a = colorDeTema(3, [2, 3])
  const b = colorDeTema(3, [3, 2])
  const c = colorDeTema(3, [{ tema_id: 3 }, { tema_id: 2 }])
  assert.equal(a?.tono.id, b?.tono.id)
  assert.equal(a?.tono.id, c?.tono.id)
})

test('añadir o borrar otro plan no cambia el color de los que había', () => {
  const antes = colorDeTema(2, [2, 3])?.tono.id
  assert.equal(colorDeTema(2, [2, 3, 4])?.tono.id, antes)
  assert.equal(colorDeTema(2, [2])?.tono.id, antes)
  assert.equal(colorDeTema(3, [2, 3, 7])?.tono.id, colorDeTema(3, [3])?.tono.id)
})

test('los temas que hay llevan colores distintos, también si piden la misma casilla', () => {
  const ids = [2, 2 + N, 2 + 2 * N, 3]
  const casillas = ids.map((id) => colorDeTema(id, ids)!.indice)
  assert.equal(new Set(casillas).size, ids.length)
  // Determinista: el de id menor se queda la suya; el otro, la siguiente libre.
  assert.equal(colorDeTema(2, ids)!.indice, 2 % N)
  assert.equal(colorDeTema(2 + N, ids)!.indice, (2 % N) + 2)
})

test('ocho temas seguidos, ocho colores; con más, se repite pero no revienta', () => {
  const ocho = Array.from({ length: N }, (_, i) => i + 1)
  assert.equal(new Set([...asignarColores(ocho).values()]).size, N)
  const muchos = Array.from({ length: N + 3 }, (_, i) => i + 1)
  assert.equal(asignarColores(muchos).size, N + 3)
})

test('sin tema no hay color; un tema que no está en la lista también tiene el suyo', () => {
  assert.equal(colorDeTema(null, [2, 3]), null)
  assert.equal(colorDeTema(undefined, []), null)
  assert.ok(colorDeTema(9, [2, 3]))
})

test('da las dos variables CSS, sobre las variables del aspecto (claro, oscuro y Parchís)', () => {
  const e = colorDeTema(2, [2, 3])!.estilo as Record<string, string>
  assert.match(e['--tema-color'], /^color-mix\(in srgb, #[0-9a-f]{6} \d+%, var\(--texto\)\)$/)
  assert.match(e['--tema-fondo'], /var\(--tarjeta/)
})

test('el nombre corto: palabras enteras, sin un «y» colgando', () => {
  assert.equal(nombreCorto('Topografía'), 'Topografía')
  assert.equal(nombreCorto('AI engineer y fullstack engineer senior'), 'AI engineer…')
  assert.equal(nombreCorto('Electroencefalografía'), 'Electroencefal…')
  assert.equal(nombreCorto('  Historia   de España '), 'Historia…')
  assert.equal(nombreCorto('Cálculo de estructuras'), 'Cálculo…')
})

test('las sesiones de un día, juntas por tema y en el orden de la leyenda; sin tema, al final', () => {
  const dia = [
    { id: 1, tema_id: 3 },
    { id: 2, tema_id: 2 },
    { id: 3, tema_id: null },
    { id: 4, tema_id: 3 },
    { id: 5, tema_id: 2 },
  ]
  const g = agruparPorTema(dia, [2, 3])
  assert.deepEqual(g.map((x) => x.temaId), [2, 3, null])
  assert.deepEqual(g[1].cosas.map((x) => x.id), [1, 4])
  assert.deepEqual(agruparPorTema(dia, [3, 2]).map((x) => x.temaId), [3, 2, null])
  assert.deepEqual(agruparPorTema([], [2]), [])
})

test('el filtro de la leyenda oculta y enseña, pero siempre deja uno a la vista', () => {
  let ocultos = alternarTema(new Set(), 2, [2, 3])
  assert.deepEqual([...ocultos], [2])
  ocultos = alternarTema(ocultos, 3, [2, 3])
  assert.deepEqual([...ocultos], [2], 'el último visible no se oculta')
  ocultos = alternarTema(ocultos, 2, [2, 3])
  assert.deepEqual([...ocultos], [])
  assert.deepEqual([...alternarTema(new Set(), 2, [2])], [], 'con un solo tema no se oculta nada')
})
