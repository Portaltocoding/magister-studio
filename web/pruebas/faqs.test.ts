// Las preguntas frecuentes del asesor: reconocer las suyas y dejar pasar al modelo las demás.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscarFaq, ofreceCambio, sugerenciasDe, SUGERENCIAS_PROYECTO } from '../src/componentes/faqs.ts'

const casos: [string, string | null][] = [
  ['como creo un plan', 'plan'],
  ['¿Cómo puedo crear un nuevo plan de estudio?', 'plan'],
  ['me he retrasado con el plan', 'atrasado'],
  ['cuanto gasto de mi cuota', 'barras'],
  ['quiero subir un pdf', 'fuentes'],
  ['como hago un video', 'video'],
  ['barra', 'barras'],
  ['nuevo', null],
  ['Explícame esta pantalla', null],
  ['¿Qué es la idempotencia?', null],
  ['¿por qué el índice no se usa con lower?', null],
]
for (const [pregunta, id] of casos) test(`«${pregunta}» → ${id}`, () => assert.equal(buscarFaq(pregunta)?.id ?? null, id))

// Lo que se pulsa en el chat (sugerencias y respuestas rápidas) va al modelo: no debe confundirse con una frecuente.
for (const pregunta of [...SUGERENCIAS_PROYECTO, 'Sí, prepáralo', 'No, déjalo'])
  test(`«${pregunta}» no es una frecuente`, () => assert.equal(buscarFaq(pregunta), null))

// ===== Sugerencias del chat vacío =====

test('en un proyecto abierto, sugiere pedirle cambios', () => {
  const s = sugerenciasDe('proyectos/12', true)
  assert.equal(s.length, 3)
  assert.equal(s[0], 'Explícame esta pantalla')
  assert.ok(s.includes('¿Qué pasos le faltan a este roadmap?'))
})

test('en Repaso, la pantalla y sus frecuentes', () => {
  assert.deepEqual(sugerenciasDe('repaso', false), ['Explícame esta pantalla', '¿Cómo repaso?', '¿Cómo hago un examen?'])
})

test('en la lista de proyectos, sin proyecto abierto, como siempre', () => {
  const s = sugerenciasDe('proyectos', false)
  assert.equal(s.length, 3)
  assert.equal(s[0], 'Explícame esta pantalla')
  assert.ok(!s.includes('¿Qué pasos le faltan a este roadmap?'))
})

test('una sección con subruta usa la de arriba', () => {
  assert.deepEqual(sugerenciasDe('fichas/3', false), sugerenciasDe('fichas', false))
})

// ===== ¿Ha ofrecido un cambio sin prepararlo? =====

const ofertas: [string, boolean][] = [
  ['Le faltan pruebas antes del despliegue. ¿Lo añado al nivel 1?', true],
  ['Mejor después del bloque de datos. ¿Lo muevo de todas formas?', true],
  ['Es una buena idea. ¿Te lo guardo en Mis notas?', true],
  ['¿Quieres que lo apunte en el diario?', true],
  ['¿Quieres que añada un paso de pruebas?', true],
  ['El bloque 2 tiene ocho pasos.\n\n¿Lo parto en dos?', true],
  ['Ya has hecho estos dos. **¿Los marco como hechos?**', true],
  ['¿Le añado un paso de repaso al final?', true],
  ['¿Reordeno los pasos del nivel 2?', true],
  ['Te llevo allí. ¿Lo añado al nivel 1?\n\n```acciones\nIr al paso | paso:n1-b1-p3\n```', true],
  // Ya lo está preparando: trae su bloque `cambio`.
  ['Añado el paso.\n\n```cambio\nAñadir al nivel 1 un paso de pruebas\n```', false],
  ['¿Lo añado al nivel 1?\n```cambio\nAñadir un paso\n```', false],
  // Con alternativas, un sí no contesta.
  ['¿Lo añado al nivel 1 o al 2?', false],
  ['¿Lo pongo como paso o como bloque nuevo?', false],
  // No empieza frase.
  ['Si quieres, ¿lo añado al nivel 1?', false],
  // No es un cambio.
  ['¿Te lo explico con un ejemplo?', false],
  ['¿Quieres que te explique el nivel 2?', false],
  ['¿Qué te parece?', false],
  ['¿Cambio de nivel ya?', false],
  ['¿Lo ves?', false],
  // No acaba en pregunta.
  ['¿Lo añado al nivel 1? Dime y lo preparo.', false],
  ['Lo he añadido al nivel 1.', false],
  ['', false],
]
for (const [texto, esperado] of ofertas)
  test(`ofrece cambio: «${texto.slice(0, 50).replace(/\n/g, ' ')}» → ${esperado}`, () => assert.equal(ofreceCambio(texto), esperado))
