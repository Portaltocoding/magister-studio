import { useEffect, useRef, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import Pensando from './Pensando.tsx'
import { Reconocedor, type Reconocimiento } from './voz.ts'

// Repaso del tema (recuerdo activo adaptado a tu examen): cuentas, hablando o escribiendo, todo lo que recuerdas.
// El tutor lo ordena sin cambiarlo, te pone nota, marca cada apartado (bien, flojo, falta) y te dice qué estudiar.
// Los errores no son malos: son la brújula de lo que estudias después.

export interface CorreccionVolcado {
  ordenado: string
  nota: number
  apartados: { clave: string; titulo: string; estado: 'bien' | 'flojo' | 'falta'; comentario: string }[]
  errores: { dijo: string; correcto: string }[]
  siguiente: string
  material_id: number
}

interface Props {
  planId: number
  clave: string
  titulo: string
  // Solo estos apartados (repaso a mitad de sesión); sin él, el tema entero.
  alcance?: string[]
  alEstudiar?: (claveApartado: string) => void
  alCerrar?: () => void
}

const ESTADO = { bien: 'Bien', flojo: 'Flojo', falta: 'Te falta' }

export default function Volcado({ planId, clave, titulo, alcance, alEstudiar, alCerrar }: Props) {
  const [texto, setTexto] = useState('')
  const [parcial, setParcial] = useState('')
  const [dictando, setDictando] = useState(false)
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [r, setR] = useState<CorreccionVolcado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Reconocimiento | null>(null)

  useEffect(() => () => rec.current?.abort(), [])

  const dictar = () => {
    if (!Reconocedor) return setError('Este navegador no tiene dictado: escríbelo.')
    if (dictando) {
      rec.current?.stop()
      return
    }
    const x = new Reconocedor()
    x.lang = 'es-ES'
    x.interimResults = true
    x.continuous = true
    x.onresult = (e) => {
      let prov = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) setTexto((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${res[0].transcript.trim()}.`)
        else prov += res[0].transcript
      }
      setParcial(prov)
    }
    x.onerror = (e) => e.error !== 'no-speech' && e.error !== 'aborted' && setError(`El dictado falló (${e.error}).`)
    x.onend = () => {
      setDictando(false)
      setParcial('')
      rec.current = null
    }
    rec.current = x
    setDictando(true)
    x.start()
  }

  const corregir = async () => {
    rec.current?.stop()
    setCorrigiendo(true)
    setError(null)
    try {
      setR(await pedir<CorreccionVolcado>('/api/estudio/volcado', enviarJson({ plan_id: planId, leccion_clave: clave, texto, alcance })))
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setCorrigiendo(false)
    }
  }

  if (r)
    return (
      <section className="volcado">
        <span className="foco-etq">{alcance ? 'Lo que llevas' : 'Repaso del tema'} · {titulo}</span>
        <h1>
          {String(r.nota).replace('.', ',')} <small>de 10</small>
        </h1>
        <p className="volcado-siguiente">{r.siguiente}</p>
        <ul className="volcado-apartados">
          {r.apartados.map((a) => (
            <li key={a.clave} className={`volcado-${a.estado}`}>
              <span className="chip">{ESTADO[a.estado]}</span>
              <span>
                <strong>{a.titulo}</strong>
                {a.comentario && <small>{a.comentario}</small>}
              </span>
              {a.estado !== 'bien' && alEstudiar && (
                <button className="boton-mini" onClick={() => alEstudiar(a.clave)}>
                  Estudiarlo
                </button>
              )}
            </li>
          ))}
        </ul>
        {r.errores.length > 0 && (
          <div className="volcado-errores">
            <p>
              <strong>Lo que no era así</strong>
            </p>
            {r.errores.map((e, i) => (
              <p key={i}>
                <span className="tachado">{e.dijo}</span> → {e.correcto}
              </p>
            ))}
          </div>
        )}
        <details className="volcado-ordenado">
          <summary>Lo que dijiste, ordenado</summary>
          <p>{r.ordenado}</p>
        </details>
        <div className="botones">
          {alCerrar && (
            <button className="boton boton-principal" onClick={alCerrar}>
              {alcance ? 'Seguir estudiando' : 'Hecho'}
            </button>
          )}
        </div>
      </section>
    )

  return (
    <section className="volcado">
      <span className="foco-etq">{alcance ? 'Reexplica lo que llevas' : 'Repaso del tema'} · {titulo}</span>
      <h1>{alcance ? 'Sin mirar: ¿qué llevas?' : 'Cuéntame todo lo que recuerdas'}</h1>
      <p className="calentamiento-guia">
        {alcance
          ? 'Antes de la pausa, explícate con tus palabras lo que has estudiado en esta sesión. Lo que no te salga es lo que repasarás.'
          : 'Sin mirar nada, como si te examinaras: la estructura, las ideas y los detalles que recuerdes. Di también «aquí no me acuerdo». Tus lagunas marcan lo que estudias después.'}
      </p>
      <div className="volcado-entrada">
        <textarea
          rows={9}
          value={texto + (parcial ? ` ${parcial}` : '')}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escribe o pulsa «Dictar» y habla"
          aria-label="Lo que recuerdas"
          readOnly={dictando}
        />
      </div>
      <div className="botones">
        <button className={`boton ${dictando ? 'activo' : ''}`} onClick={dictar}>
          {dictando ? '■ Parar el dictado' : '🎙 Dictar'}
        </button>
        <button className="boton boton-principal" disabled={texto.trim().length < 10 || corrigiendo} onClick={corregir}>
          Corregir
        </button>
        {alCerrar && (
          <button className="boton-mini" onClick={alCerrar}>
            Ahora no
          </button>
        )}
      </div>
      {corrigiendo && <Pensando texto="Ordenando lo que has dicho y comparándolo con los apuntes…" />}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
