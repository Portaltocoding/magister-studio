// El párrafo activo del modo foco: qué es una unidad de lectura, cómo se pasa de una a otra y cuándo una tecla no es
// del foco. Con un DOM hecho a mano (sin navegador).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anterior, curva, debeIgnorar, destinoScroll, elegirPorLinea, siguiente, unidades, type Nodo } from '../src/componentes/parrafos.ts'

interface Falso extends Nodo {
  children: Falso[]
  atributos: Record<string, string>
  nombre: string
}

function el(tagName: string, texto = '', hijos: Falso[] = [], clases: string[] = [], dentro: string[] = []): Falso {
  return {
    tagName,
    nombre: texto.slice(0, 12),
    children: hijos,
    textContent: texto + hijos.map((h) => h.textContent).join(''),
    classList: { contains: (c: string) => clases.includes(c) },
    querySelector: (s: string) => (s.split(',').some((x) => dentro.includes(x.trim())) ? {} : null),
    atributos: {},
    setAttribute(n: string, v: string) {
      this.atributos[n] = v
    },
  }
}

test('unidades: títulos y rayas fuera, cada li directo es una, un li anidado va con su padre', () => {
  const anidada = el('UL', '', [el('LI', 'hija')])
  const papel = el('DIV', '', [
    el('H1', 'Título'),
    el('P', 'Primero'),
    el('UL', '', [el('LI', 'uno', [anidada]), el('LI', 'dos')]),
    el('HR'),
    el('PRE', 'código'),
  ])
  const u = unidades(papel)
  assert.deepEqual(
    u.map((x) => x.tagName),
    ['P', 'LI', 'LI', 'PRE'],
  )
  assert.equal(u[1].children[0], anidada)
  assert.deepEqual(u.map((x) => x.atributos['data-u']), ['0', '1', '2', '3'])
  assert.ok(u.every((x) => x.atributos.tabindex === '-1'))
})

test('unidades: un aviso con dos párrafos es una sola unidad', () => {
  const aviso = el('DIV', '', [el('P', 'Ojo:'), el('P', 'esto importa')], ['lb-aviso'])
  const u = unidades(el('DIV', '', [aviso, el('P', 'Después')]))
  assert.equal(u.length, 2)
  assert.equal(u[0], aviso)
})

test('unidades: fuera las vacías, salvo si llevan un dibujo, una imagen o una tabla', () => {
  const dibujo = el('FIGURE', '', [], [], ['svg'])
  const u = unidades(el('DIV', '', [el('P', '   '), dibujo, el('P', 'texto')]))
  assert.deepEqual(u, [dibujo, u[1]])
  assert.equal(u[1].textContent, 'texto')
})

test('siguiente y anterior se paran en los extremos', () => {
  assert.equal(siguiente(0, 3), 1)
  assert.equal(siguiente(2, 3), 2)
  assert.equal(siguiente(0, 0), 0)
  assert.equal(anterior(1), 0)
  assert.equal(anterior(0), 0)
})

test('elegirPorLinea: la que contiene la línea o, si ninguna, la más cercana', () => {
  const rects = [
    { top: 0, bottom: 100 },
    { top: 120, bottom: 200 },
    { top: 230, bottom: 400 },
  ]
  assert.equal(elegirPorLinea(rects, 150), 1)
  assert.equal(elegirPorLinea(rects, 110), 0)
  assert.equal(elegirPorLinea(rects, 219), 2)
  assert.equal(elegirPorLinea(rects, 900), 2)
  assert.equal(elegirPorLinea([], 10), -1)
})

const objetivo = (coincide: string[]) => ({ closest: (s: string) => (s.split(',').some((x) => coincide.includes(x.trim())) ? {} : null) })
const ctx = { pantalla: 'idea' as const, menuAbierto: false }

test('debeIgnorar: escribiendo en un textarea, con Alt, Espacio sobre un botón, fuera de la idea o con el menú abierto', () => {
  assert.equal(debeIgnorar({ key: 'ArrowDown', target: objetivo(['textarea']) }, ctx), true)
  assert.equal(debeIgnorar({ key: 'ArrowLeft', altKey: true, target: objetivo([]) }, ctx), true)
  assert.equal(debeIgnorar({ key: ' ', target: objetivo(['button']) }, ctx), true)
  assert.equal(debeIgnorar({ key: 'ArrowRight', target: objetivo([]) }, { pantalla: 'calentamiento', menuAbierto: false }), true)
  assert.equal(debeIgnorar({ key: 'ArrowDown', target: objetivo([]) }, { pantalla: 'idea', menuAbierto: true }), true)
  assert.equal(debeIgnorar({ key: 'ArrowDown', target: objetivo(['.companera-bocadillo']) }, ctx), true)
  assert.equal(debeIgnorar({ key: 'a', isComposing: true, target: objetivo([]) }, ctx), true)
})

test('debeIgnorar: leyendo, las flechas y Espacio son del foco (también sobre un botón, las flechas)', () => {
  assert.equal(debeIgnorar({ key: 'ArrowDown', target: objetivo([]) }, ctx), false)
  assert.equal(debeIgnorar({ key: ' ', target: objetivo([]) }, ctx), false)
  assert.equal(debeIgnorar({ key: 'ArrowRight', target: objetivo(['button']) }, ctx), false)
})

test('destinoScroll: si cabe entre el 12 % y el 88 %, no se mueve; si no, su borde de arriba al 35 %', () => {
  const zona = { top: 100, height: 1000 }
  assert.equal(destinoScroll({ top: 300, bottom: 600 }, zona, 50), null)
  // Se sale por abajo: top 900 → 450 (35 %), hay que bajar 450.
  assert.equal(destinoScroll({ top: 1000, bottom: 1100 }, zona, 50), 50 + (1000 - 450))
  // Con escala 0,5, cada píxel de desplazamiento ocupa medio de pantalla.
  assert.equal(destinoScroll({ top: 1000, bottom: 1100 }, zona, 0, 0.5), 1100)
  // Nunca por encima del principio.
  assert.equal(destinoScroll({ top: 0, bottom: 50 }, zona, 10), 0)
})

test('curva: empieza en 0, acaba en 1 y va más deprisa al principio', () => {
  assert.equal(curva(0), 0)
  assert.equal(curva(1), 1)
  assert.ok(curva(0.25) > 0.6)
})
