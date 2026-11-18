import { useCallback, useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import { enviarJson, pedir } from '../api.ts'
import Cargando, { mensajeDe } from '../componentes/Cargando.tsx'
import Vacio from '../componentes/Vacio.tsx'
import '../triaje.css'

// Triaje: las respuestas que valoraste mal o que suspendió el juez. Una cada vez, para leerla con calma y decidir:
// al banco de pruebas (con tu feedback) o descartarla. Atajos: A al banco, D descartar, S o → saltar, ← volver, U deshacer.

interface MotivoJuez {
  dimension: string | null
  nombre: string
  razon: string
}

interface Candidato {
  id: number
  traza_id: string
  origen: 'feedback' | 'juez' | 'otra_explicacion' | 'aleatorio'
  creado: string
  pregunta: string | null
  respuesta: string | null
  nota: string | null
  motivos_juez: MotivoJuez[]
}

interface Feedback {
  banco: string
  motivos: string[]
  comentario: string
  respuestaBuena: string
  juezAcerto: boolean | null
}

const BANCOS: { id: string; nombre: string; ayuda: string }[] = [
  { id: 'tono', nombre: 'Tono', ayuda: 'Cómo explica: claridad, ir al grano, el trato' },
  { id: 'corrector', nombre: 'Corrector', ayuda: 'Cómo corrige tus respuestas' },
  { id: 'rag', nombre: 'Fuentes', ayuda: 'Lo que busca y cita de tus fuentes' },
  { id: 'plan', nombre: 'Plan', ayuda: 'Cómo arma los planes y las lecciones' },
]

const ORIGENES: Record<Candidato['origen'], string> = {
  feedback: 'Le diste pulgar abajo',
  otra_explicacion: 'Pediste otra explicación',
  juez: 'El juez la suspendió',
  aleatorio: 'Muestra al azar',
}

type Filtro = 'todos' | 'juez' | 'tuyos'
const esTuyo = (c: Candidato) => c.origen === 'feedback' || c.origen === 'otra_explicacion'
const vacio = (): Feedback => ({ banco: 'tono', motivos: [], comentario: '', respuestaBuena: '', juezAcerto: null })
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function PanelTriaje() {
  const [lista, setLista] = useState<Candidato[] | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [motivosPosibles, setMotivosPosibles] = useState<{ id: string; nombre: string }[]>([])
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [pos, setPos] = useState(0)
  const [fb, setFb] = useState<Record<number, Feedback>>({})
  const [entera, setEntera] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [hechos, setHechos] = useState(0)
  const [aviso, setAviso] = useState<{ id: number; texto: string } | null>(null)

  const cargar = useCallback(() => {
    setFallo(null)
    pedir<Candidato[]>('/api/candidatos')
      .then(setLista)
      .catch((e) => setFallo(`No he podido cargar los candidatos: ${mensajeDe(e)}`))
  }, [])
  useEffect(cargar, [cargar])
  useEffect(() => {
    pedir<{ motivos?: { id: string; nombre: string }[] }>('/api/afinado')
      .then((a) => setMotivosPosibles(a.motivos ?? []))
      .catch(() => undefined)
  }, [])

  const visibles = useMemo(
    () => (lista ?? []).filter((c) => filtro === 'todos' || (filtro === 'juez' ? c.origen === 'juez' : esTuyo(c))),
    [lista, filtro],
  )
  const i = Math.min(pos, Math.max(0, visibles.length - 1))
  const c = visibles[i] as Candidato | undefined
  const f = (c && fb[c.id]) || vacio()
  const cambiar = (cambio: Partial<Feedback>) => c && setFb((x) => ({ ...x, [c.id]: { ...f, ...cambio } }))

  const ir = useCallback((d: number) => {
    setEntera(false)
    setPos((p) => Math.max(0, Math.min(p + d, visibles.length - 1)))
  }, [visibles.length])

  const decidir = useCallback(
    async (accion: 'aceptar' | 'descartar') => {
      if (!c || guardando) return
      setGuardando(true)
      try {
        await pedir(
          `/api/candidatos/${c.id}`,
          enviarJson({
            accion,
            banco: accion === 'aceptar' ? f.banco : null,
            respuesta_buena: f.respuestaBuena.trim() || null,
            comentario: f.comentario.trim() || null,
            motivos: f.motivos,
            juez_acerto: c.origen === 'juez' ? f.juezAcerto : null,
          }),
        )
        const banco = BANCOS.find((b) => b.id === f.banco)?.nombre ?? f.banco
        setAviso({ id: c.id, texto: accion === 'aceptar' ? `Guardada en el banco de ${banco}.` : 'Descartada.' })
        setHechos((n) => n + 1)
        setEntera(false)
        setLista((l) => (l ? l.filter((x) => x.id !== c.id) : l))
      } catch (e) {
        setFallo(`No he podido guardarlo: ${mensajeDe(e)}`)
      } finally {
        setGuardando(false)
      }
    },
    [c, f, guardando],
  )

  const deshacer = useCallback(async () => {
    if (!aviso) return
    try {
      await pedir(`/api/candidatos/${aviso.id}/deshacer`, enviarJson({}))
      setAviso(null)
      setHechos((n) => Math.max(0, n - 1))
      const nueva = await pedir<Candidato[]>('/api/candidatos')
      setLista(nueva)
      setFiltro('todos')
      setPos(Math.max(0, nueva.findIndex((x) => x.id === aviso.id)))
    } catch (e) {
      setFallo(`No he podido deshacerlo: ${mensajeDe(e)}`)
    }
  }, [aviso])

  // Atajos de teclado (no mientras escribes en un campo).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'a') void decidir('aceptar')
      else if (k === 'd') void decidir('descartar')
      else if (k === 's' || e.key === 'ArrowRight') ir(1)
      else if (e.key === 'ArrowLeft') ir(-1)
      else if (k === 'u') void deshacer()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [decidir, deshacer, ir])

  // El aviso de lo último que hiciste se va solo a los 8 s.
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 8000)
    return () => clearTimeout(t)
  }, [aviso])

  if (!lista) return <div className="panel"><Cargando error={fallo} reintentar={cargar} /></div>

  const total = lista.length
  const nJuez = lista.filter((x) => x.origen === 'juez').length
  const nTuyos = lista.filter(esTuyo).length
  const larga = (c?.respuesta?.length ?? 0) > 1400

  return (
    <div className="panel triaje">
      <header className="triaje-cabeza">
        <div>
          <h1>Triaje</h1>
          <p className="nota">Respuestas que no salieron bien. Léelas, dime qué falló y decide: al banco de pruebas, para que no vuelva a pasar, o descartarla.</p>
        </div>
        <div className="triaje-cuenta" aria-live="polite">
          <strong>{total}</strong>
          <span>pendientes{hechos ? ` · ${hechos} hoy` : ''}</span>
        </div>
      </header>

      <nav className="triaje-filtros" aria-label="Filtrar">
        {([['todos', `Todas (${total})`], ['tuyos', `Tus valoraciones (${nTuyos})`], ['juez', `Del juez (${nJuez})`]] as [Filtro, string][]).map(([id, texto]) => (
          <button key={id} type="button" className={`opcion opcion-chip ${filtro === id ? 'elegida' : ''}`} aria-pressed={filtro === id} onClick={() => { setFiltro(id); setPos(0); setEntera(false) }}>
            {texto}
          </button>
        ))}
      </nav>

      {fallo && (
        <p className="nota triaje-fallo" role="alert">
          {fallo}{' '}
          <button type="button" className="boton-mini" onClick={() => { setFallo(null); cargar() }}>
            Reintentar
          </button>
        </p>
      )}

      {aviso && (
        <div className="triaje-aviso" role="status">
          <span>{aviso.texto}</span>
          <button type="button" className="boton-mini" onClick={() => void deshacer()}>
            Deshacer <kbd>U</kbd>
          </button>
        </div>
      )}

      {!c ? (
        <Vacio
          etiqueta="Triaje"
          titulo={total ? 'Nada con este filtro' : 'Todo revisado'}
          texto={total ? 'Prueba con «Todas».' : 'No queda ninguna respuesta por revisar. Cuando valores una con el pulgar abajo o el juez suspenda alguna, aparecerá aquí.'}
        />
      ) : (
        <article key={c.id} className="triaje-tarjeta">
          <div className="triaje-meta">
            <span className={`triaje-origen origen-${c.origen}`}>{ORIGENES[c.origen]}</span>
            <small>{fecha(c.creado)}</small>
            <div className="triaje-nav">
              <button type="button" className="boton-mini" onClick={() => ir(-1)} disabled={i === 0} aria-label="Anterior">
                ←
              </button>
              <small>
                {i + 1} de {visibles.length}
              </small>
              <button type="button" className="boton-mini" onClick={() => ir(1)} disabled={i >= visibles.length - 1} aria-label="Siguiente">
                →
              </button>
            </div>
          </div>

          <section className="triaje-porque">
            <h2>Por qué está aquí</h2>
            {c.motivos_juez.length ? (
              <ul>
                {c.motivos_juez.map((m, k) => (
                  <li key={k}>
                    <span className="triaje-dimension">{m.nombre}</span>
                    <p>{m.razon}</p>
                  </li>
                ))}
              </ul>
            ) : c.nota ? (
              <blockquote>«{c.nota}»</blockquote>
            ) : (
              <p className="nota">Sin comentario.</p>
            )}
          </section>

          {c.pregunta && (
            <section className="triaje-pregunta">
              <h2>Lo que preguntaste</h2>
              <p>{c.pregunta}</p>
            </section>
          )}

          <section className="triaje-respuesta">
            <h2>Lo que respondió</h2>
            {c.respuesta ? (
              <>
                <div className={`triaje-texto ${larga && !entera ? 'recortada' : ''}`}>
                  <Markdown>{c.respuesta}</Markdown>
                </div>
                {larga && (
                  <button type="button" className="boton-mini" onClick={() => setEntera(!entera)}>
                    {entera ? 'Ver menos' : 'Ver entera'}
                  </button>
                )}
              </>
            ) : (
              <p className="nota">No he encontrado la respuesta en el hilo (quizá borraste la conversación).</p>
            )}
          </section>

          <section className="triaje-feedback">
            <h2>Tu feedback</h2>
            {c.origen === 'juez' && (
              <div className="triaje-fila">
                <span>¿Acertó el juez?</span>
                <div className="afinar-segmentos triaje-segmentos" role="radiogroup" aria-label="¿Acertó el juez?">
                  <button type="button" role="radio" aria-checked={f.juezAcerto === true} onClick={() => cambiar({ juezAcerto: f.juezAcerto === true ? null : true })}>
                    Sí, estaba mal
                  </button>
                  <button type="button" role="radio" aria-checked={f.juezAcerto === false} onClick={() => cambiar({ juezAcerto: f.juezAcerto === false ? null : false })}>
                    No, estaba bien
                  </button>
                </div>
              </div>
            )}
            {motivosPosibles.length > 0 && f.juezAcerto !== false && (
              <div className="triaje-fila">
                <span>Qué falló</span>
                <div className="triaje-motivos">
                  {motivosPosibles.map((m) => {
                    const si = f.motivos.includes(m.id)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={si}
                        className={`opcion opcion-chip ${si ? 'elegida' : ''}`}
                        onClick={() => cambiar({ motivos: si ? f.motivos.filter((x) => x !== m.id) : [...f.motivos, m.id] })}
                      >
                        {m.nombre}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <label className="triaje-fila">
              <span>Comentario</span>
              <input id={`triaje-comentario-${c.id}`} value={f.comentario} onChange={(e) => cambiar({ comentario: e.target.value })} placeholder="Lo que quieras añadir (opcional)" />
            </label>
            <details className="triaje-buena">
              <summary>Escribir cómo debería haber sido</summary>
              <textarea
                id={`triaje-buena-${c.id}`}
                value={f.respuestaBuena}
                onChange={(e) => cambiar({ respuestaBuena: e.target.value })}
                placeholder="La respuesta buena: sirve de referencia en el banco"
              />
            </details>
          </section>

          <footer className="triaje-decidir">
            <div className="triaje-fila">
              <span>Banco</span>
              <div className="triaje-bancos" role="radiogroup" aria-label="Banco de pruebas">
                {BANCOS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={f.banco === b.id}
                    className={`opcion opcion-chip ${f.banco === b.id ? 'elegida' : ''}`}
                    title={b.ayuda}
                    onClick={() => cambiar({ banco: b.id })}
                  >
                    {b.nombre}
                  </button>
                ))}
              </div>
            </div>
            <div className="triaje-botones">
              <button type="button" className="boton boton-principal" disabled={guardando} onClick={() => void decidir('aceptar')}>
                Al banco <kbd>A</kbd>
              </button>
              <button type="button" className="boton" disabled={guardando} onClick={() => void decidir('descartar')}>
                Descartar <kbd>D</kbd>
              </button>
              <button type="button" className="boton boton-suave" onClick={() => ir(1)} disabled={i >= visibles.length - 1}>
                Saltar <kbd>S</kbd>
              </button>
            </div>
            {c.origen === 'juez' && f.juezAcerto === false && <p className="nota">Si estaba bien, lo normal es descartarla: así el juez aprende a ser menos estricto.</p>}
          </footer>
        </article>
      )}
    </div>
  )
}
