import { useState, type KeyboardEvent } from 'react'

export interface Opcion {
  valor: string
  etiqueta: string
  desc?: string
}

export interface Pregunta {
  id: string
  titulo: string
  ayuda?: string
  tipo: 'texto' | 'una' | 'varias' | 'fecha'
  opciones?: Opcion[]
  opcional?: boolean
  porDefecto?: string | string[]
  placeholder?: string
  // Una opción «Otro» que deja escribir (solo en tipo «una»).
  otro?: boolean
  // Opciones y ayuda que dependen de lo ya respondido (las horas según la fecha y la profundidad).
  opcionesSegun?: (r: Respuestas) => Opcion[]
  ayudaSegun?: (r: Respuestas) => string | undefined
}

export type Respuestas = Record<string, string | string[]>

interface Props {
  titulo: string
  preguntas: Pregunta[]
  boton: string
  alTerminar: (r: Respuestas) => void
  alSaltar?: () => void
  textoSaltar?: string
}

// Unas pocas preguntas antes de crear algo, de una en una: pulsas una opción y avanza.
export default function Cuestionario({ titulo, preguntas, boton, alTerminar, alSaltar, textoSaltar }: Props) {
  const [paso, setPaso] = useState(0)
  const [r, setR] = useState<Respuestas>(() =>
    Object.fromEntries(preguntas.filter((p) => p.porDefecto !== undefined).map((p) => [p.id, p.porDefecto!])),
  )
  const [otro, setOtro] = useState<Record<string, string>>({})
  const resumen = paso >= preguntas.length
  const p = preguntas[paso]

  const valor = (id: string) => r[id]
  const opcionesDe = (q: Pregunta) => (q.opcionesSegun ? q.opcionesSegun(r) : q.opciones) ?? []
  const lista = (id: string) => (Array.isArray(r[id]) ? (r[id] as string[]) : [])
  const valida = (q: Pregunta) => {
    const v = r[q.id]
    if (q.opcional) return true
    if (Array.isArray(v)) return v.length > 0
    if (v === '__otro') return !!otro[q.id]?.trim()
    return !!v && String(v).trim().length > 0
  }
  const siguiente = () => p && valida(p) && setPaso(paso + 1)
  const elegir = (q: Pregunta, v: string) => {
    setR({ ...r, [q.id]: v })
    if (v !== '__otro') setTimeout(() => setPaso((x) => x + 1), 160)
  }
  const alternar = (q: Pregunta, v: string) => {
    const l = lista(q.id)
    setR({ ...r, [q.id]: l.includes(v) ? l.filter((x) => x !== v) : [...l, v] })
  }
  const enter = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      siguiente()
    }
  }
  const final = (): Respuestas =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === '__otro' ? otro[k] ?? '' : v]))
  const legible = (q: Pregunta) => {
    const v = r[q.id]
    if (v === undefined || v === '') return '·'
    if (v === '__otro') return otro[q.id]
    const nombre = (x: string) => opcionesDe(q).find((o) => o.valor === x)?.etiqueta ?? x
    return Array.isArray(v) ? v.map(nombre).join(', ') : nombre(v)
  }

  return (
    <section className="cuestionario" aria-label={titulo}>
      <div className="cuestionario-cabecera">
        <span className="nota">{titulo}</span>
        <span className="puntos-paso" aria-label={`Paso ${Math.min(paso + 1, preguntas.length + 1)} de ${preguntas.length + 1}`}>
          {[...preguntas, null].map((_, i) => (
            <span key={i} className={i < paso ? 'punto hecho' : i === paso ? 'punto actual' : 'punto'} />
          ))}
        </span>
      </div>

      {!resumen && p && (
        <div className="cuestionario-pregunta" key={p.id}>
          <h2>{p.titulo}</h2>
          {(p.ayudaSegun?.(r) ?? p.ayuda) && <p className="nota cuestionario-ayuda">{p.ayudaSegun?.(r) ?? p.ayuda}</p>}
          {p.tipo === 'texto' && (
            <textarea autoFocus className="critica" placeholder={p.placeholder} value={(valor(p.id) as string) ?? ''}
              onChange={(e) => setR({ ...r, [p.id]: e.target.value })} onKeyDown={enter} />
          )}
          {p.tipo === 'fecha' && (
            <div className="opciones">
              <input type="date" className="campo-fecha" value={(valor(p.id) as string) ?? ''}
                onChange={(e) => setR({ ...r, [p.id]: e.target.value })} />
              {opcionesDe(p).map((o) => (
                <button key={o.valor} className={`opcion ${valor(p.id) === o.valor ? 'elegida' : ''}`} onClick={() => elegir(p, o.valor)}>
                  {o.etiqueta}
                </button>
              ))}
            </div>
          )}
          {(p.tipo === 'una' || p.tipo === 'varias') && (
            <div className="opciones">
              {opcionesDe(p).map((o) => {
                const elegida = p.tipo === 'una' ? valor(p.id) === o.valor : lista(p.id).includes(o.valor)
                return (
                  <button key={o.valor} className={`opcion ${elegida ? 'elegida' : ''}`} aria-pressed={elegida}
                    onClick={() => (p.tipo === 'una' ? elegir(p, o.valor) : alternar(p, o.valor))}>
                    <strong>{o.etiqueta}</strong>
                    {o.desc && <small>{o.desc}</small>}
                  </button>
                )
              })}
              {p.otro && (
                <button className={`opcion ${valor(p.id) === '__otro' ? 'elegida' : ''}`} onClick={() => elegir(p, '__otro')}>
                  <strong>Otro</strong>
                </button>
              )}
            </div>
          )}
          {valor(p.id) === '__otro' && (
            <input autoFocus className="campo-otro" placeholder="Cuéntalo con tus palabras" value={otro[p.id] ?? ''}
              onChange={(e) => setOtro({ ...otro, [p.id]: e.target.value })} onKeyDown={enter} />
          )}
          <div className="botones">
            {paso > 0 && (
              <button className="boton" onClick={() => setPaso(paso - 1)}>
                Atrás
              </button>
            )}
            {(p.tipo !== 'una' || valor(p.id) === '__otro') && (
              <button className="boton boton-principal" disabled={!valida(p)} onClick={siguiente}>
                {p.opcional && !valor(p.id) ? 'Saltar' : 'Siguiente'}
              </button>
            )}
            {alSaltar && paso === 0 && (
              <button className="boton-mini" onClick={alSaltar}>
                {textoSaltar ?? 'Prefiero contarlo yo'}
              </button>
            )}
          </div>
        </div>
      )}

      {resumen && (
        <div className="cuestionario-pregunta">
          <h2>¿Así?</h2>
          <dl className="resumen-respuestas">
            {preguntas.map((q, i) => (
              <div key={q.id}>
                <dt>{q.titulo}</dt>
                <dd>
                  {legible(q)}{' '}
                  <button className="boton-mini" onClick={() => setPaso(i)}>
                    Cambiar
                  </button>
                </dd>
              </div>
            ))}
          </dl>
          <div className="botones">
            <button className="boton" onClick={() => setPaso(paso - 1)}>
              Atrás
            </button>
            <button className="boton boton-principal" onClick={() => alTerminar(final())}>
              {boton}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
