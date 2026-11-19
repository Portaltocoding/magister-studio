// Lecciones: la ruta que sobrevive a recargar, el estado de la lista, la barra que no retrocede y la cola.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoLeccion, leerRutaLeccion, porcentaje, rutaLeccion, textoCola } from '../src/componentes/leccionMaterial.ts'

test('ruta: plan, lección y pestaña van y vuelven', () => {
  assert.equal(rutaLeccion('fichas', 4, 'L2', 'fichas'), '#/fichas/4/L2/fichas')
  assert.deepEqual(leerRutaLeccion('#/fichas/4/L2/fichas'), { modo: 'fichas', tema: 4, clave: 'L2', pestana: 'fichas' })
  assert.deepEqual(leerRutaLeccion('#/fichas'), { modo: 'fichas', tema: null, clave: null, pestana: null })
  assert.equal(leerRutaLeccion('#/fichas/abc/L1/otra').tema, null)
  assert.equal(leerRutaLeccion('#/fichas/4/L1/otra').pestana, null)
})

test('lista: en cola no es generando, y las diapositivas no esconden unos apuntes listos', () => {
  const base = { tipos: {}, fichas: 0, en_marcha: true }
  assert.equal(estadoLeccion({ ...base, trabajo: { id: 1, estado: 'pendiente', tipos: ['apuntes'] } }).texto, 'En cola')
  assert.equal(estadoLeccion({ ...base, trabajo: { id: 1, estado: 'en_curso', tipos: ['apuntes'] } }).texto, 'Generando')
  const listos = { tipos: { apuntes: 'listo' }, fichas: 9, en_marcha: true }
  const e = estadoLeccion({ ...listos, trabajo: { id: 2, estado: 'en_curso', tipos: ['diapositivas'] } })
  assert.equal(e.clase, 'listo')
  assert.equal(e.texto, 'Listo · 9 fichas · haciendo diapositivas')
  // Rehacer los apuntes sí los tapa: lo que hay va a cambiar.
  assert.equal(estadoLeccion({ ...listos, trabajo: { id: 3, estado: 'en_curso', tipos: ['apuntes', 'preguntas'] } }).texto, 'Generando')
  // Respuesta antigua del servidor (sin `trabajo`).
  assert.equal(estadoLeccion({ tipos: {}, fichas: 0, en_marcha: true }).texto, 'Generando')
  assert.equal(estadoLeccion(undefined).texto, 'Sin material')
})

test('barra: preparar la lección (1 de 1) no salta al 100 %, y las fases van en orden', () => {
  const fases: [string, number, number][] = [
    ['pendiente', 0, 0],
    ['entrada', 0, 1],
    ['contrato', 0, 1],
    ['escribir', 0, 5],
    ['juez', 2, 5],
    ['aceptar', 4, 5],
    ['montar', 0, 1],
    ['preguntas', 0, 1],
    ['pintar', 0, 1],
  ]
  const valores = fases.map(([n, p, t]) => porcentaje(n, p, t))
  assert.ok(valores[1] < 20, `entrada: ${valores[1]}`)
  for (let i = 1; i < valores.length; i++) assert.ok(valores[i] >= valores[i - 1], `${fases[i][0]}: ${valores}`)
  assert.ok(valores.every((v) => v < 100))
})

test('cola: dice cuántos van por delante', () => {
  assert.equal(textoCola({ por_delante: 3, en_marcha: 2, a_la_vez: 2 }), 'En cola: 3 por delante')
  assert.match(textoCola({ por_delante: 0, en_marcha: 2, a_la_vez: 2 }), /en cuanto acabe/)
  assert.equal(textoCola({ por_delante: 0, en_marcha: 0, a_la_vez: 2 }), 'En cola: empieza enseguida')
  assert.equal(textoCola(null), 'En cola')
})
