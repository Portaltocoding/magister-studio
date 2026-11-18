import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { enviarJson, flujo, pedir } from '../api.ts'
import Vacio from '../componentes/Vacio.tsx'
import MarcoFoco from '../componentes/MarcoFoco.tsx'
import RepasoTema from '../componentes/RepasoTema.tsx'
import type { IdModo } from '../modos.ts'
import { barajar } from '../barajar.ts'
import { celebrar, reaccionar } from '../componentes/animo.ts'

interface EnCola {
  concepto_id: string
  nombre: string
  p: number
  minutos: number
  nuevo: boolean
}

interface Servida {
  pregunta_id: string
  concepto_id: string
  nombre: string
  enunciado: string
  quedan: number
  // Lo fallaste hoy: vuelve con otra pregunta hasta acertarlo una vez (no cuenta para el programador).
  otra_vez?: boolean
  // Solo las tipo test: se responden pulsando y se corrigen al momento, sin modelo.
  opciones?: string[] | null
}

interface ResultadoTest {
  elegida: string
  acierto: boolean
  buena: string
  porque: string
  proxima_fecha: string | null
}

type EventoCorreccion =
  | { tipo: 'nota'; nota: string; ideas_ausentes: string[]; errores: { afirmacion: string; por_que: string }[] }
  | { tipo: 'delta'; t: string }
  | { tipo: 'fin'; intento_id: string; proxima_fecha: string | null }
  | { tipo: 'error'; detalle: string }
  | { tipo: 'aviso'; texto: string }

const CONFIANZAS: [number, string][] = [
  [0.25, 'No lo sé'],
  [0.5, 'Dudo'],
  [0.75, 'Bastante seguro'],
  [0.95, 'Seguro'],
]
const NOTAS = ['fallo', 'parcial', 'bien', 'perfecta']
const nueva = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

