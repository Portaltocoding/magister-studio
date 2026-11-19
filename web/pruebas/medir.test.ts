// Medir la voz del vídeo: la duración de un WAV por su cabecera y las peticiones de pocas en pocas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duracionWav, enParalelo } from '../src/escena/medir.ts'

// Un WAV PCM mono de 16 bits: cabecera RIFF, bloque «fmt », otro bloque cualquiera y los datos.
function wav(muestras: number, frecuencia = 22050, { extra = false, datosDeclarados }: { extra?: boolean; datosDeclarados?: number } = {}): ArrayBuffer {
  const datos = muestras * 2
  const otro = extra ? 8 + 4 : 0
  const b = new ArrayBuffer(12 + 24 + otro + 8 + datos)
  const v = new DataView(b)
  const escribe = (p: number, s: string) => [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)))
  escribe(0, 'RIFF')
  v.setUint32(4, b.byteLength - 8, true)
  escribe(8, 'WAVE')
  escribe(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, frecuencia, true)
  v.setUint32(28, frecuencia * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  let p = 36
  if (extra) {
    escribe(p, 'LIST')
    v.setUint32(p + 4, 4, true)
    p += 12
  }
  escribe(p, 'data')
  v.setUint32(p + 4, datosDeclarados ?? datos, true)
  return b
}

test('la duración sale de los datos entre los bytes por segundo', () => {
  assert.equal(duracionWav(wav(22050)), 1)
  assert.equal(duracionWav(wav(33075, 22050)), 1.5)
  assert.equal(duracionWav(wav(16000, 16000, { extra: true })), 1)
})

test('un WAV escrito al vuelo (tamaño de datos sin rellenar) cuenta lo que hay', () => {
  assert.equal(duracionWav(wav(22050, 22050, { datosDeclarados: 0xffffffff })), 1)
})

test('lo que no es un WAV da null', () => {
  assert.equal(duracionWav(new ArrayBuffer(4)), null)
  assert.equal(duracionWav(new TextEncoder().encode('ID3 esto es un mp3 de mentira').buffer as ArrayBuffer), null)
})

test('de pocas en pocas, cada resultado en su sitio y avisando de cuántas van', async () => {
  let enMarcha = 0
  let maximo = 0
  const avisos: number[] = []
  const tareas = Array.from({ length: 10 }, (_, i) => async () => {
    enMarcha++
    maximo = Math.max(maximo, enMarcha)
    await new Promise((r) => setTimeout(r, (10 - i) * 2))
    enMarcha--
    return i * i
  })
  const salida = await enParalelo(tareas, 3, (n) => avisos.push(n))
  assert.deepEqual(salida, tareas.map((_, i) => i * i))
  assert.equal(maximo, 3)
  assert.deepEqual(avisos, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('si una falla, no empieza ninguna más y devuelve el error', async () => {
  const empezadas: number[] = []
  const tareas = Array.from({ length: 8 }, (_, i) => async () => {
    empezadas.push(i)
    await new Promise((r) => setTimeout(r, 1))
    if (i === 1) throw new Error('Piper no responde')
    return i
  })
  await assert.rejects(enParalelo(tareas, 2), /Piper no responde/)
  assert.ok(empezadas.length < 8, `empezó ${empezadas.length}`)
})

test('sin tareas, nada que esperar', async () => {
  assert.deepEqual(await enParalelo([], 3), [])
})
