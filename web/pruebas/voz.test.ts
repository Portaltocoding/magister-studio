// Lo que la voz recibe: el glosario, los guiones bajos y las letras sueltas. Sin navegador: node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscarTerminos, GLOSARIO, paraLaVoz } from '../src/componentes/pronunciacion.ts'

const casos: [string, string][] = [
  ['si las dos peticiones son idénticas', 'si las dos peticiones son idénticas'],
  // «id»: pendiente de decidir entre «íd» y «i de» (las dos sesiones lo dejaron distinto).
  ['Bitmap Index Scan sobre idx_pedidos_cliente', 'bítmap índex scan sobre índex pedidos cliente'],
  ['Bitmap Heap Scan e Index Scan', 'bítmap jip scan e índex scan'],
  ['EXPLAIN ANALYZE y luego EXPLAIN', 'explein análaiz y luego explein'],
  ['tarda 90ms o 0,078 ms', 'tarda 90milisegundos o 0,078 milisegundos'],
  ['vive en Madrid', 'vive en Madrid'],
  ['NoSQL frente a SQL', 'no ese cu ele frente a ese cu ele'],
  ['manda Idempotency-Key', 'manda idempótensi qui'],
  ['Tiene la estación en el punto A, de coordenadas conocidas', 'Tiene la estación en el punto á, de coordenadas conocidas'],
  ['de A a B, de B a P, y de vuelta a A.', 'de á a be, de be a pe, y de vuelta a á.'],
  ['A esto se le llama idempotencia', 'A esto se le llama idempotencia'],
  ['en topografía, el seno va con la X.', 'en topografía, el seno va con la equis.'],
]
for (const [entra, sale] of casos) test(`«${entra}»`, () => assert.equal(paraLaVoz(entra), sale))

test('todos los términos del glosario cargan y se encuentran', () => {
  assert.ok(GLOSARIO.length > 150)
  assert.deepEqual(buscarTerminos('jota').map((t) => t.escrito), ['JWT'])
})
