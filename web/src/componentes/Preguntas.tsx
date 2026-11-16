import { useEffect, useState } from 'react'

// Lo que el tutor puede pedirte o proponerte dentro de una respuesta, como las preguntas de Claude Code:
// ```pregunta  -> una pregunta con opciones (con explicación, la recomendada marcada, «Otra» y, si quiere, varias a la vez).
// ```agendar   -> una acción: apuntarte algo en el calendario; solo se hace si la aceptas.

interface OpcionPregunta {
  etiqueta: string
  desc: string
  recomendada: boolean
}

// ```pregunta
// ¿Cómo seguimos con Bernoulli?
// (varias)                      <- opcional
// - Con una analogía | Sin fórmulas al principio | recomendada
// - Con la derivación | La energía paso a paso
// ```
export function leerPregunta(texto: string): { titulo: string; varias: boolean; opciones: OpcionPregunta[] } {
  const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean)
  const titulo = lineas.find((l) => !l.startsWith('-') && !/^\(varias\)$/i.test(l)) ?? ''
  const opciones = lineas
    .filter((l) => l.startsWith('-'))
    .map((l) => {
      const [etiqueta = '', desc = '', marca = ''] = l.replace(/^-\s*/, '').split('|').map((x) => x.trim())
      const soloMarca = /^recomendad[ao]$/i.test(desc)
      return { etiqueta, desc: soloMarca ? '' : desc, recomendada: /recomendad/i.test(marca) || soloMarca }
    })
    .filter((o) => o.etiqueta)
  return { titulo, varias: lineas.some((l) => /^\(varias\)$/i.test(l)), opciones }
}

export function PreguntaTarjeta({ texto, completo, alResponder }: { texto: string; completo: boolean; alResponder?: (t: string) => void }) {
  const q = leerPregunta(texto)
  const [elegidas, setElegidas] = useState<string[]>([])
  const [otra, setOtra] = useState('')
  const [enviada, setEnviada] = useState<string | null>(null)
  const activa = completo && !!alResponder && enviada == null
  const enviar = (t: string) => {
    if (!alResponder || !t.trim()) return
    setEnviada(t)
    alResponder(t)
  }
  return (
    <div className={`pregunta-tarjeta ${enviada ? 'respondida' : ''}`}>
      <span className="test-etq">El tutor te pregunta{q.varias ? ' · puedes elegir varias' : ''}</span>
      <p className="pregunta-titulo">{q.titulo}</p>
      <div className="pregunta-opciones">
        {q.opciones.map((o) => {
          const marcada = elegidas.includes(o.etiqueta) || !!enviada?.includes(o.etiqueta)
          return (
            <button
              key={o.etiqueta}
              type="button"
              className={`pregunta-opcion ${marcada ? 'marcada' : ''}`}
              disabled={!activa}
              onClick={() =>
                q.varias
                  ? setElegidas((x) => (x.includes(o.etiqueta) ? x.filter((y) => y !== o.etiqueta) : [...x, o.etiqueta]))
                  : enviar(o.etiqueta)
              }
            >
              <span className="pregunta-marca" aria-hidden>
                {q.varias ? (marcada ? '☑' : '☐') : marcada ? '●' : '○'}
              </span>
              <span className="pregunta-texto">
                <strong>
                  {o.etiqueta}
                  {o.recomendada && <em>Recomendada</em>}
                </strong>
                {o.desc && <small>{o.desc}</small>}
              </span>
            </button>
          )
        })}
      </div>
      {activa && (
        <form
          className="pregunta-otra"
          onSubmit={(e) => {
            e.preventDefault()
            if (q.varias) enviar([...elegidas, otra.trim()].filter(Boolean).join('; '))
            else enviar(otra)
          }}
        >
          <input value={otra} onChange={(e) => setOtra(e.target.value)} placeholder="Otra cosa: escríbela" aria-label="Otra respuesta" />
          <button className="boton-mini" disabled={q.varias ? !elegidas.length && !otra.trim() : !otra.trim()}>
            {q.varias ? 'Enviar' : 'Enviar la mía'}
          </button>
        </form>
      )}
      {enviada && <p className="nota">Respondido: {enviada}</p>}
    </div>
  )
}

// ```agendar
// titulo: Repasar Bernoulli con ejercicios
// fecha: 2026-11-19
// hora: 18:00
// tipo: deber        <- deber, examen, clase o nota
// ```
export function AgendarTarjeta({ texto, completo }: { texto: string; completo: boolean }) {
  const campos = Object.fromEntries(
    texto
      .split('\n')
      .map((l) => l.match(/^\s*(\w+)\s*:\s*(.+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1].toLowerCase(), m[2].trim()]),
  ) as Record<string, string>
  const [fecha, setFecha] = useState(/^\d{4}-\d{2}-\d{2}$/.test(campos.fecha ?? '') ? campos.fecha : new Date().toISOString().slice(0, 10))
  const [hora, setHora] = useState(/^\d{1,2}:\d{2}$/.test(campos.hora ?? '') ? campos.hora.padStart(5, '0') : '')
  const [estado, setEstado] = useState<'propuesta' | 'editando' | 'hecho' | 'no' | 'error'>('propuesta')
  // Mientras el texto aparece, el bloque llega a trozos: la fecha y la hora siguen a lo escrito hasta que las tocas.
  useEffect(() => {
    if (estado !== 'propuesta') return
    if (/^\d{4}-\d{2}-\d{2}$/.test(campos.fecha ?? '')) setFecha(campos.fecha)
    if (/^\d{1,2}:\d{2}$/.test(campos.hora ?? '')) setHora(campos.hora.padStart(5, '0'))
  }, [campos.fecha, campos.hora, estado])
  const tipo = ['deber', 'examen', 'clase', 'nota'].includes(campos.tipo) ? campos.tipo : 'deber'
  const legible = () =>
    `${new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}${hora ? ` a las ${hora}` : ''}`
  const apuntar = async () => {
    try {
      const r = await fetch('/api/eventos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fecha, hora: hora || null, titulo: (campos.titulo ?? 'Estudiar').slice(0, 200), tipo, notas: campos.notas ?? null }),
      })
      setEstado(r.ok ? 'hecho' : 'error')
    } catch {
      setEstado('error')
    }
  }
  if (!completo) return null
  return (
    <div className={`agendar-tarjeta ${estado}`}>
      <span className="test-etq">📅 ¿Te lo apunto en el calendario?</span>
      <p className="pregunta-titulo">{campos.titulo}</p>
      {estado === 'editando' ? (
        <div className="agendar-editar">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha" />
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} aria-label="Hora" />
          <button className="boton-mini boton-principal" onClick={apuntar}>
            Apuntar
          </button>
        </div>
      ) : (
        <p className="nota agendar-cuando">{legible()}</p>
      )}
      {estado === 'propuesta' && (
        <div className="botones">
          <button className="boton boton-principal" onClick={apuntar}>
            Apuntar
          </button>
          <button className="boton" onClick={() => setEstado('editando')}>
            Otro día u hora
          </button>
          <button className="boton-mini" onClick={() => setEstado('no')}>
            Ahora no
          </button>
        </div>
      )}
      {estado === 'hecho' && (
        <p className="nota">
          ✓ Apuntado. <a href="#/calendario">Ver el calendario</a>
        </p>
      )}
      {estado === 'no' && <p className="nota">Vale, no lo apunto.</p>}
      {estado === 'error' && <p className="nota">No se pudo apuntar. Prueba desde el calendario.</p>}
    </div>
  )
}
