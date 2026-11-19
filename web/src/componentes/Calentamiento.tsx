import { useEffect, useState } from 'react'
import { pedir } from '../api.ts'
import Pensando from './Pensando.tsx'
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
  mapa: { clave: string; titulo: string; conceptos: { id: string; nombre: string; necesita: string[] }[] }[]
  previas: Previa[]
}

export type Apuestas = Record<string, string>

interface Priming {
  resumen: string[]
  apartados: Record<string, string>
  preguntas: string[]
}

// Tus preguntas de antes de estudiar van con las apuestas, bajo esta clave.
export const PREGUNTAS = '__preguntas'

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

export default function Calentamiento({ mid, datos, alTerminar }: { mid: number; datos: DatosCalentamiento; alTerminar: (a: Apuestas) => void }) {
  const [paso, setPaso] = useState<'mapa' | 'preguntas'>('mapa')
  const [apuestas, setApuestas] = useState<Apuestas>({})
  const [priming, setPriming] = useState<Priming | null | undefined>(undefined)
  useEffect(() => {
    pedir<Priming>(`/api/estudio/${mid}/priming`).then(setPriming).catch(() => setPriming(null))
  }, [mid])
  const hayPreguntas = datos.previas.length > 0

  if (paso === 'mapa')
    return (
      <section className="calentamiento">
        <span className="foco-etq">Calentamiento · 1 de {hayPreguntas ? 2 : 1}</span>
        <h1>El mapa de la lección</h1>
        <p className="calentamiento-guia">
          Unos 5 minutos antes de entrar en detalle: lee el tema en cinco frases y mira el esqueleto. No hace falta entenderlo
          todo; solo saber dónde irá cada cosa. Conéctalo con lo que ya sabes y apunta lo que te preguntes.
        </p>
        {priming === undefined ? (
          <Pensando texto="Preparando el tema en cinco frases…" />
        ) : (
          priming && (
            <ol className="calentamiento-resumen">
              {priming.resumen.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ol>
          )
        )}
        <ol className="calentamiento-mapa">
          {datos.mapa.map((b) => (
            <li key={b.clave}>
              <strong>{b.titulo}</strong>
              {/* Sin priming, un texto neutro: el propósito interno del bloque ya no llega (destripaba las preguntas). */}
              <small>{priming?.apartados[b.clave] || 'Un apartado de la lección.'}</small>
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
        <label className="calentamiento-dudas">
          ¿Qué te preguntas antes de empezar? (opcional)
          <textarea
            rows={2}
            value={apuestas[PREGUNTAS] ?? ''}
            onChange={(e) => setApuestas((a) => ({ ...a, [PREGUNTAS]: e.target.value }))}
            placeholder={priming?.preguntas?.join(' · ') ?? 'Lo que te intriga o no te cuadra'}
          />
        </label>
        <div className="botones">
          <button className="boton boton-principal" onClick={() => (hayPreguntas ? setPaso('preguntas') : alTerminar(apuestas))}>
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
  const dudas = apuestas[PREGUNTAS]?.trim()
  if (!con.length && !dudas) return null
  const acertadas = con.filter((q) => q.buena && apuestas[q.pregunta_id] === q.buena).length
  const tests = con.filter((q) => q.buena).length
  return (
    <div className="apuestas">
      {dudas && (
        <p>
          <strong>Lo que te preguntabas antes:</strong> {dudas} <span className="nota">¿Resuelto? Si no, llévalo al chat o a una llamada.</span>
        </p>
      )}
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
