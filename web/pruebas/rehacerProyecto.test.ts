// Rehacer el roadmap de un proyecto: antes se dice qué pasa con lo hecho, y después qué se ha conservado.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avisoRehacer, resumenRehecho } from '../src/paneles/rehacerProyecto.ts'

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
