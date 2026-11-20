// Los fallos del servidor se enseñan como una frase que se entiende, con el original guardado para copiarlo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorLegible, MENSAJE_ESTRUCTURA, MENSAJE_FRENO, textoValidacion } from '../src/componentes/errores.ts'

test('un 422 sale en castellano y sin repetir la misma frase', () => {
  // Mensaje vacío: el min_length de pydantic, en inglés, y repetido.
  const vacio = { type: 'string_too_short', loc: ['body', 'contenido'], msg: 'String should have at least 1 character' }
  assert.equal(textoValidacion([vacio, vacio]), 'El mensaje está vacío.')
  // Nuestro validador ya viene en castellano: se le quita «Value error, ».
  assert.equal(textoValidacion([{ loc: ['body', 'contenido'], msg: 'Value error, el mensaje está vacío' }]), 'El mensaje está vacío.')
  // Lo que no conocemos: una frase general, nunca el inglés.
  const general = textoValidacion([{ loc: ['body', 'fecha'], msg: 'Input should be a valid date' }, { loc: ['body', 'x'], msg: 'Field required' }])
  assert.equal(general, 'Algún dato no es válido. Revisa lo que has escrito y vuelve a probar.')
  assert.doesNotMatch(general, /should|required/i)
  assert.equal(textoValidacion([]), 'Algún dato no es válido. Revisa lo que has escrito y vuelve a probar.')
  assert.equal(textoValidacion([{ loc: ['body', 'contenido'], msg: 'String should have at most 20000 characters' }]), 'El texto es demasiado largo.')
})

const traduce = (texto: string, empieza: string) => {
  const r = errorLegible(texto)
  assert.ok(r.mensaje.startsWith(empieza), `«${texto}» dio «${r.mensaje}»`)
  assert.equal(r.detalle, texto.trim())
}

test('los mensajes nuevos del servidor salen tal cual', () => {
  assert.deepEqual(errorLegible(MENSAJE_ESTRUCTURA), { mensaje: MENSAJE_ESTRUCTURA, detalle: null })
  assert.deepEqual(errorLegible(MENSAJE_FRENO), { mensaje: MENSAJE_FRENO, detalle: null })
})

test('un texto legible sale tal cual', () => {
  for (const t of ['esa pregunta ya no existe', 'el fichero pasa de 50 MB', 'No hay conexión con Magister: ¿está en marcha el servidor?'])
    assert.deepEqual(errorLegible(t), { mensaje: t, detalle: null })
})

test('el «Error: » de String(e) se quita', () => {
  assert.deepEqual(errorLegible('Error: esa pregunta ya no existe'), { mensaje: 'esa pregunta ya no existe', detalle: null })
  assert.equal(errorLegible('Error: ErrorModelo: plazo agotado').detalle, 'ErrorModelo: plazo agotado')
})

test('vacío o nulo', () => {
  for (const t of [null, undefined, '', '   ']) {
    const r = errorLegible(t)
    assert.ok(r.mensaje.length > 0)
    assert.equal(r.detalle, null)
  }
})

test('sin salida válida (ErrorEstructura), también envuelto en «tras N intentos»', () => {
  traduce('RoadmapGen: 3 intentos sin salida válida; último: lecciones: Field required', 'No he conseguido un resultado válido')
  traduce('tras 5 intentos: RoadmapGen: 3 intentos sin salida válida; último: niveles.0: Field required', 'No he conseguido un resultado válido')
  traduce('Apuntes: 2 intentos sin salida válida; último: no devolvió salida estructurada', 'No he conseguido un resultado válido')
})

test('el freno, suelto o dentro de un ErrorEstructura', () => {
  traduce('freno: todas las llamadas al modelo en pausa por demasiadas llamadas seguidas', MENSAJE_FRENO)
  traduce('tras 5 intentos: Apuntes: 3 intentos sin salida válida; último: error del modelo: freno: «apuntes» en pausa por demasiadas llamadas seguidas', MENSAJE_FRENO)
})