// Repaso: lo que toca hoy, una pregunta cada vez, respondida de memoria y corregida en flujo.
// guiada: dentro del tutor. Empieza sola y, al acabar la tanda (o al salir), devuelve cuántas has hecho.
export default function PanelPractica({ concepto, irA, guiada }: { concepto?: string; irA: (m: IdModo) => void; guiada?: { alAcabar: (hechas: number) => void } }) {
  const hechasGuia = useRef(0)
  const empezada = useRef(false)
  const [cola, setCola] = useState<EnCola[] | null>(null)
  const [pregunta, setPregunta] = useState<Servida | null>(null)
  const [respuesta, setRespuesta] = useState('')
  const [confianza, setConfianza] = useState<number | null>(null)
  const [nota, setNota] = useState<Extract<EventoCorreccion, { tipo: 'nota' }> | null>(null)
  const [explicacion, setExplicacion] = useState('')
  const [fin, setFin] = useState<{ intento_id: string; proxima_fecha: string | null } | null>(null)
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [avisoConfianza, setAvisoConfianza] = useState<string | null>(null)
  const servidaEn = useRef(Date.now())
  const [test, setTest] = useState<ResultadoTest | null>(null)
  // La tanda de hoy: cuántas había al empezar y cuántas llevas.
  const [tanda, setTanda] = useState<{ total: number; hechas: number } | null>(null)

  const responderTest = async (opcion: string) => {
    if (!pregunta || test) return
    try {
      const r = await pedir<Omit<ResultadoTest, 'elegida'>>(
        '/api/practica/test',
        enviarJson({ pregunta_id: pregunta.pregunta_id, opcion, confianza, clave: nueva() }),
      )
      setTest({ ...r, elegida: opcion })
      reaccionar(r.acierto ? 'acierto' : 'fallo')
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const cargar = useCallback(() => {
    pedir<EnCola[]>('/api/practica/cola').then(setCola)
  }, [])

  useEffect(cargar, [cargar])

  // En el tutor no hace falta pulsar «Empezar»: la primera pregunta sale sola.
  useEffect(() => {
    if (!guiada || !cola || empezada.current) return
    empezada.current = true
    if (cola.length) siguiente()
    else guiada.alAcabar(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cola])

  const salir = () => {
    if (guiada) return guiada.alAcabar(hechasGuia.current)
    setPregunta(null)
    setTanda(null)
    cargar()
  }

  const siguiente = async () => {
    setTanda((t) => (t ? { ...t, hechas: t.hechas + (pregunta ? 1 : 0) } : { total: cola?.length ?? 1, hechas: 0 }))
    setTest(null)
    setNota(null)
    setExplicacion('')
    setFin(null)
    setRespuesta('')
    setConfianza(null)
    setError(null)
    setAvisoConfianza(null)
    if (pregunta) hechasGuia.current += 1
    const p = await pedir<Servida | null>(`/api/practica/siguiente${concepto ? `?concepto_id=${concepto}` : ''}`)
    // Se acabó la tanda: se celebra.
    if (!p && pregunta) celebrar(null, true)
    if (!p && guiada) return guiada.alAcabar(hechasGuia.current)
    setPregunta(p)
    servidaEn.current = Date.now()
    cargar()
  }

  const enviar = async (tipo: 'espaciado' | 'reintento' = 'espaciado', forzado?: { respuesta: string; confianza: number }) => {
    const respuesta_ = forzado?.respuesta ?? respuesta
    const confianza_ = forzado?.confianza ?? confianza
    if (!pregunta || confianza_ == null || !respuesta_.trim()) return
    if (pregunta.otra_vez) tipo = 'reintento'
    if (forzado) {
      setRespuesta(forzado.respuesta)
      setConfianza(forzado.confianza)
    }
    setCorrigiendo(true)
    setExplicacion('')
    try {
      for await (const ev of flujo<EventoCorreccion>(
        '/api/practica/intentos',
        {
          pregunta_id: pregunta.pregunta_id,
          concepto_id: pregunta.concepto_id,
          respuesta: respuesta_,
          confianza: confianza_,
          clave: nueva(),
          tipo,
          latencia_ms: Date.now() - servidaEn.current,
        },
      )) {
        if (ev.tipo === 'nota') {
          setNota(ev)
          if (ev.nota === 'bien' || ev.nota === 'perfecta') reaccionar('acierto')
          else if (ev.nota === 'fallo') reaccionar('fallo')
        } else if (ev.tipo === 'delta') setExplicacion((x) => x + ev.t)
        else if (ev.tipo === 'fin') setFin(ev)
        else if (ev.tipo === 'error') setError(ev.detalle)
        else if (ev.tipo === 'aviso') setAvisoConfianza(ev.texto)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setCorrigiendo(false)
    }
  }

  const minutos = cola ? Math.round(cola.reduce((a, c) => a + c.minutos, 0)) : 0

  return (
    <div className="panel">
      <h1>Repaso</h1>
      {!pregunta && <RepasoTema alPracticar={siguiente} alExaminar={() => irA('examen')} />}
      {cola && pregunta && (
        <p className="nota">
          {cola.length ? `${cola.length} conceptos para hoy · unos ${minutos} minutos` : 'Último de hoy.'}
        </p>
      )}
      {cola && cola.length === 0 && !pregunta && (
        <Vacio
          etiqueta="Hoy, nada pendiente"
          titulo="No te toca repasar nada"
          texto="Los conceptos entran aquí cuando generas el material de una lección, y vuelven justo antes de que los olvides. Cuantas más lecciones prepares, más tendrás."
          acciones={[
            { texto: 'Preparar una lección', principal: true, alPulsar: () => irA('fichas') },
            { texto: 'Ver mi progreso', alPulsar: () => irA('progreso') },
          ]}
        />
      )}
      {!pregunta && cola && cola.length > 0 && (
        <Vacio
          etiqueta={`Hoy · unos ${minutos} minutos`}
          titulo={`${cola.length} ${cola.length === 1 ? 'concepto te espera' : 'conceptos te esperan'}`}
          texto="Una pregunta cada vez. Sin mirar los apuntes: recordar cuesta, y por eso fija."
          pasos={[
            { titulo: 'Responde de memoria', texto: 'Con tus palabras, aunque sea a medias.' },
            { titulo: 'Di lo seguro que estás', texto: 'Así sabrás si aciertas tanto como crees.' },
            { titulo: 'El tutor corrige', texto: 'Y te lo vuelve a preguntar justo antes de que lo olvides.' },
          ]}
          acciones={[{ texto: 'Empezar', principal: true, alPulsar: siguiente }]}
        >
          <div className="vacio-chips">
            {cola.map((c) => (
              <span key={c.concepto_id} className={`chip ${c.nuevo ? 'chip-nuevo' : ''}`} title={c.nuevo ? 'Primera vez' : `Lo recuerdas al ${Math.round(c.p * 100)} %`}>
                {c.nombre}
              </span>
            ))}
          </div>
        </Vacio>
      )}
      {pregunta && (
        <MarcoFoco
          titulo={pregunta.nombre}
          placa="RE"
          alSalir={() => {
            if (!corrigiendo) salir()
          }}
          pasos={
            tanda && (
              <span className="foco-contador" aria-live="polite">
                {Math.min(tanda.hechas + 1, tanda.total)} de {tanda.total}
              </span>
            )
          }
          pie={<span className="nota">Esc para salir: lo que has respondido ya cuenta.</span>}
        >
        <section className="practica">
          {pregunta.otra_vez && (
            <p className="repaso-otra-vez">Otra vez, con otra pregunta: hoy lo fallaste. Acertarlo una vez basta.</p>
          )}
          <h2 className="enunciado">{pregunta.enunciado}</h2>
          {pregunta.opciones && pregunta.opciones.length > 0 ? (
            <div className="repaso-test">
              <div className="fila" role="radiogroup" aria-label="¿Cómo de seguro estás? (opcional)">
                <span className="nota">¿Seguro? (opcional)</span>
                {CONFIANZAS.map(([v, t]) => (
                  <button key={v} className="boton-mini" aria-pressed={confianza === v} disabled={!!test} onClick={() => setConfianza(v)}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="test-opciones">
                {barajar(pregunta.opciones, pregunta.pregunta_id).map((o, k) => (
                  <button
                    key={o}
                    type="button"
                    disabled={!!test}
                    className={`test-opcion ${test && o === test.buena ? 'buena' : ''} ${test && o === test.elegida && !test.acierto ? 'mala' : ''}`}
                    onClick={() => responderTest(o)}
                  >
                    <span className="test-letra">{String.fromCharCode(65 + k)}</span>
                    <span>{o}</span>
                  </button>
                ))}
              </div>
              {test && (
                <div className={`correccion nota-${test.acierto ? 'bien' : 'fallo'}`}>
                  <p>
                    <strong>{test.acierto ? '✓ Bien' : '✗ No'}</strong>
                    {test.proxima_fecha ? ` · próximo repaso: ${new Date(test.proxima_fecha).toLocaleDateString('es-ES')}` : ''}
                  </p>
                  <Markdown>{test.porque}</Markdown>
                  <div className="fila">
                    <button className="boton boton-principal" onClick={siguiente}>
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
          <>
          <textarea
            className="critica"
            placeholder="Responde de memoria, con tus palabras"
            aria-label="Tu respuesta"
            value={respuesta}
            disabled={!!nota}
            onChange={(e) => setRespuesta(e.target.value)}
          />
          {!nota && (
            <>
              <div className="fila repaso-envio">
                <span className="nota">¿Seguro?</span>
                <div className="fila" role="radiogroup" aria-label="¿Cómo de seguro estás?">
                  {CONFIANZAS.map(([v, t]) => (
                    <button key={v} className="boton-mini" aria-pressed={confianza === v} onClick={() => setConfianza(v)}>
                      {t}
                    </button>
                  ))}
                </div>
                <button
                  className="boton boton-principal"
                  disabled={corrigiendo || confianza == null || !respuesta.trim()}
                  onClick={() => enviar()}
                >
                  {corrigiendo ? 'Corrigiendo…' : 'Enviar'}
                </button>
              </div>
              {!corrigiendo && (
                <button
                  className="boton-mini repaso-no-se"
                  title="Cuenta como fallo y te enseña la respuesta"
                  onClick={() => enviar('espaciado', { respuesta: 'No lo sé.', confianza: 0.25 })}
                >
                  No lo sé, enséñame la respuesta
                </button>
              )}
            </>
          )}
          {nota && (
            <div className={`correccion nota-${nota.nota}`}>
              <p>
                <strong>Nota: {nota.nota}</strong>
                {nota.ideas_ausentes.length > 0 && <> · Faltaba: {nota.ideas_ausentes.join('; ')}</>}
              </p>
              {avisoConfianza && <p className="repaso-aviso-confianza">{avisoConfianza}</p>}
              {nota.errores.map((e, i) => (
                <p key={i} className="aviso-dudosa">
                  «{e.afirmacion}»: {e.por_que}
                </p>
              ))}
              <Markdown>{explicacion}</Markdown>
              {fin && (
                <div className="fila">
                  {fin.proxima_fecha && (
                    <span className="nota">
                      Próximo repaso: {new Date(fin.proxima_fecha).toLocaleDateString('es-ES')}
                    </span>
                  )}
                  <label className="nota">
                    No estoy de acuerdo, mi nota es{' '}
                    <select
                      defaultValue=""
                      onChange={(e) =>
                        e.target.value &&
                        pedir(`/api/practica/intentos/${fin.intento_id}`, enviarJson({ nota_usuario: e.target.value }, 'PATCH'))
                      }
                    >
                      <option value="">·</option>
                      {NOTAS.map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  {nota.nota !== 'perfecta' && (
                    <button
                      className="boton-mini"
                      onClick={() => {
                        setNota(null)
                        setExplicacion('')
                        setFin(null)
                        setRespuesta('')
                      }}
                    >
                      Reintentar (no cuenta)
                    </button>
                  )}
                  <button className="boton boton-principal" onClick={siguiente}>
                    Siguiente
                  </button>
                </div>
              )}
            </div>
          )}
          </>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
        </MarcoFoco>
      )}
    </div>
  )
}
