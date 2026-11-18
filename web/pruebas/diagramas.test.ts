// Los encargos de diagrama de una respuesta que llega a trozos: solo cuentan los cerrados y enteros.
// Antes, un trozo corto («Mapa») se encontraba más arriba en el texto y se daba por cerrado: una llamada por trozo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bloquesDiagrama } from '../src/componentes/bloquesDiagrama.ts'

const ENCARGO = 'Mapa de argumentos: ¿son creencias los delirios?\nTesis doxástica (Bortolotti 2009).'
const ANTES = 'El mapa de la discusión tiene dos lados.\n\n'
const COMPLETA = `${ANTES}\`\`\`diagrama\n${ENCARGO}\n\`\`\`\n\nY sigue la explicación.`

test('un encargo a medio llegar no sale, ni aunque su principio aparezca antes', () => {
  for (let n = 0; n < COMPLETA.indexOf('\n```\n\nY sigue') + 1; n += 7) {
    const trozo = COMPLETA.slice(0, n)
    assert.deepEqual(bloquesDiagrama(trozo), [], trozo)
  }
})

test('cerrado, sale entero con el texto de antes', () => {
  assert.deepEqual(bloquesDiagrama(COMPLETA), [{ encargo: ENCARGO, contexto: ANTES }])
  const dos = `${COMPLETA}\n\`\`\`diagrama\nMapa de ideas\n\`\`\`\n`
  assert.deepEqual(bloquesDiagrama(dos).map((d) => d.encargo), [ENCARGO, 'Mapa de ideas'])
})
