// La bienvenida: qué pasos hay, cuáles se saltan, cómo avanza la conexión con Claude y qué enlace se abre.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CUENTA_INICIAL,
  codigoLimpio,
  codigoPosible,
  enlaceSeguro,
  esErrorDeCuenta,
  fraseDePrueba,
  limpiarNombre,
  modoDe,
  pasosDe,
  posicion,
  reducirCuenta,
  saludo,
  siguiente,
  textoMascota,
  type EstadoCuenta,
  type EventoCuenta,
} from '../src/componentes/bienvenida.ts'
import { errorLegible } from '../src/componentes/errores.ts'

test('solo se enseña la primera vez, y el paso de Claude si la cuenta ha caducado', () => {
  const sin = { conectada: true, caida: false }
  assert.equal(modoDe({ estado: 'pendiente', cuenta: sin }), 'completa')
  assert.equal(modoDe({ estado: 'hecha', cuenta: sin }), null)
  assert.equal(modoDe({ estado: 'omitida', cuenta: sin }), null)
  assert.equal(modoDe({ estado: 'hecha', cuenta: { conectada: false, caida: true } }), 'reconectar')
  assert.equal(modoDe({ estado: 'pendiente', cuenta: { conectada: false, caida: true } }), 'completa')
})

test('el paso de Claude se salta si ya hay cuenta (el desarrollo con tu propio login)', () => {
  assert.deepEqual(pasosDe('completa', false), ['nombre', 'cuenta', 'prueba', 'plan', 'apuntes'])
  assert.deepEqual(pasosDe('completa', true), ['nombre', 'prueba', 'plan', 'apuntes'])
  assert.deepEqual(pasosDe('reconectar', true), ['cuenta', 'prueba'])
})

test('avanzar y contar los pasos', () => {
  const pasos = pasosDe('completa', true)
  assert.equal(siguiente(pasos, 'nombre'), 'prueba')
  assert.equal(siguiente(pasos, 'apuntes'), null)
  assert.deepEqual(posicion(pasos, 'plan'), { n: 3, de: 4 })
})

test('el nombre se limpia y el saludo lo usa', () => {
  assert.equal(limpiarNombre('  Lucía   María '), 'Lucía María')
  assert.equal(limpiarNombre('x'.repeat(100)).length, 60)
  assert.equal(saludo('Lucía'), 'Hola, Lucía')
  assert.equal(saludo(''), 'Hola')
  assert.match(fraseDePrueba('Lucía'), /^Hola, Lucía\./)
  assert.match(textoMascota('cuenta', 'Lucía'), /^Lucía, para pensar/)
  assert.match(textoMascota('cuenta', ''), /^Para pensar/)
  assert.match(textoMascota('cuenta', '', 'reconectar'), /caducado/)
})

const correr = (evs: EventoCuenta[], desde: EstadoCuenta = CUENTA_INICIAL) => evs.reduce(reducirCuenta, desde)

test('la conexión con Claude: enlace, código, conectada', () => {
  const e = correr([{ tipo: 'pulsar' }, { tipo: 'enlace', enlace: 'https://claude.ai/oauth/authorize?x=1' }])
  assert.deepEqual(e, { fase: 'codigo', enlace: 'https://claude.ai/oauth/authorize?x=1', error: null })
  assert.equal(correr([{ tipo: 'enviar' }, { tipo: 'conectada' }], e).fase, 'lista')
})

test('un fallo deja «Probar otra vez», que vuelve al principio', () => {
  const e = correr([{ tipo: 'pulsar' }, { tipo: 'enlace', enlace: 'https://claude.ai/x' }, { tipo: 'enviar' }, { tipo: 'fallo', mensaje: 'Ese código no ha valido.' }])
  assert.deepEqual(e, { fase: 'error', enlace: null, error: 'Ese código no ha valido.' })
  assert.deepEqual(reducirCuenta(e, { tipo: 'reiniciar' }), CUENTA_INICIAL)
  assert.equal(correr([{ tipo: 'pulsar' }, { tipo: 'fallo', mensaje: 'sin enlace' }]).fase, 'error')
})

test('lo que no toca en esa fase se ignora (doble clic, respuestas tardías)', () => {
  assert.equal(correr([{ tipo: 'enviar' }]).fase, 'inicio')
  assert.equal(correr([{ tipo: 'pulsar' }, { tipo: 'pulsar' }]).fase, 'abriendo')
  assert.equal(correr([{ tipo: 'conectada' }]).fase, 'inicio')
  assert.equal(correr([{ tipo: 'fallo', mensaje: 'x' }]).fase, 'inicio')
})

test('el código pegado se limpia y no vale si es muy corto', () => {
  assert.equal(codigoLimpio('  abc123 \n def456\n'), 'abc123def456')
  assert.equal(codigoPosible('abc'), false)
  assert.equal(codigoPosible('  abcdef12 345 '), true)
})

test('solo se abre un enlace https de Claude', () => {
  assert.equal(enlaceSeguro('https://claude.ai/oauth/authorize?code=true'), true)
  assert.equal(enlaceSeguro('https://claude.com/cai/oauth/authorize'), true)
  assert.equal(enlaceSeguro('http://claude.ai/oauth'), false)
  assert.equal(enlaceSeguro('https://claude.ai.malo.com/oauth'), false)
  assert.equal(enlaceSeguro('javascript:alert(1)'), false)
  assert.equal(enlaceSeguro('no es un enlace'), false)
})

test('un fallo de cuenta se reconoce y se dice sin texto técnico', () => {
  const texto = 'la cuenta de Claude no está conectada o ha caducado'
  assert.equal(esErrorDeCuenta(texto), true)
  assert.equal(esErrorDeCuenta('usage limit reached'), false)
  assert.equal(esErrorDeCuenta(undefined), false)
  const l = errorLegible(texto)
  assert.match(l.mensaje, /Vuelve a conectarla/)
  assert.equal(l.mensaje.includes('ErrorModelo'), false)
})
