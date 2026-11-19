// Rehacer el roadmap de un proyecto: antes se dice qué pasa con lo hecho, y después qué se ha conservado.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avisoRehacer, perdidosAlRehacer, porDetallar, queHace, resumenRehecho, textoEnCola } from '../src/paneles/rehacerProyecto.ts'

test('antes de rehacer dice cuántos pasos hechos hay, que se intentan conservar y que se puede volver', () => {
  const aviso = avisoRehacer(3)
  assert.match(aviso, /Tienes 3 pasos hechos/)
  assert.match(aviso, /se intentarán conservar los que sigan existiendo/)
  assert.match(aviso, /se guarda para poder volver/)
  assert.match(avisoRehacer(1), /Tienes 1 paso hecho:/)
  assert.doesNotMatch(avisoRehacer(0), /conservar/)
})

test('después de rehacer cuenta lo conservado y lo que ya no está', () => {
  assert.equal(resumenRehecho(undefined, []), null)
  assert.equal(resumenRehecho(2, []), 'Se han conservado 2 pasos hechos.')
  const uno = [{ id: 'n1-b1-p3', titulo: 'Listar las instancias EC2', hecho_en: null }]
  assert.equal(resumenRehecho(0, uno), 'No se ha conservado ningún paso hecho. Uno que tenías hecho ya no está en el roadmap: lo tienes apuntado abajo.')
  assert.match(resumenRehecho(undefined, [...uno, { ...uno[0], id: 'x' }]) ?? '', /^2 que tenías hechos ya no están/)
})

test('con lo que manda el servidor dice cuántos se conservaron de cuántos y cuáles no', () => {
  const ya = [
    { id: 'n1-b1-p4', titulo: 'Haz las fichas de la protagonista y del pueblo', hecho_en: null },
    { id: 'viejo', titulo: 'De un rehacer anterior', hecho_en: null },
  ]
  assert.deepEqual(perdidosAlRehacer(['n1-b1-p4'], ya).map((x) => x.titulo), ['Haz las fichas de la protagonista y del pueblo'])
  assert.deepEqual(perdidosAlRehacer(undefined, ya), [])
  assert.equal(
    resumenRehecho(2, ya, ['n1-b1-p4']),
    'Se han conservado 2 de tus 3 pasos hechos. No sigue en el roadmap nuevo: «Haz las fichas de la protagonista y del pueblo» (lo hecho queda apuntado abajo).',
  )
  assert.match(resumenRehecho(0, ya, ['n1-b1-p4']) ?? '', /^No se ha conservado tu paso hecho\. No sigue/)
  assert.match(resumenRehecho(1, ya, ['n1-b1-p4']) ?? '', /^Se ha conservado 1 de tus 2 pasos hechos\./)
  assert.equal(resumenRehecho(3, [], []), 'Se han conservado los 3 pasos hechos.')
  assert.equal(resumenRehecho(0, [], []), 'No tenías pasos hechos: no había nada que conservar.')
})

test('rehacer no dice «Detallando el nivel» y en cola dice para qué y cuántos hay delante', () => {
  assert.equal(queHace({ id: 1, estado: 'en_curso', nodo: null, tipo: 'proyecto_roadmap' }, true), 'Rehaciendo el roadmap…')
  assert.equal(queHace({ id: 1, estado: 'en_curso', nodo: 'roadmap', tipo: 'proyecto_roadmap' }, true), 'Rehaciendo el roadmap: niveles, bloques y pasos…')
  assert.equal(queHace({ id: 1, estado: 'en_curso', nodo: 'referencias', tipo: 'proyecto_roadmap' }, false), 'Buscando proyectos y documentación parecidos…')
  assert.equal(queHace({ id: 1, estado: 'en_curso', nodo: 'nivel 3', tipo: 'proyecto_nivel', nivel: 3 }, true), 'Detallando el nivel 3…')
  assert.equal(queHace(null, false), 'Preparando el roadmap…')
  const cola = { por_delante: 2, en_marcha: 1, a_la_vez: 1 }
  assert.equal(
    textoEnCola({ id: 1, estado: 'pendiente', nodo: null, tipo: 'proyecto_nivel', nivel: 2, cola }, true),
    'En cola para detallar el nivel 2: hay 2 trabajos por delante. Mientras, puedes seguir usando el proyecto: marcar pasos, el diario y el asesor.',
  )
  assert.equal(textoEnCola({ id: 1, estado: 'pendiente', nodo: null, tipo: 'proyecto_roadmap', cola: { ...cola, por_delante: 0 } }, false), 'En cola para preparar el roadmap: es el siguiente.')
})

test('un nivel detallado con un bloque nuevo sin pasos se puede detallar; uno completo, no', () => {
  const conPasos = { pasos: [{}] }
  assert.equal(porDetallar({ detallado: false, bloques: [{ pasos: [] }] }), true)
  assert.equal(porDetallar({ detallado: true, bloques: [conPasos, { pasos: [] }] }), true)
  assert.equal(porDetallar({ detallado: true, bloques: [conPasos, conPasos] }), false)
})
