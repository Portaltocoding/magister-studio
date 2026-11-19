// El vídeo: frases, pausas para respirar y duración de cada tramo según la velocidad de voz.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SOLAPE, duracionTramo, frases, lineaDeTiempo, respiros, tramoEn, verTramo, type GuionGrafico } from '../src/escena/tipos.ts'

test('las pausas cortan en comas, pero no en la coma decimal', () => {
  assert.deepEqual(respiros('Está en el punto A, de coordenadas: mil, dos mil.'), ['Está en el punto A,', 'de coordenadas:', 'mil,', 'dos mil.'])
  assert.deepEqual(respiros('B queda en 1121,353, 2088,168.'), ['B queda en 1121,353,', '2088,168.'])
})

test('las frases se separan en el punto y la siguiente mayúscula', () => {
  assert.deepEqual(frases('Ana paga. ¿Y si falla? El servidor cobra.'), ['Ana paga.', '¿Y si falla?', 'El servidor cobra.'])
})

test('con voz lenta el tramo dura más, con voz rápida menos', () => {
  const t = { concepto: 'x', tesis: 'y', narracion: Array(60).fill('palabra').join(' '), escena: { tipo: 'pregunta', pregunta: '?' } } as const
  assert.ok(duracionTramo(t, 0.8) > duracionTramo(t, 1) && duracionTramo(t, 1) > duracionTramo(t, 1.5))
})

test('saltar a una tesis cae en su escena ya entrada, sin perder el principio de su voz', () => {
  const tramo = (n: string) => ({ concepto: n, tesis: n, narracion: 'Una frase, con su coma. Y otra frase.', escena: { tipo: 'pregunta', pregunta: '?' } }) as const
  const g = { titulo: 'x', tramos: [tramo('a'), tramo('b'), tramo('c')] } as unknown as GuionGrafico
  for (const medidas of [null, [[1.2, 0.8, 1], [2, 1, 1.5], [0.5, 0.5, 0.5]]]) {
    const linea = lineaDeTiempo(g, 1, medidas)
    const desde = linea.tramos.map((t) => t.desde)
    linea.tramos.forEach((t, i) => {
      const f = verTramo(desde, i, linea.total)
      assert.equal(tramoEn(desde, f), i)
      // En su desde el tramo aún es transparente (fundido de SOLAPE fotogramas): se veía el anterior.
      assert.equal(f - t.desde, SOLAPE)
      // Con la voz medida, ningún trozo ha empezado aún: se oye entero.
      if (medidas) assert.ok(t.trozos.every((z) => z.desde >= f - t.desde))
    })
  }
  // Fuera de rango o con un vídeo cortísimo, nunca se sale del vídeo.
  assert.equal(verTramo([0, 100], 5, 300), 108)
  assert.equal(verTramo([0], 0, 4), 3)
  assert.equal(verTramo([], 0, 1), 0)
})