test('plazos', () => {
  traduce('tras 5 intentos: plazo agotado', 'El modelo ha tardado demasiado')
  traduce('plazo agotado esperando el primer trozo', 'El modelo ha tardado demasiado')
  traduce('claude tardó más de 420 s', 'El modelo ha tardado demasiado')
  traduce('Guion: 3 intentos sin salida válida; último: error del modelo: plazo agotado', 'El modelo ha tardado demasiado')
})

test('el motor en pausa por fallos seguidos', () => {
  traduce('el motor claude está en pausa tras varios fallos seguidos; vuelve a probar en un minuto', 'El modelo ha fallado varias veces')
})

test('no está el programa claude', () => {
  traduce('ErrorModelo: no encuentro el programa claude en el PATH', 'No encuentro el programa del modelo')
})

test('límite de uso y saturación', () => {
  traduce('tras 5 intentos: Claude AI usage limit reached|1763560800', 'Has llegado al límite')
  traduce('claude salió con código 1: API Error: 529 overloaded_error', 'El modelo está saturado')
})

test('el modelo falla sin más', () => {
  traduce('ErrorModelo: claude salió con código 1: algo raro', 'El modelo ha fallado al contestar')
  traduce('claude terminó sin resultado: ', 'El modelo ha fallado al contestar')
})

test('la base de datos y la conexión', () => {
  traduce('OperationalError: (asyncpg.exceptions.ConnectionDoesNotExistError) connection was closed', 'No llego a la base de datos')
  traduce('tras 5 intentos: [WinError 1225] ConnectionRefusedError', 'Se ha cortado la conexión')
  traduce('Failed to fetch', 'Se ha cortado la conexión')
})

test('un 500 sin cuerpo', () => {
  traduce('Internal Server Error', 'Algo ha fallado en el servidor')
})

test('tras N intentos sin causa', () => {
  traduce('tras 5 intentos: ', 'No ha salido tras varios intentos')
})

test('errores de programación y trazas', () => {
  traduce("KeyError: 'lecciones'", 'Algo ha fallado por dentro')
  traduce('tipo de trabajo desconocido: otro', 'Algo ha fallado por dentro')
  traduce('Traceback (most recent call last):\n  File "x.py", line 1', 'Algo ha fallado por dentro')
  traduce("Cannot read properties of undefined (reading 'x')", 'Algo ha fallado por dentro')
})

test('con un prefijo legible se guarda el prefijo', () => {
  const r = errorLegible('No he podido cancelar: ErrorModelo: plazo agotado')
  assert.equal(r.mensaje, 'No he podido cancelar. El modelo ha tardado demasiado en contestar. Vuelve a pedirlo; si se repite, pide algo más corto.')
  assert.equal(r.detalle, 'No he podido cancelar: ErrorModelo: plazo agotado')
  const m = errorLegible('no se pudo corregir de una vez: tras 2 intentos: plazo agotado')
  assert.ok(m.mensaje.startsWith('No se pudo corregir de una vez. El modelo ha tardado'))
  assert.deepEqual(errorLegible('No he podido borrar la fuente: fuente no encontrada'), {
    mensaje: 'No he podido borrar la fuente: fuente no encontrada',
    detalle: null,
  })
})

test('los errores comunes salen en inglés si el idioma es inglés', () => {
  assert.match(errorLegible('freno: «apuntes» en pausa por demasiadas llamadas seguidas', 'en').mensaje, /too many model calls/)
  assert.match(errorLegible('la cuenta de Claude no está conectada o ha caducado', 'en').mensaje, /Claude account is not connected/)
  assert.match(errorLegible('No he podido cancelar: ErrorModelo: plazo agotado', 'en').mensaje, /^No he podido cancelar\. The model took too long/)
  assert.equal(errorLegible('', 'en').mensaje, 'Something failed, but I don\'t know what. Try again.')
  // El mensaje ya legible en español, visto desde el inglés, se enseña en inglés.
  assert.equal(errorLegible(MENSAJE_FRENO, 'en').detalle, null)
  assert.match(errorLegible(MENSAJE_FRENO, 'en').mensaje, /paused/)
  assert.equal(textoValidacion([{ msg: 'String should have at most 5 characters', loc: ['body', 'x'] }], 'en'), 'The text is too long.')
})
