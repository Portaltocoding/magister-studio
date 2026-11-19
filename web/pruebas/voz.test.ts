// Lo que la voz recibe: el glosario, los guiones bajos y las letras sueltas. Sin navegador: node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscarTerminos, GLOSARIO, paraLaVoz } from '../src/componentes/pronunciacion.ts'

const casos: [string, string][] = [
  ['si las dos peticiones son idénticas', 'si las dos peticiones son idénticas'],
  // «id», letra a letra: «i de» (decidido el 18-11-2026).
  ['Cada pedido tiene su id, el cliente', 'Cada pedido tiene su i de, el cliente'],
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

// El Locutor y el Oído (voz.ts): tocan `window` al cargarse, así que se carga después de poner uno mínimo,
// con un dictado de mentira que deja disparar sus errores a mano.
type Evento = { error: string }
class DictadoFalso {
  static creados: DictadoFalso[] = []
  lang = ''
  interimResults = false
  continuous = false
  onresult: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: Evento) => void) | null = null
  constructor() {
    DictadoFalso.creados.push(this)
  }
  start() {}
  stop() {}
  abort() {}
}
;(globalThis as unknown as { window: unknown }).window = {
  addEventListener() {},
  dispatchEvent() {},
  setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
  SpeechRecognition: DictadoFalso,
}
const { frasesDeRespuesta, Locutor, Oido } = await import('../src/componentes/voz.ts')

// La respuesta llega letra a letra, como por SSE: lo que el Locutor manda decir, en orden.
function loQueSuena(texto: string): string[] {
  const l = new Locutor()
  const dichas: string[] = []
  l.decir = (f: string) => void dichas.push(f)
  for (let i = 1; i <= texto.length; i++) l.empujar(texto.slice(0, i))
  l.empujar(texto, true)
  return dichas
}

const conBloques: [string, string, string[]][] = [
  [
    'lo de después de un diagrama se oye',
    'Te lo dibujo:\n```svg\n<svg><path d="M0 0"/></svg>\n```\nFíjate en la flecha de vuelta. ¿Lo ves?',
    ['Te lo dibujo:', 'Fíjate en la flecha de vuelta.', '¿Lo ves?'],
  ],
  ['lo de después de un concepto se oye', 'Eso se llama latencia\n```concepto\nLatencia: lo que tarda.\n```\n¿Seguimos?', ['Eso se llama latencia', '¿Seguimos?']],
  ['una frase en minúscula tras el bloque no se pega a la anterior', 'Te lo dibujo.\n```svg\n<svg/>\n```\ny aquí ves el bucle.', ['Te lo dibujo.', 'y aquí ves el bucle.']],
]
for (const [nombre, texto, sale] of conBloques) {
  test(nombre, () => {
    assert.deepEqual(frasesDeRespuesta(texto), sale)
    assert.deepEqual(loQueSuena(texto), sale)
  })
}

// El oído: deja de reintentar cuando no puede oír, y avisa una sola vez.
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function fallar(o: InstanceType<typeof Oido>, error: string) {
  const r = DictadoFalso.creados[DictadoFalso.creados.length - 1]
  r.onerror?.({ error })
  r.onend?.()
  await esperar(200)
  return o
}

test('tres fallos seguidos del dictado lo paran y avisan una vez', async () => {
  const o = new Oido()
  const bloqueos: string[] = []
  const errores: string[] = []
  o.alBloqueo = (m: string) => void bloqueos.push(m)
  o.alError = (m: string) => void errores.push(m)
  o.empezar()
  await fallar(o, 'network')
  await fallar(o, 'network')
  assert.equal(bloqueos.length, 0)
  const antes = DictadoFalso.creados.length
  await fallar(o, 'network')
  assert.equal(bloqueos.length, 1)
  assert.match(bloqueos[0], /escríbeme abajo/)
  assert.equal(DictadoFalso.creados.length, antes, 'no vuelve a arrancar')
  assert.equal(errores.length, 2)
})

test('sin micrófono o sin permiso se para al primer fallo', async () => {
  for (const error of ['audio-capture', 'not-allowed']) {
    const o = new Oido()
    const bloqueos: string[] = []
    o.alBloqueo = (m: string) => void bloqueos.push(m)
    o.empezar()
    const antes = DictadoFalso.creados.length
    await fallar(o, error)
    assert.equal(bloqueos.length, 1, error)
    assert.equal(DictadoFalso.creados.length, antes, error)
  }
})

test('si entre fallos te oye, vuelve a contar desde cero', async () => {
  const o = new Oido()
  const bloqueos: string[] = []
  o.alBloqueo = (m: string) => void bloqueos.push(m)
  o.empezar()
  await fallar(o, 'network')
  await fallar(o, 'network')
  DictadoFalso.creados[DictadoFalso.creados.length - 1].onresult?.({ resultIndex: 0, results: [] })
  await fallar(o, 'network')
  assert.equal(bloqueos.length, 0)
  o.parar()
})
