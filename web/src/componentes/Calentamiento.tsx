import { useState } from 'react'
import { barajar } from '../barajar.ts'

// Calentamiento (priming): unos minutos antes de estudiar una lección.
// 1. El mapa: los apartados, sus conceptos y de qué depende cada uno, para tener el esqueleto antes de los detalles.
// 2. Tres preguntas a ojo: intentar responder antes de estudiar hace que lo aprendas mejor después, aunque falles
//    (efecto pretest). No cuentan para el repaso y la solución llega al cerrar la sesión.

export interface Previa {
  pregunta_id: string
  enunciado: string
  opciones: string[] | null
  buena: string | null
  respuesta: string
}

export interface DatosCalentamiento {
  mapa: { clave: string; titulo: string; proposito: string; conceptos: { id: string; nombre: string; necesita: string[] }[] }[]
  previas: Previa[]
}

export type Apuestas = Record<string, string>

const CLAVE = (mid: number) => `magister-calentamiento-${mid}`

export function leerCalentamiento(mid: number): { hecho: boolean; apuestas: Apuestas } | null {
  try {
    const v = localStorage.getItem(CLAVE(mid))
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}

export function guardarCalentamiento(mid: number, apuestas: Apuestas) {
  try {
    localStorage.setItem(CLAVE(mid), JSON.stringify({ hecho: true, apuestas }))
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
}

export default function Calentamiento({ datos, alTerminar }: { datos: DatosCalentamiento; alTerminar: (a: Apuestas) => void }) {
  const [paso, setPaso] = useState<'mapa' | 'preguntas'>('mapa')
  const [apuestas, setApuestas] = useState<Apuestas>({})
  const hayPreguntas = datos.previas.length > 0

  if (paso === 'mapa')
    return (
      <section className="calentamiento">
        <span className="foco-etq">Calentamiento · 1 de {hayPreguntas ? 2 : 1}</span>
        <h1>El mapa de la lección</h1>
        <p className="calentamiento-guia">
          Antes de entrar en detalle, mira el esqueleto: qué apartados hay y qué conceptos cuelgan de cada uno. No hace falta
          entenderlo todo; solo saber dónde irá cada cosa. ¿Qué crees que conecta con qué?
        </p>
        <ol className="calentamiento-mapa">
          {datos.mapa.map((b) => (
            <li key={b.clave}>
              <strong>{b.titulo}</strong>
              {b.proposito && <small>{b.proposito}</small>}
              <div className="calentamiento-conceptos">
                {b.conceptos.map((c) => (
                  <span key={c.id} className="chip" title={c.necesita.length ? `Se apoya en: ${c.necesita.join(', ')}` : undefined}>
                    {c.nombre}
                    {c.necesita.length > 0 && <em> ← {c.necesita.join(', ')}</em>}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <div className="botones">
          <button className="boton boton-principal" onClick={() => (hayPreguntas ? setPaso('preguntas') : alTerminar({}))}>
            {hayPreguntas ? 'Siguiente: tres preguntas a ojo' : 'Empezar la lección'}
          </button>
        </div>
      </section>
    )

  return (
    <section className="calentamiento">
      <span className="foco-etq">Calentamiento · 2 de 2</span>
      <h1>Tres preguntas a ojo</h1>
      <p className="calentamiento-guia">
        Contesta antes de estudiar, aunque no tengas ni idea: intentarlo hace que luego lo aprendas mejor. No cuenta para nada y
        las soluciones te las enseño al cerrar la sesión.
      </p>
      {datos.previas.map((q, k) => (
        <div key={q.pregunta_id} className="calentamiento-pregunta">
          <p>
            <b>{k + 1}.</b> {q.enunciado}
          </p>
          {q.opciones ? (
            <div className="test-opciones">
              {barajar(q.opciones, q.pregunta_id).map((o, j) => (
                <button
                  key={o}
                  type="button"
                  className={`test-opcion ${apuestas[q.pregunta_id] === o ? 'elegida' : ''}`}
                  aria-pressed={apuestas[q.pregunta_id] === o}
                  onClick={() => setApuestas((a) => ({ ...a, [q.pregunta_id]: o }))}
                >
                  <span className="test-letra">{String.fromCharCode(65 + j)}</span>
                  <span>{o}</span>
                </button>
              ))}
            </div>
          ) : (
            <textarea
              rows={2}
              placeholder="Tu intuición, en una frase"
              value={apuestas[q.pregunta_id] ?? ''}
              onChange={(e) => setApuestas((a) => ({ ...a, [q.pregunta_id]: e.target.value }))}
              aria-label={`Tu intuición para la pregunta ${k + 1}`}
            />
          )}
        </div>
      ))}
      <div className="botones">
        <button className="boton boton-principal" onClick={() => alTerminar(apuestas)}>
          Empezar la lección
        </button>
      </div>
    </section>
  )
}

// Al cerrar: tus apuestas de antes frente a la respuesta.
export function ApuestasRevisadas({ previas, apuestas }: { previas: Previa[]; apuestas: Apuestas }) {
  const con = previas.filter((q) => apuestas[q.pregunta_id])
  if (!con.length) return null
  const acertadas = con.filter((q) => q.buena && apuestas[q.pregunta_id] === q.buena).length
  const tests = con.filter((q) => q.buena).length
  return (
    <div className="apuestas">
      <p>
        <strong>Tus apuestas del calentamiento</strong>
        {tests > 0 && ` · antes de estudiar acertaste ${acertadas} de ${tests}`}
      </p>
      {con.map((q) => {
        const tuya = apuestas[q.pregunta_id]
        const bien = q.buena ? tuya === q.buena : null
        return (
          <details key={q.pregunta_id} className={bien === true ? 'bien' : bien === false ? 'mal' : ''}>
            <summary>
              {bien === true ? '✓' : bien === false ? '✗' : '·'} {q.enunciado}
            </summary>
            <p className="nota">Dijiste: {tuya}</p>
            {q.buena && <p>La buena: {q.buena}</p>}
            <p className="nota">{q.respuesta}</p>
          </details>
        )
      })}
    </div>
  )
}
