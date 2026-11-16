import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { flujo, marcarSesion, pedir } from '../api.ts'
import { TextoLibro } from '../componentes/LectorLibro.tsx'
import Vacio, { irARuta } from '../componentes/Vacio.tsx'
import Mascota from '../Mascota.tsx'
import type { IdModo } from '../modos.ts'

interface Hoy {
  estado: 'propuesta' | 'adelantar' | 'sin_preparar' | 'sin_plan' | 'solo_repaso'
  sesion_id?: number
  plan_id?: number
  tema_id?: number
  tema?: string
  leccion_clave?: string
  titulo?: string
  horas?: number
  material_id?: number | null
  repasos: number
  razon?: string
}

interface Bloque {
  clave: string
  titulo: string
  texto: string
  pregunta: { pregunta_id: string; enunciado: string; concepto_id: string } | null
}

interface Definicion {
  termino: string
  ingles: string
  definicion: string
}

interface Leccion {
  bloques: Bloque[]
  definiciones: Definicion[]
}

// Lo que llevas de una lección, para seguir donde lo dejaste.
interface Avance {
  i: number
  comprobado: Record<string, string>
  segundos: number
}

const CONFIANZAS: [number, string][] = [
  [0.25, 'No lo sé'],
  [0.5, 'Dudo'],
  [0.75, 'Bastante seguro'],
  [0.95, 'Seguro'],
]

const POMODORO = 25 * 60
const DESCANSO = 5 * 60

const clave = (mid: number) => `magister-foco-${mid}`
function leerAvance(mid: number): Avance | null {
  try {
    const t = localStorage.getItem(clave(mid))
    return t ? (JSON.parse(t) as Avance) : null
  } catch {
    return null
  }
}
function guardarAvance(mid: number, a: Avance | null) {
  try {
    if (a) localStorage.setItem(clave(mid), JSON.stringify(a))
    else localStorage.removeItem(clave(mid))
  } catch {
    /* sin almacenamiento: se empieza de cero */
  }
}

const reloj = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const NOTA: Record<string, string> = { perfecta: 'Perfecta', bien: 'Bien', parcial: 'A medias', fallo: 'Fallada', saltada: 'Saltada' }

