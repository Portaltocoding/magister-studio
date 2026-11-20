// La bienvenida: qué pasos hay, cuáles se saltan, cómo avanza la conexión con Claude y qué enlace se abre.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CUENTA_INICIAL,
  codigoLimpio,
  codigoPosible,
  enlaceSeguro,
  esErrorDeCuenta,
  esSinPty,
  fraseDePrueba,
  inicialCuenta,
  limpiarNombre,
  modoDe,
  pasosDe,
  puedeCambiarCuenta,
  pasosConexion,
  posicion,
  reducirCuenta,
  resultadoClaude,
  resultadoVoz,
  saludo,
  siguiente,
  textoMascota,
  tituloDe,
  trasLaPrueba,
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

test('el paso de Claude se enseña siempre, también con cuenta ya conectada', () => {
  assert.deepEqual(pasosDe('completa'), ['idioma', 'nombre', 'cuenta', 'prueba', 'plan', 'apuntes'])
  assert.deepEqual(pasosDe('reconectar'), ['cuenta', 'prueba'])
})

test('avanzar y contar los pasos', () => {
  const pasos = pasosDe('completa')
  assert.equal(siguiente(pasos, 'idioma'), 'nombre')
  assert.equal(siguiente(pasos, 'nombre'), 'cuenta')
  assert.equal(siguiente(pasos, 'apuntes'), null)
  assert.deepEqual(posicion(pasos, 'plan'), { n: 5, de: 6 })
  assert.deepEqual(posicion(pasosDe('reconectar'), 'prueba'), { n: 2, de: 2 })
})

test('la cuenta empieza conectada o con las instrucciones, y «Conectar otra cuenta» las enseña', () => {
  assert.equal(inicialCuenta(true).fase, 'conectada')
  assert.equal(inicialCuenta(false).fase, 'inicio')
  assert.equal(reducirCuenta(inicialCuenta(true), { tipo: 'otra' }).fase, 'inicio')
  assert.equal(reducirCuenta(inicialCuenta(false), { tipo: 'otra' }).fase, 'inicio')
  assert.equal(pasosConexion().length, 3)
})

test('sin pty se dice sin jerga y se puede volver a la cuenta conectada', () => {
  const msg = 'En este equipo Magister ya usa la cuenta de Claude con la que iniciaste sesión.'
  assert.equal(esSinPty(msg), true)
  assert.equal(esSinPty('El código no ha valido'), false)
  const e = correr([{ tipo: 'otra' }, { tipo: 'pulsar' }, { tipo: 'fallo', mensaje: msg }], inicialCuenta(true))
  assert.equal(e.fase, 'sinpty')
  assert.equal(e.error, null)
  assert.equal(reducirCuenta(e, { tipo: 'volver' }).fase, 'conectada')
})

test('la prueba da dos resultados, voz y Claude, con qué hacer si falla', () => {
  assert.equal(resultadoVoz(true).ok, true)
  assert.match(resultadoVoz(false).texto, /sube el volumen/i)
  assert.equal(resultadoClaude({ ok: true, cuenta: true }).ok, true)
  assert.match(resultadoClaude({ ok: false, cuenta: false }).texto, /Conecta tu cuenta/)
  assert.match(resultadoClaude({ ok: false, cuenta: true }).texto, /Probar otra vez/)
  assert.match(textoMascota('prueba', ''), /te saludaré en voz alta/)
  assert.match(trasLaPrueba('completa'), /plan/)
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

test('el primer paso es el idioma y la bienvenida sale en inglés si se elige', () => {
  assert.equal(pasosDe('completa')[0], 'idioma')
  assert.equal(tituloDe('idioma', 'es'), 'Idioma / Language')
  assert.equal(tituloDe('nombre', 'en'), 'What should I call you?')
  assert.match(textoMascota('plan', '', 'completa', 'en'), /what you want to learn/)
  assert.match(textoMascota('cuenta', 'Lucía', 'completa', 'en'), /^Lucía, to think/)
  assert.equal(saludo('Lucía', 'en'), 'Hi, Lucía')
  assert.match(fraseDePrueba('Lucía', 'en'), /^Hi, Lucía. I'm Magister/)
  assert.match(resultadoVoz(false, 'en').texto, /turn the volume up/i)
  assert.match(resultadoClaude({ ok: false, cuenta: false }, 'en').texto, /Connect your account/)
  assert.equal(pasosConexion('en').length, 3)
  assert.equal(esSinPty('On this computer Magister already uses the Claude account you signed in with.'), true)
})

test('sin pty no se ofrece conectar: con cuenta solo se ve cuál es, sin cuenta el aviso llano', () => {
  assert.equal(puedeCambiarCuenta({ puede_conectar: false }), false)
  assert.equal(puedeCambiarCuenta({ puede_conectar: true }), true)
  assert.equal(puedeCambiarCuenta({}), true) // un servidor antiguo no manda el campo
  assert.equal(inicialCuenta(true, false).fase, 'conectada')
  assert.equal(inicialCuenta(false, false).fase, 'sinpty')
  assert.equal(inicialCuenta(false, true).fase, 'inicio')
  assert.equal(inicialCuenta(false).fase, 'inicio')
})
