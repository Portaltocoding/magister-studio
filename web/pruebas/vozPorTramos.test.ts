// La voz del vídeo tramo a tramo: empieza con el primero, las medidas entran en orden, espera donde falta voz y, si
// falla a mitad, lo listo sigue con Magister y el resto con el navegador. Sin navegador: node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineaDeTiempo, trozos, type GuionGrafico, type Tramo } from '../src/escena/tipos.ts'
import {
  avisoVoz, conAudio, conFuentes, conMagister, esperaEn, estadoInicial, puedeEmpezar, reubicar, sinMagister,
} from '../src/escena/vozPorTramos.ts'

const tramo = (narracion: string): Tramo => ({ concepto: 'x', tesis: 'y', narracion, escena: { tipo: 'pregunta', pregunta: '?' } })
const guion: GuionGrafico = { titulo: 'g', tramos: [tramo('Uno, dos.'), tramo('Tres.'), tramo('Cuatro. Uno, dos.')] }
const textos = guion.tramos.map((t) => trozos(t.narracion).map((z) => z.texto))
const audio = (s: number) => ({ url: `blob:${s}`, segundos: s })
const inicial = () => conFuentes(estadoInicial(textos, (t) => t.trim().length > 0))

test('cada texto se pide una vez, en el orden del vídeo', () => {
  assert.deepEqual(inicial().unicos, ['Uno,', 'dos.', 'Tres.', 'Cuatro.'])
})

test('empieza en cuanto el primer tramo tiene toda su voz (y las fuentes)', () => {
  let e = estadoInicial(textos, () => true)
  e = conAudio(e, 'Uno,', audio(1))
  assert.equal(puedeEmpezar(e), false)
  e = conAudio(e, 'dos.', audio(1))
  assert.equal(puedeEmpezar(e), false, 'sin fuentes aún')
  e = conFuentes(e)
  assert.equal(puedeEmpezar(e), true)
  assert.deepEqual(e.tramos, ['magister', 'pendiente', 'pendiente'])
  assert.deepEqual(e.medidas, [[1, 1], null, null])
  assert.deepEqual(e.audios, [['blob:1', 'blob:1'], null, null])
})

test('un tramo medido antes que el de delante espera su turno', () => {
  let e = inicial()
  e = conAudio(e, 'Tres.', audio(2))
  assert.deepEqual(e.tramos, ['pendiente', 'pendiente', 'pendiente'])
  e = conAudio(e, 'Uno,', audio(1))
  e = conAudio(e, 'dos.', audio(1))
  assert.deepEqual(e.tramos, ['magister', 'magister', 'pendiente'])
  // El tercero repite «Uno, dos.»: con «Cuatro.» ya está entero.
  e = conAudio(e, 'Cuatro.', audio(3))
  assert.deepEqual(e.tramos, ['magister', 'magister', 'magister'])
  assert.deepEqual(e.medidas, [[1, 1], [2], [3, 1, 1]])
})

test('un trozo que no cambia ningún tramo deja las mismas medidas (la línea no se recalcula)', () => {
  let e = conAudio(conAudio(inicial(), 'Uno,', audio(1)), 'dos.', audio(1))
  const antes = e.medidas
  e = conAudio(e, 'Cuatro.', audio(3))
  assert.equal(e.medidas, antes)
})

test('si falla a mitad: lo listo sigue con Magister, el resto con el navegador, y lo que llegue luego no cambia nada', () => {
  let e = conAudio(conAudio(inicial(), 'Uno,', audio(1)), 'dos.', audio(1))
  e = sinMagister(e, 'fallo')
  assert.deepEqual(e.tramos, ['magister', 'navegador', 'navegador'])
  assert.equal(conMagister(e), true)
  assert.deepEqual(e.medidas, [[1, 1], null, null])
  assert.match(avisoVoz(e) ?? '', /desde el tramo 2/)
  const tarde = conAudio(e, 'Tres.', audio(2))
  assert.equal(tarde, e)
})

test('tras fallar, un tramo entero aunque esté fuera de turno conserva su voz (nunca dos voces en un tramo)', () => {
  let e = conAudio(conAudio(inicial(), 'Uno,', audio(1)), 'Tres.', audio(2))
  e = sinMagister(e, 'fallo')
  // El primero tiene medio tramo: entero al navegador. El segundo estaba entero: con Magister.
  assert.deepEqual(e.tramos, ['navegador', 'magister', 'navegador'])
  assert.deepEqual(e.medidas, [null, [2], null])
})

test('sin ningún audio, todo el vídeo va con la voz del navegador, como antes', () => {
  const e = sinMagister(inicial(), 'sin_piper')
  assert.deepEqual(e.tramos, ['navegador', 'navegador', 'navegador'])
  assert.equal(e.medidas, null)
  assert.equal(conMagister(e), false)
  assert.equal(puedeEmpezar(e), true)
  assert.match(avisoVoz(e) ?? '', /no está instalada/)
})

test('con toda la voz, sin aviso', () => {
  let e = inicial()
  for (const t of e.unicos) e = conAudio(e, t, audio(1))
  assert.equal(avisoVoz(e), null)
})

test('espera en el tramo que aún no tiene voz', () => {
  const e = conAudio(conAudio(inicial(), 'Uno,', audio(1)), 'dos.', audio(1))
  const desde = lineaDeTiempo(guion, 1, e.medidas).tramos.map((t) => t.desde)
  assert.equal(esperaEn(e, desde, desde[1] - 1), null)
  assert.equal(esperaEn(e, desde, desde[1]), 1)
  assert.equal(esperaEn(sinMagister(e, 'fallo'), desde, desde[1]), null, 'al navegador: ya no se espera')
})

test('al medir, el cabezal no se mueve si está antes y se queda en su tramo si está en él', () => {
  let e = conAudio(conAudio(inicial(), 'Uno,', audio(1)), 'dos.', audio(1))
  const antes = lineaDeTiempo(guion, 1, e.medidas)
  e = conAudio(e, 'Tres.', audio(9))
  const ahora = lineaDeTiempo(guion, 1, e.medidas)
  assert.notEqual(ahora.tramos[2].desde, antes.tramos[2].desde, 'el tercero se ha corrido')
  // En el primero: mismo fotograma.
  assert.equal(reubicar(antes, ahora, 20), 20)
  // Esperando en el segundo, unos fotogramas dentro: los mismos dentro del tramo medido.
  assert.equal(reubicar(antes, ahora, antes.tramos[1].desde + 3), ahora.tramos[1].desde + 3)
  // En el tercero: corrido con su tramo, nunca hacia atrás.
  const f = antes.tramos[2].desde + 5
  assert.equal(reubicar(antes, ahora, f), ahora.tramos[2].desde + 5)
  assert.ok(reubicar(antes, ahora, f) >= f)
})

test('reubicar no se sale del tramo si este se acorta', () => {
  const linea = (durs: number[]) => {
    let d = 0
    const tramos = durs.map((dur) => ({ desde: (d += dur) - dur, dur, trozos: [] }))
    return { tramos, total: d }
  }
  assert.equal(reubicar(linea([100, 300]), linea([100, 50]), 180), 149)
  assert.equal(reubicar(linea([100, 300]), linea([100, 50]), 40), 40)
})
