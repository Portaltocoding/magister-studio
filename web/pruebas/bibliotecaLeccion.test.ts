// La pequeña biblioteca de cada lección: la frase que toca en cada estado.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  algunaBuscando,
  avisoAlAceptar,
  avisoIncompleta,
  chipNecesidad,
  clavesParaBuscar,
  enLista,
  lineaFuente,
  resumenBiblioteca,
  textoApuntes,
  textoResearch,
  textoSinFuente,
  type Biblioteca,
  type Fuente,
} from '../src/componentes/bibliotecaLeccion.ts'

const fuente = (x: Partial<Fuente> = {}): Fuente => ({ titulo: 'Guía de JSON', dominio: 'mdn.org', tipo: 'oficial', cubre: [1, 3], estado: 'lista', ...x })
const bib = (x: Partial<Biblioteca> = {}): Biblioteca => ({ fuentes: [], sin_fuente: [], research: 'acabada', cobertura_conocida: true, ...x })

test('las listas se dicen en castellano', () => {
  assert.equal(enLista([1]), '1')
  assert.equal(enLista([1, 3]), '1 y 3')
  assert.equal(enLista([1, 2, 3]), '1, 2 y 3')
})

test('una línea por fuente: título, dominio, tipo y qué objetivos cubre; el estado solo si no está lista', () => {
  assert.equal(lineaFuente(fuente()), 'Guía de JSON · mdn.org · documentación oficial · cubre 1 y 3')
  assert.equal(lineaFuente(fuente({ estado: 'indexando', cubre: [], tipo: null })), 'Guía de JSON · mdn.org · indexándose')
})

test('plegada, una línea: cuántas fuentes y cuántos objetivos cubren', () => {
  const b = bib({ fuentes: [fuente(), fuente(), fuente({ estado: 'indexando' })], sin_fuente: [2] })
  assert.equal(resumenBiblioteca(b, 4), '3 fuentes · cubre 3 de 4 objetivos')
})

test('sin ficha del juez no se inventa la cobertura, y lo que no ha entrado se cuenta aparte', () => {
  const b = bib({ fuentes: [fuente({ cubre: [] }), fuente({ estado: 'propuesta', cubre: [] })], cobertura_conocida: false })
  assert.equal(resumenBiblioteca(b, 4), '1 fuente · 1 sin entrar')
  assert.equal(resumenBiblioteca(bib(), 4), 'Sin fuentes todavía')
  assert.equal(resumenBiblioteca(bib({ research: 'buscando' }), 4), 'Buscando fuentes…')
})

test('los objetivos sin fuente salen por su nombre', () => {
  assert.equal(textoSinFuente([2], ['Leer JSON', 'Calcular precisión, recall y F1']), 'Sin fuente para: Calcular precisión, recall y F1')
  assert.equal(textoSinFuente([], ['a']), '')
})

test('la búsqueda: buscando o cortada; acabada no dice nada', () => {
  assert.equal(textoResearch('buscando'), 'Buscando fuentes…')
  assert.equal(textoResearch('cortada'), 'La búsqueda se cortó.')
  assert.equal(textoResearch('acabada'), '')
})

test('el aviso de rehacer los apuntes solo sale si se hicieron sin las fuentes que hay ahora', () => {
  assert.equal(textoApuntes('sin_fuentes', 3), 'Estos apuntes se hicieron sin tus fuentes. Ya hay 3 fuentes para esta lección.')
  assert.match(textoApuntes('nuevas', 1), /fuentes nuevas\. Ya hay 1 fuente para/)
  assert.equal(textoApuntes('al_dia', 3), '')
  assert.equal(textoApuntes('sin_fuentes', 0), '')
  assert.equal(textoApuntes(null, 3), '')
})

test('un documento a medias lo dice y pide el PDF', () => {
  assert.equal(avisoIncompleta('solo se ve el resumen.'), 'Solo una parte: solo se ve el resumen. Si lo tienes completo, súbelo en PDF.')
})

test('el Roadmap se refresca solo mientras alguna lección busca', () => {
  assert.equal(algunaBuscando([{ biblioteca: bib({ research: 'buscando' }) }, {}]), true)
  assert.equal(algunaBuscando([{ biblioteca: bib() }, {}]), false)
})

test('al aceptar: cuántas lecciones y unos minutos, y que entran solas', () => {
  assert.equal(avisoAlAceptar(20), 'Busco fuentes para 20 lecciones (unos 20 minutos). Entran solas; lo ves en Roadmap, lección a lección.')
  assert.match(avisoAlAceptar(1), /^Busco fuentes para 1 lección \(unos 2 minutos\)/)
})

test('al aceptar: lo marcado «no» no se lanza, se cuentan las tareas lanzadas y se enseña el aviso', () => {
  const lecciones = [
    { clave: 'L1', sin_material: true, necesita_fuentes: 'no' },
    { clave: 'L2', sin_material: true, necesita_fuentes: 'conviene' },
    { clave: 'L3', sin_material: false, necesita_fuentes: 'imprescindible' },
    { clave: 'L4', sin_material: true },
  ]
  assert.deepEqual(clavesParaBuscar(lecciones), ['L2', 'L4'])
  // Un plan de una sola lección marcada «no»: no se lanza nada.
  assert.deepEqual(clavesParaBuscar([lecciones[0]]), [])
  assert.match(avisoAlAceptar(0), /^No busco fuentes/)
  const aviso = 'No busco fuentes para 1 lección (L1): se explican bien sin ellas.'
  assert.equal(avisoAlAceptar(1, aviso).endsWith(aviso), true)
  assert.match(avisoAlAceptar(1, aviso), /^Busco fuentes para 1 lección/)
})

test('el chip enseña la etiqueta guardada y avisa si tu material la cambia', () => {
  assert.deepEqual(chipNecesidad({ necesita_fuentes: 'conviene', necesita_fuentes_guardada: 'no' }), {
    valor: 'no',
    nota: 'tu material manda: se busca igual',
  })
  assert.deepEqual(chipNecesidad({ necesita_fuentes: 'imprescindible', necesita_fuentes_guardada: 'imprescindible' }), {
    valor: 'imprescindible',
    nota: '',
  })
  // Un servidor de antes (sin la guardada) o un plan sin etiqueta: la que se usa.
  assert.deepEqual(chipNecesidad({ necesita_fuentes: 'conviene' }), { valor: 'conviene', nota: '' })
  assert.deepEqual(chipNecesidad({ necesita_fuentes: 'conviene', necesita_fuentes_guardada: null }), { valor: 'conviene', nota: '' })
})
