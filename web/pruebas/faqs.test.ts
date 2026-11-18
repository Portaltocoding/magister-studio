// Las preguntas frecuentes del asesor: reconocer las suyas y dejar pasar al modelo las demás.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscarFaq } from '../src/componentes/faqs.ts'

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
