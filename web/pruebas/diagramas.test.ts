// Los encargos de diagrama de una respuesta que llega a trozos: solo cuentan los cerrados y enteros.
// Antes, un trozo corto («Mapa») se encontraba más arriba en el texto y se daba por cerrado: una llamada por trozo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bloquesDiagrama, reglasDeEstilo } from '../src/componentes/bloquesDiagrama.ts'

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

test('los estilos del dibujante, por clase y por tipo, en su orden', () => {
  const css = '.c{fill:#e8e6e0;stroke:#333;stroke-width:1.8}.t{font-size:14px;font-weight:bold !important}text, rect.o{fill:#c0392b}'
  assert.deepEqual(reglasDeEstilo(css), [
    { tipo: undefined, clase: 'c', propiedades: [['fill', '#e8e6e0'], ['stroke', '#333'], ['stroke-width', '1.8']] },
    { tipo: undefined, clase: 't', propiedades: [['font-size', '14px'], ['font-weight', 'bold']] },
    { tipo: 'text', clase: undefined, propiedades: [['fill', '#c0392b']] },
    { tipo: 'rect', clase: 'o', propiedades: [['fill', '#c0392b']] },
  ])
})

test('lo que carga de fuera o no se entiende se ignora', () => {
  const css = '@import url(http://fuera/x.css); /* nota */ .f{fill:url(http://fuera/a.png);stroke:#333;marker-end:url(#a)} g > .x{fill:red} sinpuntos{}'
  assert.deepEqual(reglasDeEstilo(css), [
    { tipo: undefined, clase: 'f', propiedades: [['stroke', '#333'], ['marker-end', 'url(#a)']] },
    { tipo: 'sinpuntos', clase: undefined, propiedades: [] },
  ])
})