// Una comprobación al final de cada idea: respondes de memoria y el tutor corrige.
function Comprobar({ pregunta, alAcabar }: { pregunta: NonNullable<Bloque['pregunta']>; alAcabar: (nota: string) => void }) {
  const [respuesta, setRespuesta] = useState('')
  const [confianza, setConfianza] = useState<number | null>(null)
  const [nota, setNota] = useState<string | null>(null)
  const [explicacion, setExplicacion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [inicio] = useState(() => Date.now())

  useEffect(() => {
    pedir(`/api/tutor/servir/${pregunta.pregunta_id}`, { method: 'POST' })
  }, [pregunta.pregunta_id])

  const enviar = async () => {
    setEnviando(true)
    let final = 'fallo'
    for await (const ev of flujo<{ tipo: string; nota?: string; t?: string }>('/api/practica/intentos', {
      pregunta_id: pregunta.pregunta_id,
      concepto_id: pregunta.concepto_id,
      respuesta,
      confianza,
      clave: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      latencia_ms: Date.now() - inicio,
    })) {
      if (ev.tipo === 'nota' && ev.nota) {
        setNota(ev.nota)
        final = ev.nota
      } else if (ev.tipo === 'delta' && ev.t) setExplicacion((x) => x + ev.t)
    }
    setEnviando(false)
    alAcabar(final)
  }

  return (
    <div className="foco-comprobar">
      <span className="foco-etq">Comprueba que lo tienes</span>
      <div className="foco-pregunta">
        <Markdown>{pregunta.enunciado}</Markdown>
      </div>
      <textarea
        value={respuesta}
        disabled={!!nota || enviando}
        onChange={(e) => setRespuesta(e.target.value)}
        placeholder="Con tus palabras, sin mirar arriba"
        aria-label="Tu respuesta"
      />
      {!nota && (
        <div className="foco-confianza">
          <span>¿Cómo de seguro estás?</span>
          {CONFIANZAS.map(([v, t]) => (
            <button key={v} className="opcion opcion-chip" aria-pressed={confianza === v} data-elegida={confianza === v} onClick={() => setConfianza(v)}>
              {t}
            </button>
          ))}
          <button className="boton boton-principal" disabled={enviando || !respuesta.trim() || confianza == null} onClick={enviar}>
            {enviando ? 'Corrigiendo…' : 'Comprobar'}
          </button>
        </div>
      )}
      {(nota || explicacion) && (
        <div className={`correccion nota-${nota ?? ''}`}>
          {nota && <strong>{NOTA[nota] ?? nota}</strong>}
          <Markdown>{explicacion}</Markdown>
        </div>
      )}
    </div>
  )
}

interface PropsFoco {
  hoy: Hoy
  leccion: Leccion
  inicial: Avance | null
  alSalir: () => void
  irA: (m: IdModo) => void
}

// Modo foco: la lección a pantalla completa, sin menús, una idea cada vez.
function Foco({ hoy, leccion, inicial, alSalir, irA }: PropsFoco) {
  const { bloques } = leccion
  const mid = hoy.material_id ?? 0
  const [i, setI] = useState(inicial?.i ?? 0)
  const [comprobado, setComprobado] = useState<Record<string, string>>(inicial?.comprobado ?? {})
  const [segundos, setSegundos] = useState(inicial?.segundos ?? 0)
  const [pausado, setPausado] = useState(false)
  const [descanso, setDescanso] = useState<number | null>(null)
  const [avisoPausa, setAvisoPausa] = useState(false)
  const [glosario, setGlosario] = useState(false)
  // Lupa: el párrafo bajo el ratón se acerca y el resto se atenúa.
  const [lupa, setLupa] = useState(() => {
    try {
      return localStorage.getItem('magister-lupa') !== 'no'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('magister-lupa', lupa ? 'si' : 'no')
    } catch {
      /* sin almacenamiento: vale para esta sesión */
    }
  }, [lupa])
  const [cerrada, setCerrada] = useState(false)
  const [pantalla, setPantalla] = useState(!!document.fullscreenElement)

  const b = bloques[i]
  const ultimo = i === bloques.length - 1
  const puedeSeguir = !b.pregunta || !!comprobado[b.clave]

  // Reloj: solo cuenta con la pestaña a la vista, sin pausa y sin descanso.
  useEffect(() => {
    if (pausado || descanso != null || cerrada) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setSegundos((s) => s + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [pausado, descanso, cerrada])

  useEffect(() => {
    if (segundos > 0 && segundos % POMODORO === 0) setAvisoPausa(true)
  }, [segundos])

  useEffect(() => {
    if (descanso == null) return
    if (descanso <= 0) {
      setDescanso(null)
      return
    }
    const t = setTimeout(() => setDescanso((d) => (d == null ? null : d - 1)), 1000)
    return () => clearTimeout(t)
  }, [descanso])

  useEffect(() => {
    if (!cerrada) guardarAvance(mid, { i, comprobado, segundos })
  }, [mid, i, comprobado, segundos, cerrada])

  useEffect(() => {
    const cambio = () => setPantalla(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', cambio)
    document.body.classList.add('en-foco')
    return () => {
      document.removeEventListener('fullscreenchange', cambio)
      document.body.classList.remove('en-foco')
    }
  }, [])

  useEffect(() => {
    document.querySelector('.foco-cuerpo')?.scrollTo({ top: 0 })
  }, [i, cerrada])

  const salir = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    alSalir()
  }, [alSalir])

  const ir = useCallback(
    (d: number) => {
      if (d > 0 && (!puedeSeguir || ultimo)) return
      setI((x) => Math.max(0, Math.min(bloques.length - 1, x + d)))
    },
    [puedeSeguir, ultimo, bloques.length],
  )

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const escribiendo = (e.target as HTMLElement).closest('textarea, input')
      if (e.key === 'Escape') {
        if (escribiendo) (escribiendo as HTMLElement).blur()
        else if (glosario) setGlosario(false)
        else if (!document.fullscreenElement) salir()
        return
      }
      if (escribiendo || cerrada || descanso != null) return
      if (e.key === 'ArrowRight') ir(1)
      else if (e.key === 'ArrowLeft') ir(-1)
      else if (e.key === 'g') setGlosario((g) => !g)
      else if (e.key === 'l') setLupa((x) => !x)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ir, salir, glosario, cerrada, descanso])

  const cerrar = async () => {
    if (hoy.sesion_id) await marcarSesion(hoy.sesion_id, 'hecha')
    guardarAvance(mid, null)
    setCerrada(true)
  }

  const pantallaCompleta = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    else document.documentElement.requestFullscreen?.().catch(() => undefined)
  }

  const notas = Object.values(comprobado)
  const flojas = Object.entries(comprobado).filter(([, n]) => ['fallo', 'parcial', 'saltada'].includes(n))
  const previsto = (hoy.horas ?? 0) * 3600

  return (
    <div className={`foco ${lupa ? 'lupa' : ''}`} role="dialog" aria-modal="true" aria-label={`Modo foco: ${hoy.titulo}`}>
      <header className="foco-barra">
        <div className="foco-titulo">
          <span className="bloques-clave">{hoy.leccion_clave}</span>
          <span className="recorte">{hoy.titulo}</span>
        </div>
        <ol className="foco-pasos" aria-label="Ideas de la lección">
          {bloques.map((x, k) => (
            <li key={x.clave}>
              <button
                className={`foco-paso ${k === i && !cerrada ? 'actual' : ''} ${comprobado[x.clave] ? `nota-${comprobado[x.clave]}` : k < i || cerrada ? 'vista' : ''}`}
                title={`${k + 1}. ${x.titulo}`}
                aria-label={`Idea ${k + 1}: ${x.titulo}`}
                disabled={cerrada || (k > i && !bloques.slice(i, k).every((y) => !y.pregunta || comprobado[y.clave]))}
                onClick={() => setI(k)}
              />
            </li>
          ))}
        </ol>
        <div className="foco-herramientas">
          <button
            className={`foco-reloj ${pausado ? 'pausado' : ''}`}
            onClick={() => setPausado(!pausado)}
            title={pausado ? 'Seguir' : 'Pausar el reloj'}
          >
            {pausado ? '▶' : '❚❚'} {reloj(segundos)}
            {previsto > 0 && <small> / {reloj(previsto)}</small>}
          </button>
          <button className="foco-boton" aria-pressed={lupa} onClick={() => setLupa(!lupa)} title="Acercar el párrafo bajo el ratón (L)">
            Lupa
          </button>
          {leccion.definiciones.length > 0 && (
            <button className="foco-boton" aria-pressed={glosario} onClick={() => setGlosario(!glosario)} title="Términos (G)">
              Términos
            </button>
          )}
          <button className="foco-boton" onClick={pantallaCompleta} title="Pantalla completa">
            {pantalla ? 'Ventana' : 'Pantalla completa'}
          </button>
          <button className="foco-boton foco-salir" onClick={salir} title="Salir (Esc)">
            Salir
          </button>
        </div>
      </header>

      {avisoPausa && descanso == null && !cerrada && (
        <div className="foco-aviso" role="status">
          Llevas {Math.round(segundos / 60)} minutos concentrado. Una pausa corta ahora hace que lo siguiente entre mejor.
          <button className="boton boton-principal" onClick={() => { setAvisoPausa(false); setDescanso(DESCANSO) }}>
            Pausa de 5 min
          </button>
          <button className="boton" onClick={() => setAvisoPausa(false)}>
            Sigo
          </button>
        </div>
      )}

      <div className="foco-cuerpo">
        {descanso != null ? (
          <section className="foco-descanso">
            <span className="foco-etq">Descanso</span>
            <strong>{reloj(descanso)}</strong>
            <p>Levántate, mira lejos, bebe agua. Nada de pantallas: el cerebro ordena lo que acabas de leer mientras no haces nada.</p>
            <button className="boton" onClick={() => setDescanso(null)}>
              Volver ya
            </button>
          </section>
        ) : cerrada ? (
          <section className="foco-cierre">
            <span className="foco-etq">Sesión hecha</span>
            <h1>{hoy.titulo}</h1>
            <div className="foco-cifras">
              <div>
                <strong>{reloj(segundos)}</strong>
                <span>de estudio</span>
              </div>
              <div>
                <strong>{bloques.length}</strong>
                <span>ideas</span>
              </div>
              <div>
                <strong>
                  {notas.filter((n) => n === 'bien' || n === 'perfecta').length} de {bloques.filter((x) => x.pregunta).length}
                </strong>
                <span>comprobaciones bien</span>
              </div>
            </div>
            {flojas.length > 0 ? (
              <>
                <p>Esto vuelve en tu repaso, antes que lo demás:</p>
                <ul className="foco-flojas">
                  {flojas.map(([k, n]) => (
                    <li key={k}>
                      {bloques.find((x) => x.clave === k)?.titulo ?? k} <span className={`chip nota-${n}`}>{NOTA[n] ?? n}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Todo bien. Los conceptos de hoy volverán en el repaso justo antes de que se te olviden.</p>
            )}
            <div className="botones">
              {hoy.repasos > 0 || flojas.length > 0 ? (
                <button className="boton boton-principal" onClick={() => { salir(); irA('repaso') }}>
                  Repasar ahora
                </button>
              ) : null}
              <button className="boton" onClick={() => { salir(); irA('progreso') }}>
                Ver mi progreso
              </button>
              <button className="boton" onClick={salir}>
                Salir del foco
              </button>
            </div>
          </section>
        ) : (
          <article className="foco-idea">
            <span className="foco-etq">
              Idea {i + 1} de {bloques.length}
            </span>
            <h1>{b.titulo}</h1>
            <TextoLibro markdown={b.texto} className="foco-papel" />
            {b.pregunta && !comprobado[b.clave] && (
              <Comprobar key={b.clave} pregunta={b.pregunta} alAcabar={(n) => setComprobado((c) => ({ ...c, [b.clave]: n }))} />
            )}
            {b.pregunta && comprobado[b.clave] && (
              <p className={`foco-hecho nota-${comprobado[b.clave]}`}>Comprobada: {NOTA[comprobado[b.clave]] ?? comprobado[b.clave]}</p>
            )}
          </article>
        )}
      </div>

      {!cerrada && descanso == null && (
        <footer className="foco-pie">
          <button className="boton" disabled={i === 0} onClick={() => ir(-1)}>
            ← Anterior
          </button>
          <span className="foco-atajos">
            {puedeSeguir ? '← → para moverte · L lupa · G términos · Esc salir' : 'Para seguir, contesta la comprobación del final de la idea (o sáltala).'}
          </span>
          {b.pregunta && !comprobado[b.clave] && (
            <button className="boton-mini" onClick={() => setComprobado((c) => ({ ...c, [b.clave]: 'saltada' }))}>
              Saltar la comprobación
            </button>
          )}
          {ultimo ? (
            <button className="boton boton-principal" disabled={!puedeSeguir} onClick={cerrar}>
              Cerrar la sesión
            </button>
          ) : (
            <button className="boton boton-principal" disabled={!puedeSeguir} onClick={() => ir(1)}>
              Siguiente idea →
            </button>
          )}
        </footer>
      )}

      {glosario && (
        <aside className="foco-glosario" aria-label="Términos de la lección">
          <div className="foco-glosario-cabecera">
            <strong>Términos</strong>
            <button className="foco-boton" onClick={() => setGlosario(false)}>
              Cerrar
            </button>
          </div>
          <dl>
            {leccion.definiciones.map((d) => (
              <div key={d.termino}>
                <dt>
                  {d.termino} {d.ingles && d.ingles !== d.termino && <small>{d.ingles}</small>}
                </dt>
                <dd>{d.definicion}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </div>
  )
}

// Modo Tutor: la tarjeta «Hoy» y, al empezar, el modo foco.
export default function PanelTutor({ irA }: { irA: (m: IdModo) => void }) {
  const [hoy, setHoy] = useState<Hoy | null>(null)
  const [leccion, setLeccion] = useState<Leccion | null>(null)
  const [foco, setFoco] = useState(false)
  const [avance, setAvance] = useState<Avance | null>(null)

  useEffect(() => {
    // #/tutor/foco entra directamente en la sesión (desde Progreso o el calendario).
    const directo = window.location.hash.startsWith('#/tutor/foco')
    if (directo) window.history.replaceState(null, '', '#/tutor')
    pedir<Hoy>('/api/hoy').then(async (h) => {
      setHoy(h)
      if (!h.material_id) return
      const a = leerAvance(h.material_id)
      setAvance(a)
      if (directo && h.estado !== 'sin_preparar') {
        setLeccion(await pedir<Leccion>(`/api/tutor/leccion/${h.material_id}`))
        setFoco(true)
      }
    })
  }, [])

  const empezar = async (desdeCero: boolean) => {
    if (!hoy?.material_id) return
    if (desdeCero) {
      guardarAvance(hoy.material_id, null)
      setAvance(null)
    }
    // La pantalla completa solo se puede pedir dentro del clic.
    document.documentElement.requestFullscreen?.().catch(() => undefined)
    const l = leccion ?? (await pedir<Leccion>(`/api/tutor/leccion/${hoy.material_id}`))
    setLeccion(l)
    setFoco(true)
  }

  if (!hoy) return <p className="vacio">Preparando…</p>

  if (foco && leccion)
    return (
      <Foco
        hoy={hoy}
        leccion={leccion}
        inicial={avance}
        irA={irA}
        alSalir={() => {
          setFoco(false)
          if (hoy.material_id) setAvance(leerAvance(hoy.material_id))
        }}
      />
    )

  if (hoy.estado === 'sin_plan')
    return (
      <div className="panel">
        <Vacio
          etiqueta="Tutor"
          titulo="Aún no tienes un plan"
          texto="El tutor te dice cada día qué toca y te lo explica idea a idea, en modo foco: pantalla completa, sin menús, con una comprobación al final de cada idea."
          acciones={[{ texto: 'Crear mi plan', principal: true, alPulsar: () => irARuta('#/nuevo-plan') }]}
        />
      </div>
    )

  if (hoy.estado === 'solo_repaso' || !hoy.titulo)
    return (
      <div className="panel">
        <Vacio
          etiqueta="Hoy"
          titulo={hoy.repasos ? 'Hoy toca repasar' : 'Hoy no te toca nada'}
          texto={
            hoy.repasos
              ? `No hay lección prevista, pero ${hoy.repasos} conceptos esperan su repaso.`
              : 'No hay lección prevista ni repasos. Puedes adelantar una lección desde Fichas o descansar.'
          }
          acciones={[
            ...(hoy.repasos ? [{ texto: 'Repasar', principal: true, alPulsar: () => irA('repaso') }] : []),
            { texto: 'Ver el plan', alPulsar: () => irA('roadmap') },
          ]}
        />
      </div>
    )

  const ideas = avance ? `idea ${avance.i + 1}` : null

  return (
    <div className="tutor-inicio">
      <Mascota />
      <section className="tutor-hoy">
        <span className="vacio-etq">Hoy · {hoy.razon}</span>
        <h1>
          <span className="bloques-clave">{hoy.leccion_clave}</span> {hoy.titulo}
        </h1>
        <p className="nota">
          {hoy.tema} · {String(hoy.horas).replace('.', ',')} h previstas
        </p>
        {hoy.estado === 'sin_preparar' ? (
          <>
            <p>La lección aún no está preparada. Prepárala y vuelve: tarda unos minutos.</p>
            <div className="vacio-acciones">
              <button
                className="boton boton-principal"
                onClick={() => (hoy.tema_id ? irARuta(`#/fichas/${hoy.tema_id}/${hoy.leccion_clave}`) : irA('fichas'))}
              >
                Prepararla
              </button>
            </div>
          </>
        ) : (
          <>
            <ul className="tutor-como">
              <li>Pantalla completa, sin menús ni avisos.</li>
              <li>Una idea cada vez y una comprobación al final de cada una.</li>
              <li>Reloj con pausa cada 25 minutos. Esc para salir; guarda dónde lo dejas.</li>
            </ul>
            <div className="vacio-acciones">
              <button className="boton boton-principal" onClick={() => empezar(false)}>
                {ideas ? `Seguir por la ${ideas}` : 'Empezar en modo foco'}
              </button>
              {ideas && (
                <button className="boton" onClick={() => empezar(true)}>
                  Empezar de cero
                </button>
              )}
              {hoy.repasos > 0 && (
                <button className="boton" onClick={() => irA('repaso')}>
                  Antes, {hoy.repasos} repasos
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
