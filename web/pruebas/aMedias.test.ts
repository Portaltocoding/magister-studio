// «Lo dejaste a medias» en Hoy: qué sale, en qué orden y qué no.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aMedias, cuando, fotoAlLlegar, leerAvancesFoco, nuevosListos, type Lectura } from '../src/componentes/aMedias.ts'

const AHORA = new Date(2026, 10, 19, 10, 0).getTime()
const AYER = new Date(2026, 10, 18, 21, 30).getTime()
const HORA = 3_600_000

const lecciones = [
  { material_id: 12, clave: 'L4', titulo: 'Integrales', tema_id: 1 },
  { material_id: 13, clave: 'L5', titulo: 'Series', tema_id: 1 },
]
const vacia: Lectura = { avances: [], lecciones, conversaciones: [], listosNuevos: [], descartados: [] }

test('sin nada a medias no sale nada', () => {
  assert.deepEqual(aMedias(vacia, AHORA), [])
})

test('una lección en foco sin cerrar dice por qué idea ibas y lleva a seguir ahí', () => {
  const [a] = aMedias({ ...vacia, avances: [{ mid: 12, i: 2, n: 5, segundos: 300, en: AYER }] }, AHORA)
  assert.equal(a.texto, 'Lo dejaste ayer en la idea 3 de 5 de L4.')
  assert.equal(a.boton, 'Seguir por la idea 3')
  assert.deepEqual(a.destino, { tipo: 'foco', mid: 12 })
})

test('un avance viejo, sin fecha ni total, se entiende igual', () => {
  const [a] = aMedias({ ...vacia, avances: [{ mid: 13, i: 1 }] }, AHORA)
  assert.equal(a.texto, 'Te quedaste en la idea 2 de L5.')
})

test('no sale la lección de hoy (ya tiene su botón), ni la que abriste y cerraste enseguida, ni unos apuntes que ya no están', () => {
  const avances = [
    { mid: 12, i: 3, en: AYER },
    { mid: 13, i: 0, u: 0, segundos: 20, en: AYER },
    { mid: 99, i: 4, en: AYER },
  ]
  assert.deepEqual(aMedias({ ...vacia, avances, deHoy: 12 }, AHORA), [])
  // Igual con los apuntes de hoy recién hechos: su tarjeta ya dice «Empezar».
  assert.deepEqual(aMedias({ ...vacia, deHoy: 12, listosNuevos: [{ id: 12, tipo: 'apuntes', clave: 'L4', tema_id: 1 }] }, AHORA), [])
})

test('una respuesta del tutor que se cortó, o tu mensaje sin respuesta, lleva a la conversación', () => {
  const conv = (ultimo: NonNullable<Lectura['conversaciones'][number]['ultimo']>) => ({
    id: 6, titulo: 'Derivadas', actualizada_en: new Date(AHORA - 3 * HORA).toISOString(), ultimo,
  })
  const [a] = aMedias({ ...vacia, conversaciones: [conv({ id: 40, rol: 'tutor', estado: 'interrumpido', contenido: 'La regla de' })] }, AHORA)
  assert.equal(a.texto, 'La respuesta del tutor se cortó en «Derivadas».')
  assert.deepEqual(a.destino, { tipo: 'ruta', ruta: '#/conversacion/6' })
  const [b] = aMedias({ ...vacia, conversaciones: [conv({ id: 41, rol: 'usuario', estado: 'completo', contenido: '¿Y la cadena?' })] }, AHORA)
  assert.equal(b.boton, 'Retomarla')
  const [c] = aMedias({ ...vacia, conversaciones: [conv({ id: 42, rol: 'tutor', estado: 'completo', contenido: '¿Qué crees que pasa con **x²**?**' })] }, AHORA)
  assert.equal(c.boton, 'Contestar')
  assert.deepEqual(aMedias({ ...vacia, conversaciones: [conv({ id: 43, rol: 'tutor', estado: 'completo', contenido: 'Eso es todo.' })] }, AHORA), [])
})

test('la conversación en la que sigues (hace nada) o una de hace semanas no se avisa', () => {
  const ultimo = { id: 1, rol: 'tutor' as const, estado: 'interrumpido', contenido: '...' }
  const reciente = { id: 1, titulo: 'a', actualizada_en: new Date(AHORA - 60_000).toISOString(), ultimo }
  const vieja = { id: 2, titulo: 'b', actualizada_en: new Date(AHORA - 30 * 24 * HORA).toISOString(), ultimo }
  assert.deepEqual(aMedias({ ...vacia, conversaciones: [reciente, vieja] }, AHORA), [])
})

test('el material que terminó va delante, luego lo más reciente, y como mucho tres', () => {
  const l: Lectura = {
    ...vacia,
    avances: [{ mid: 12, i: 2, en: AYER }, { mid: 13, i: 1, en: AYER - 48 * HORA }],
    conversaciones: [{ id: 6, titulo: 'Derivadas', actualizada_en: new Date(AHORA - HORA).toISOString(), ultimo: { id: 3, rol: 'usuario', estado: 'completo', contenido: 'x' } }],
    listosNuevos: [{ id: 50, tipo: 'apuntes', clave: 'L6', tema_id: 1 }],
  }
  const r = aMedias(l, AHORA)
  assert.deepEqual(r.map((x) => x.id), ['mat:apuntes:50', 'conv:6:3', 'foco:12:2'])
  assert.equal(r[0].texto, 'Ya están los apuntes de L6.')
  assert.deepEqual(r[0].destino, { tipo: 'ruta', ruta: '#/fichas/1/L6' })
})

test('lo descartado no vuelve; si avanzas y lo dejas en otra idea, sí', () => {
  const l = { ...vacia, avances: [{ mid: 12, i: 2, en: AYER }], descartados: ['foco:12:2'] }
  assert.deepEqual(aMedias(l, AHORA), [])
  assert.equal(aMedias({ ...l, avances: [{ mid: 12, i: 3, en: AYER }] }, AHORA).length, 1)
})

test('nuevo es lo listo que no estaba en la foto de tu visita anterior; la primera vez, nada', () => {
  const actuales = [{ tipo: 'apuntes', id: 5 }, { tipo: 'guion', id: 7 }]
  assert.deepEqual(nuevosListos(actuales, ['apuntes:5']), [{ tipo: 'guion', id: 7 }])
  assert.deepEqual(nuevosListos(actuales, null), [])
})

test('cuándo: hoy, ayer o hace unos días', () => {
  assert.equal(cuando(AHORA - HORA, AHORA), 'hoy')
  assert.equal(cuando(AYER, AHORA), 'ayer')
  assert.equal(cuando(AHORA - 3 * 24 * HORA, AHORA), 'hace 3 días')
})

test('sin almacenamiento no revienta', () => {
  assert.deepEqual(leerAvancesFoco(), [])
  assert.equal(fotoAlLlegar(['apuntes:5']), null)
})
