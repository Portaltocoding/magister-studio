import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import { reaccionar } from './animo.ts'
import { conKatex, tieneMates, usarKatex } from './katexPerezoso.ts'

// Bloques que el tutor escribe en Markdown y la pantalla convierte en botones:
// ```test     → una pregunta tipo test que se corrige aquí mismo, sin gastar otra respuesta del modelo.
// ```opciones → caminos para seguir; pulsarlos envía ese texto.

interface Test {
  enunciado: string
  opciones: { texto: string; buena: boolean }[]
  porque: string
}

export function leerTest(texto: string): Test {
  const enunciado: string[] = []
  const opciones: Test['opciones'] = []
  const porque: string[] = []
  for (const linea of texto.split('\n')) {
    const op = linea.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.+)$/)
    if (op) opciones.push({ texto: op[2].trim(), buena: op[1].toLowerCase() === 'x' })
    else if (/^\s*>/.test(linea)) porque.push(linea.replace(/^\s*>\s?/, ''))
    else if (linea.trim() && !opciones.length) enunciado.push(linea)
  }
  return { enunciado: enunciado.join('\n'), opciones, porque: porque.join(' ') }
}

export function TestRapido({ texto, completo }: { texto: string; completo: boolean }) {
  const t = leerTest(texto)
  const [elegida, setElegida] = useState<number | null>(null)
  const mates = { remarkPlugins: [remarkMath], rehypePlugins: conKatex(usarKatex(tieneMates(texto))) }
  const acierto = elegida != null && t.opciones[elegida]?.buena
  return (
    <div className="test-rapido">
      <span className="test-etq">Compruébalo</span>
      <div className="test-enunciado">
        <Markdown {...mates}>{t.enunciado}</Markdown>
      </div>
      <div className="test-opciones">
        {t.opciones.map((o, i) => (
          <button
            key={i}
            type="button"
            disabled={!completo || elegida != null}
            className={`test-opcion ${elegida != null && o.buena ? 'buena' : ''} ${elegida === i && !o.buena ? 'mala' : ''}`}
            onClick={() => {
              setElegida(i)
              reaccionar(o.buena ? 'acierto' : 'fallo')
            }}
          >
            <span className="test-letra">{String.fromCharCode(65 + i)}</span>
            <Markdown {...mates}>{o.texto}</Markdown>
          </button>
        ))}
      </div>
      {elegida != null && (
        <p className={`test-resultado ${acierto ? 'bien' : 'mal'}`}>
          <strong>{acierto ? '✓ Bien.' : '✗ No.'}</strong> {t.porque}
        </p>
      )}
    </div>
  )
}

export function Opciones({ texto, alElegir, activo }: { texto: string; alElegir?: (t: string) => void; activo: boolean }) {
  const lista = texto
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
  return (
    <div className="respuestas-rapidas opciones-chat">
      {lista.map((o) => (
        <button key={o} type="button" className="opcion opcion-chip" disabled={!activo || !alElegir} onClick={() => alElegir?.(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

// El diagrama vivo (se dibuja trazo a trazo) está en Diagrama.tsx.
export { default as Diagrama } from './Diagrama.tsx'
