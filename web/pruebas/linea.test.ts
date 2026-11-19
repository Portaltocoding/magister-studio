// La línea de tiempo del vídeo: con la voz medida cada tramo dura lo que su voz, los tramos se cruzan sin que se
// solapen sus voces, y cada frase sale cuando suena. Sin navegador: node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FPS, SOLAPE, duracionTotal, duracionTramo, fraseEn, inicios, lineaDeTiempo, tramoEn, trozoEn, trozos, type GuionGrafico, type Tramo } from '../src/escena/tipos.ts'

const tramo = (narracion: string, concepto = 'x'): Tramo => ({ concepto, tesis: 'y', narracion, escena: { tipo: 'pregunta', pregunta: '?' } })
const largo = Array(60).fill('palabra').join(' ') + '.'
const guion: GuionGrafico = {
  titulo: 'g',
  tramos: [tramo('Ana paga, el servidor cobra. Y responde.'), tramo(largo), tramo('Fin.')],
}
// Segundos de cada trozo: [«Ana paga,», «el servidor cobra.», «Y responde.»], [el largo], [«Fin.»]
const medidas = [[1, 2, 1.5], [20], [0.6]]

test('los trozos son los del Locutor: frase a frase, cortadas en sus comas', () => {
  assert.deepEqual(trozos('Ana paga, el servidor cobra. Y responde.'), [
    { texto: 'Ana paga,', frase: 0 },
    { texto: 'el servidor cobra.', frase: 0 },
    { texto: 'Y responde.', frase: 1 },
  ])
})

test('sin medir, cada tramo dura la estimación de siempre', () => {
  const l = lineaDeTiempo(guion, 1)
  assert.deepEqual(
    l.tramos.map((t) => t.dur),
    guion.tramos.map((t) => duracionTramo(t, 1)),
  )
})

test('los tramos se cruzan SOLAPE fotogramas y el total lo descuenta', () => {
  const l = lineaDeTiempo(guion, 1, medidas)
  for (let i = 1; i < l.tramos.length; i++) assert.equal(l.tramos[i].desde, l.tramos[i - 1].desde + l.tramos[i - 1].dur - SOLAPE)
  const suma = l.tramos.reduce((n, t) => n + t.dur, 0)
  assert.equal(l.total, suma - SOLAPE * (l.tramos.length - 1))
  // El Player y la composición sacan lo mismo de la misma función.
  assert.equal(duracionTotal(guion, 1, medidas), l.total)
  assert.deepEqual(inicios(guion, 1, medidas), l.tramos.map((t) => t.desde))
})

test('medido, el tramo dura su voz más el respiro (y nunca menos de 5 s)', () => {
  const l = lineaDeTiempo(guion, 1, medidas)
  const largo = l.tramos[1]
  const z = largo.trozos[0]
  assert.equal(z.dur, 20 * FPS)
  assert.equal(largo.dur, z.desde + z.dur + 24)
  const ultimo = l.tramos[0].trozos[2]
  assert.equal(l.tramos[0].dur, ultimo.desde + ultimo.dur + 24)
  // «Fin.» dura 0,6 s: el tramo se queda en 5 s.
  assert.equal(l.tramos[2].dur, 5 * FPS)
})

test('medido, la velocidad no estira los tramos: la pone el Player a imagen y voz a la vez', () => {
  assert.deepEqual(lineaDeTiempo(guion, 1.5, medidas), lineaDeTiempo(guion, 1, medidas))
  assert.ok(lineaDeTiempo(guion, 1.5).total < lineaDeTiempo(guion, 1).total)
})

test('los trozos de un tramo van en orden y sin pisarse, con más pausa entre frases que tras una coma', () => {
  const [a, b, c] = lineaDeTiempo(guion, 1, medidas).tramos[0].trozos
  assert.ok(a.desde > 0)
  assert.equal(a.dur, 30)
  const trasComa = b.desde - (a.desde + a.dur)
  const trasFrase = c.desde - (b.desde + b.dur)
  assert.ok(trasComa > 0 && trasFrase > trasComa)
})

test('la voz de un tramo acaba antes de que empiece la del siguiente, aunque las imágenes se crucen', () => {
  const l = lineaDeTiempo(guion, 1, medidas)
  for (let i = 1; i < l.tramos.length; i++) {
    const antes = l.tramos[i - 1]
    const ultimo = antes.trozos[antes.trozos.length - 1]
    const acaba = antes.desde + ultimo.desde + ultimo.dur
    const empieza = l.tramos[i].desde + l.tramos[i].trozos[0].desde
    assert.ok(acaba < l.tramos[i].desde, 'acaba antes del cruce')
    assert.ok(acaba < empieza)
  }
})

test('si las medidas no cuadran con los trozos, ese tramo se estima', () => {
  const l = lineaDeTiempo(guion, 1, [[1, 2], [20], [0.6]])
  assert.equal(l.tramos[0].dur, duracionTramo(guion.tramos[0], 1))
  assert.equal(l.tramos[1].trozos[0].dur, 20 * FPS)
})

test('un trozo sin nada que decir no ocupa tiempo', () => {
  const [a, b, c] = lineaDeTiempo(guion, 1, [[1, null, 1.5], [20], [0.6]]).tramos[0].trozos
  assert.equal(b.dur, 0)
  assert.equal(c.desde, a.desde + a.dur + 3)
})

test('el subtítulo es la frase que suena: cambia cuando empieza su primer trozo', () => {
  const zs = lineaDeTiempo(guion, 1, medidas).tramos[0].trozos
  assert.equal(fraseEn(zs, 0), 0)
  assert.equal(fraseEn(zs, zs[1].desde + 5), 0)
  assert.equal(fraseEn(zs, zs[2].desde - 1), 0)
  assert.equal(fraseEn(zs, zs[2].desde), 1)
  assert.equal(fraseEn(zs, 10_000), 1)
})

test('al reanudar se sigue por el trozo que sonaba, o por el siguiente si se paró entre dos', () => {
  const zs = lineaDeTiempo(guion, 1, medidas).tramos[0].trozos
  assert.equal(trozoEn(zs, 0), 0)
  assert.equal(trozoEn(zs, zs[1].desde + 3), 1)
  assert.equal(trozoEn(zs, zs[1].desde + zs[1].dur + 1), 2)
  assert.equal(trozoEn(zs, 10_000), 3)
})

test('en el cruce, el tramo actual es el que entra', () => {
  const desde = inicios(guion, 1, medidas)
  assert.equal(tramoEn(desde, desde[1] - 1), 0)
  assert.equal(tramoEn(desde, desde[1]), 1)
  assert.equal(tramoEn(desde, 1e9), 2)
})

test('un guion sin tramos no rompe nada', () => {
  assert.deepEqual(lineaDeTiempo({ titulo: 'v', tramos: [] }), { tramos: [], total: 0 })
})
