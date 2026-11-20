import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// La tipografía única: las pilas de la web (index.css) y las del servidor (config.py) tienen que ser la misma.
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf-8')
const py = readFileSync(new URL('../../servidor/src/magister/config.py', import.meta.url), 'utf-8')
const igual = (a: string) => a.replace(/"/g, "'").replace(/\s+/g, ' ').trim()

for (const [css_var, py_var] of [['--fuente-texto', 'FUENTE_TEXTO'], ['--fuente-mono', 'FUENTE_MONO']]) {
  test(`${css_var} es igual en la web y en el servidor`, () => {
    const a = css.match(new RegExp(String.raw`${css_var}:\s*([^;]+);`))?.[1]
    const b = py.match(new RegExp(String.raw`${py_var}\s*=\s*"([^"\n]+)"`))?.[1]
    assert.ok(a && b)
    assert.equal(igual(a), igual(b))
  })
}

test('ningún CSS de la app nombra otra familia fuera de los temas', () => {
  for (const f of ['bloques.css', 'chat.css', 'video.css', 'vistas.css']) {
    const t = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8')
    assert.doesNotMatch(t, /Georgia|JetBrains|Inter,/, f)
  }
})
