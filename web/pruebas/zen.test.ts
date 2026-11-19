// El modo zen del foco: cuándo asoma la barra, cuándo se ve el pie, la línea de progreso, el reloj en minutos y
// que la preferencia se recuerde (apagada por defecto).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barraAsoma, guardarZen, leerZen, pieVisible, progresoLeccion, relojZen, ZONA_BARRA_PX } from '../src/componentes/zen.ts'

const quieta = { asomada: false, altoBarra: 99, sobreBarra: false, menuAbierto: false }

test('barraAsoma: solo en la franja de arriba mientras está escondida', () => {
  assert.equal(barraAsoma(0, quieta), true)
  assert.equal(barraAsoma(ZONA_BARRA_PX - 1, quieta), true)
  assert.equal(barraAsoma(ZONA_BARRA_PX, quieta), false)
  assert.equal(barraAsoma(80, quieta), false)
  assert.equal(barraAsoma(-5, quieta), false)
})

test('barraAsoma: ya asomada, la franja llega a su borde de abajo; encima de ella o con el menú abierto, se queda', () => {
  assert.equal(barraAsoma(80, { ...quieta, asomada: true }), true)
  assert.equal(barraAsoma(120, { ...quieta, asomada: true }), false)
  assert.equal(barraAsoma(40, { ...quieta, asomada: true, altoBarra: 30 }), true)
  assert.equal(barraAsoma(400, { ...quieta, asomada: true, sobreBarra: true }), true)
  assert.equal(barraAsoma(400, { ...quieta, asomada: true, menuAbierto: true }), true)
})

const leyendo = { zen: true, pantalla: 'idea', ultimoParrafo: false, asomando: false, chuleta: false, error: false }

test('pieVisible: sin zen siempre; en zen, escondido mientras lees', () => {
  assert.equal(pieVisible({ ...leyendo, zen: false }), true)
  assert.equal(pieVisible(leyendo), false)
})

test('pieVisible: en zen aparece en el último párrafo, al cambiar de idea, con los atajos o con un error', () => {
  assert.equal(pieVisible({ ...leyendo, ultimoParrafo: true }), true)
  assert.equal(pieVisible({ ...leyendo, asomando: true }), true)
  assert.equal(pieVisible({ ...leyendo, chuleta: true }), true)
  assert.equal(pieVisible({ ...leyendo, error: true }), true)
})

test('pieVisible: fuera de la idea (calentamiento, descanso) el pie no se esconde', () => {
  assert.equal(pieVisible({ ...leyendo, pantalla: 'calentamiento' }), true)
  assert.equal(pieVisible({ ...leyendo, pantalla: 'cierre' }), true)
})

test('progresoLeccion: ideas hechas más los párrafos de la actual', () => {
  assert.equal(progresoLeccion(0, 5, 0, 4), 0.05)
  assert.equal(progresoLeccion(1, 5, 3, 4), 0.4)
  assert.equal(progresoLeccion(4, 5, 9, 10), 1)
  assert.equal(progresoLeccion(2, 4, 0, 0), 0.5)
  assert.equal(progresoLeccion(0, 0, 0, 0), 0)
  // Fuera de rango, se recorta.
  assert.equal(progresoLeccion(9, 5, 99, 4), 1)
  assert.equal(progresoLeccion(-1, 5, -3, 4), 0.05)
})

test('relojZen: solo minutos', () => {
  assert.equal(relojZen(0), '0 min')
  assert.equal(relojZen(59), '0 min')
  assert.equal(relojZen(727), '12 min')
  assert.equal(relojZen(3600 + 5 * 60 + 30), '1 h 05 min')
  assert.equal(relojZen(-3), '0 min')
})

test('leerZen y guardarZen: apagado por defecto y se recuerda', () => {
  const datos = new Map<string, string>()
  const almacen = { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) }
  assert.equal(leerZen(almacen), false)
  guardarZen(almacen, true)
  assert.equal(leerZen(almacen), true)
  guardarZen(almacen, false)
  assert.equal(leerZen(almacen), false)
  assert.equal(leerZen(null), false)
  const roto = { getItem: () => { throw new Error('sin permiso') }, setItem: () => { throw new Error('lleno') } }
  assert.equal(leerZen(roto), false)
  assert.doesNotThrow(() => guardarZen(roto, true))
})
