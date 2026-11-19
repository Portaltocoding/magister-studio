// «No lo entiendo»: marcar y desmarcar dudas, reconocer el párrafo aunque cambien las unidades, el aviso de antes de
// la comprobación, lo que flojeó y el «Te quedaron estas dudas» de otro día. Sin navegador.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  alternarDuda,
  dudasDeOtroDia,
  guardarDudas,
  guardarNotas,
  inicio40,
  leerDudas,
  leerNotas,
  localizar,
  loQueFlojeo,
  ponerNota,
  sinExplicar,
  textoAvisoDudas,
  type Duda,
} from '../src/componentes/dudas.ts'

const AHORA = new Date(2026, 10, 19, 10, 0).getTime()
const AYER = new Date(2026, 10, 18, 21, 0).getTime()
const duda = (clave: string, u: number, texto: string, en = AHORA): Duda => ({ clave, u, texto: inicio40(texto), parrafo: texto, en })

const almacen = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}

test('inicio40: 40 letras, sin saltos ni espacios de más', () => {
  assert.equal(inicio40('  Una   petición\nlleva cuatro piezas, y cada una responde a una pregunta'), 'Una petición lleva cuatro piezas, y cada')
})

test('alternarDuda: N marca y N otra vez sobre el mismo párrafo quita', () => {
  const a = alternarDuda([], duda('b1', 2, 'El método dice qué quieres hacer'))
  assert.equal(a.length, 1)
  const b = alternarDuda(a, duda('b1', 2, 'El método dice qué quieres hacer'))
  assert.equal(b.length, 0)
  const c = alternarDuda(a, duda('b2', 2, 'Otro párrafo'))
  assert.equal(c.length, 2)
})

test('localizar: en su sitio, o donde esté ahora si las unidades cambiaron; -1 si ya no está', () => {
  const textos = ['Uno', 'Dos y tres', 'Cuatro']
  assert.equal(localizar(textos, 1, 'Dos y tres'), 1)
  assert.equal(localizar(['Nuevo', ...textos], 1, 'Dos y tres'), 2)
  assert.equal(localizar(textos, 1, 'Ya no existe'), -1)
  assert.equal(localizar(textos, 2, ''), 2)
})

test('ponerNota: una por párrafo, la última manda; sinExplicar: las dudas sin nota', () => {
  const d = duda('b1', 0, 'Primero')
  const n1 = { clave: 'b1', u: 0, texto: 'Primero', respuesta: 'A', accion: 'facil', en: 1 }
  const n2 = { ...n1, respuesta: 'B', en: 2 }
  const notas = ponerNota(ponerNota([], n1), n2)
  assert.deepEqual(notas.map((x) => x.respuesta), ['B'])
  assert.equal(sinExplicar([d, duda('b1', 3, 'Otro')], notas).length, 1)
})

test('textoAvisoDudas: singular y plural', () => {
  assert.equal(textoAvisoDudas(1), 'Te quedó 1 duda aquí: ¿te la explico más fácil?')
  assert.equal(textoAvisoDudas(2), 'Te quedaron 2 dudas aquí: ¿te las explico más fácil?')
})

test('loQueFlojeo: dudas por párrafo, luego fallos y parciales, en el orden de la lección', () => {
  const bloques = [
    { clave: 'b1', titulo: 'Uno' },
    { clave: 'b2', titulo: 'Dos' },
    { clave: 'b3', titulo: 'Tres' },
  ]
  const f = loQueFlojeo(bloques, { b1: 'bien', b2: 'fallo', b3: 'parcial' }, [duda('b2', 5, 'Cinco'), duda('b2', 1, 'Uno'), duda('b1', 0, 'Cero')])
  assert.deepEqual(
    f.map((x) => `${x.tipo}:${x.clave}:${x.u ?? ''}`),
    ['duda:b1:0', 'duda:b2:1', 'duda:b2:5', 'fallo:b2:', 'parcial:b3:'],
  )
  assert.equal(f[3].idea, 1)
  assert.deepEqual(loQueFlojeo(bloques, { b1: 'saltada' }, []), [])
})

test('dudasDeOtroDia: solo si alguna es de un día anterior', () => {
  assert.equal(dudasDeOtroDia([], AHORA), false)
  assert.equal(dudasDeOtroDia([duda('b1', 0, 'x', AHORA - 3_600_000)], AHORA), false)
  assert.equal(dudasDeOtroDia([duda('b1', 0, 'x', AYER)], AHORA), true)
})

test('se guardan por lección y sobreviven a lo que no son filas', () => {
  const a = almacen()
  guardarDudas(a, 9, [duda('b1', 0, 'Primero')])
  guardarNotas(a, 9, [{ clave: 'b1', u: 0, texto: 'Primero', respuesta: 'Así', accion: 'facil', en: 1 }])
  assert.equal(leerDudas(a, 9).length, 1)
  assert.equal(leerNotas(a, 9)[0].respuesta, 'Así')
  assert.deepEqual(leerDudas(a, 10), [])
  a.setItem('magister-dudas-11', '[{"x":1}, {"clave":"b1","u":2,"texto":"t"}]')
  assert.equal(leerDudas(a, 11).length, 1)
  a.setItem('magister-dudas-12', 'roto')
  assert.deepEqual(leerDudas(a, 12), [])
  guardarDudas(a, 9, [])
  assert.equal(a.m.has('magister-dudas-9'), false)
  // No se confunden con el avance del foco («Lo dejaste a medias» lee magister-foco-<n>).
  assert.ok([...a.m.keys()].every((k) => !/^magister-foco-\d+$/.test(k)))
})
