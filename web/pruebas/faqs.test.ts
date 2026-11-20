// Las preguntas frecuentes del asesor: reconocer las suyas y dejar pasar al modelo las demás.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscarFaq, esPantallaDePlan, faqs, ofreceCambio, sugerenciasDe, sugerenciasPlan, sugerenciasProyecto } from '../src/componentes/faqs.ts'
import { fijarIdioma } from '../src/i18n/i18n.ts'

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
for (const pregunta of [...sugerenciasProyecto(), 'Sí, prepáralo', 'No, déjalo'])
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

test('en las pantallas del plan, con plan, sugiere pedirle cambios del plan', () => {
  assert.deepEqual(sugerenciasDe('hoy', false, true), ['Explícame esta pantalla', 'Mueve la sesión de hoy a mañana', 'Marca esta lección como hecha'])
  assert.ok(sugerenciasDe('calendario', false, true).includes('Mueve la sesión de hoy a mañana'))
  assert.deepEqual(sugerenciasDe('fichas/3/L2', false, true), sugerenciasPlan().fichas)
  // Sin plan, las frecuentes de siempre; y en un proyecto mandan las del proyecto.
  assert.deepEqual(sugerenciasDe('hoy', false), sugerenciasDe('hoy', false, false))
  assert.ok(!sugerenciasDe('hoy', false).includes('Mueve la sesión de hoy a mañana'))
  assert.deepEqual(sugerenciasDe('proyectos/12', true, true), sugerenciasProyecto())
  assert.ok(esPantallaDePlan('roadmap') && !esPantallaDePlan('repaso'))
})

// Las del plan también van al modelo: tampoco son frecuentes.
for (const pregunta of new Set(Object.values(sugerenciasPlan()).flat().filter((x) => x !== 'Explícame esta pantalla')))
  test(`«${pregunta}» no es una frecuente`, () => assert.equal(buscarFaq(pregunta), null))

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
  // En el plan.
  ['El viernes ya vas lleno. ¿La muevo al lunes?', true],
  ['¿Te apunto el parcial en la agenda?', true],
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

// ===== En inglés =====

const enIngles = (f: () => void) => {
  fijarIdioma('en')
  try {
    f()
  } finally {
    fijarIdioma('es')
  }
}

test('en inglés, las frecuentes se reconocen y las sugerencias salen en inglés', () =>
  enIngles(() => {
    assert.equal(buscarFaq('how do I create a study plan')?.id, 'plan')
    assert.equal(buscarFaq('where are my saved notes')?.id, 'notas')
    assert.equal(buscarFaq('bars')?.id, 'barras')
    assert.equal(buscarFaq('what is idempotence'), null)
    assert.deepEqual(sugerenciasDe('repaso', false), ['Explain this screen to me', 'How do I review?', 'How do I take an exam?'])
    assert.ok(faqs().find((f) => f.id === 'plan')!.respuesta.includes('Go to the Roadmap | #/roadmap'))
  }))

test('en inglés, ofrece cambio con «Shall I…?» y no con alternativas ni con otras preguntas', () =>
  enIngles(() => {
    assert.equal(ofreceCambio('It is missing tests. Shall I add it to level 1?'), true)
    assert.equal(ofreceCambio('Do you want me to move it to Monday?'), true)
    assert.equal(ofreceCambio('Shall I add it to level 1 or level 2?'), false)
    assert.equal(ofreceCambio('If you like, shall I add it?'), false)
    assert.equal(ofreceCambio('Do you want me to explain level 2?'), false)
  }))

test('el español y el inglés tienen sus frecuentes completas', () => {
  const es = faqs()
  enIngles(() => assert.equal(faqs().length, es.length))
  assert.ok(es.every((f) => f.pregunta && f.respuesta && f.claves.length >= 3))
})
