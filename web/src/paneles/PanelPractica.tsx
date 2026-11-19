import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from '../componentes/Markdown.tsx'
import { enviarJson, flujo, pedir } from '../api.ts'
import Vacio from '../componentes/Vacio.tsx'
import Cargando, { mensajeDe, TextoError } from '../componentes/Cargando.tsx'
import MarcoFoco from '../componentes/MarcoFoco.tsx'
import RepasoTema from '../componentes/RepasoTema.tsx'
import type { IdModo } from '../modos.ts'
import { barajar } from '../barajar.ts'
import { celebrar, reaccionar } from '../componentes/animo.ts'
import { guardarPractica, leerPractica } from '../componentes/aMedias.ts'
import { contador, MAX_RESPUESTA, tandaQueSigue, textoError, textoOtraVez, tipoDeIntento, ultimoSinVer } from '../componentes/repaso.ts'

interface EnCola {
  concepto_id: string
  plan_id: number
  nombre: string
  p: number
  minutos: number
  nuevo: boolean
}

interface Servida {
  pregunta_id: string
  concepto_id: string
  plan_id?: number
  nombre: string
  enunciado: string
  quedan: number
  // Lo fallaste hoy: vuelve hasta acertarlo una vez (no cuenta para el programador).
  otra_vez?: boolean
  // false: el concepto no tiene otra pregunta sin fallar hoy, así que vuelve la misma.
  otra_pregunta?: boolean
  // El repaso es de todos tus planes a la vez: de qué plan y lección es cada pregunta.
  tema?: string | null
  leccion_clave?: string
  leccion_titulo?: string | null
  // Solo las tipo test: se responden pulsando y se corrigen al momento, sin modelo.
  opciones?: string[] | null
}

interface ResultadoTest {
  elegida: string
  acierto: boolean
  buena: string
  porque: string
  proxima_fecha: string | null
  tipo?: 'espaciado' | 'reintento'
}

type ErrorCorrector = { afirmacion: string; por_que: string; literal?: boolean }

// El último intento corregido (tras recargar a mitad de la corrección, el servidor la acaba igual).
interface UltimoIntento {
  intento_id: string
  nombre: string | null
  enunciado: string | null
  respuesta: string
  momento: string
  nota: string
  ideas_ausentes: string[]
  errores: ErrorCorrector[]
  explicacion: string
}

const CLAVE_VISTO = 'magister-repaso-ultimo-visto'
const leerVisto = () => {
  try {
    return localStorage.getItem(CLAVE_VISTO)
  } catch {
    return null
  }
}
const marcarVisto = (id: string) => {
  try {
    localStorage.setItem(CLAVE_VISTO, id)
  } catch {
    /* sin almacenamiento: puede volver a salir */
  }
}

type EventoCorreccion =
  | { tipo: 'nota'; nota: string; ideas_ausentes: string[]; errores: ErrorCorrector[] }
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
  // Tras «Reintentar (no cuenta)», lo que envíes de esa misma pregunta va como reintento: no mueve el repaso.
  const reintentando = useRef(false)
  const [test, setTest] = useState<ResultadoTest | null>(null)
  // La tanda de hoy: cuántas había al empezar y cuántas llevas.
  const [tanda, setTanda] = useState<{ total: number; hechas: number } | null>(null)
  // Para «Lo dejaste a medias» en Hoy: la tanda del día (no la de un concepto suelto); null, acabada. Responder ya cuenta.
  const apuntarTanda = (t: { total: number; hechas: number } | null) => {
    if (!concepto) guardarPractica(t && { ...t, en: Date.now() })
  }
  const apuntarRespondida = () => tanda && apuntarTanda({ ...tanda, hechas: tanda.hechas + 1 })
  // Lo que respondes al «No estoy de acuerdo»: si cambia tu repaso o no (solo cuenta el primer intento del día).
  const [avisoNota, setAvisoNota] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<UltimoIntento | null>(null)
  // «Seguir repasando»: la tanda con la que se continúa (su contador), en vez de empezar otra.
  const reanudar = useRef<{ total: number; hechas: number } | null>(null)

  const responderTest = async (opcion: string) => {
    if (!pregunta || test) return
    try {
      const r = await pedir<Omit<ResultadoTest, 'elegida'>>(
        '/api/practica/test',
        enviarJson({
          pregunta_id: pregunta.pregunta_id,
          opcion,
          confianza,
          clave: nueva(),
          // La vuelta de hoy a lo que fallaste no es un repaso: no programa nada ni entra en el modelo.
          tipo: tipoDeIntento(pregunta.otra_vez, reintentando.current),
        }),
      )
      setTest({ ...r, elegida: opcion })
      apuntarRespondida()
      reaccionar(r.acierto ? 'acierto' : 'fallo')
    } catch (e) {
      setError(mensajeDe(e))
    }
  }

  const [falloCola, setFalloCola] = useState<string | null>(null)
  const cargar = useCallback(() => {
    setFalloCola(null)
    pedir<EnCola[]>('/api/practica/cola')
      .then(setCola)
      .catch((e) => setFalloCola(mensajeDe(e)))
  }, [])

  useEffect(cargar, [cargar])

  // Si recargaste mientras se corregía, el servidor la acabó igual: aquí se ve la nota y la explicación.
  useEffect(() => {
    if (guiada) return
    pedir<UltimoIntento | null>('/api/practica/ultimo')
      .then((u) => {
        if (u && ultimoSinVer(u, leerVisto(), Date.now())) setUltimo(u)
      })
      .catch(() => undefined)
  }, [guiada])

  // En el tutor no hace falta pulsar «Empezar»: la primera pregunta sale sola. Y una tanda que dejaste a medias
  // («Seguir repasando») sigue sola, con su contador.
  useEffect(() => {
    if (!cola || empezada.current) return
    if (guiada) {
      empezada.current = true
      if (cola.length) siguiente()
      else guiada.alAcabar(0)
      return
    }
    if (concepto) return
    empezada.current = true
    const sigue = tandaQueSigue(leerPractica(), Date.now(), cola.length)
    if (sigue) {
      reanudar.current = sigue
      siguiente()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cola])

  const salir = () => {
    if (guiada) return guiada.alAcabar(hechasGuia.current)
    setPregunta(null)
    setTanda(null)
    cargar()
  }

  const siguiente = async () => {
    const seguida = reanudar.current
    reanudar.current = null
    const t = seguida ?? (tanda ? { ...tanda, hechas: tanda.hechas + (pregunta ? 1 : 0) } : { total: cola?.length ?? 1, hechas: 0 })
    setTanda(t)
    setTest(null)
    setNota(null)
    setExplicacion('')
    setFin(null)
    setRespuesta('')
    setConfianza(null)
    setError(null)
    setAvisoConfianza(null)
    setAvisoNota(null)
    setUltimo(null)
    reintentando.current = false
    if (pregunta) hechasGuia.current += 1
    let p: Servida | null
    try {
      p = await pedir<Servida | null>(`/api/practica/siguiente${concepto ? `?concepto_id=${concepto}` : ''}`)
    } catch (e) {
      setError(mensajeDe(e))
      return
    }
    apuntarTanda(p ? t : null)
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
    if (!pregunta || confianza_ == null || !respuesta_.trim() || respuesta_.trim().length > MAX_RESPUESTA) return
    if (tipoDeIntento(pregunta.otra_vez, reintentando.current) === 'reintento') tipo = 'reintento'
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
        else if (ev.tipo === 'fin') {
          setFin(ev)
          // La has visto entera aquí: tras recargar no hace falta volver a enseñarla.
          if (ev.intento_id) marcarVisto(ev.intento_id)
          apuntarRespondida()
        }
        else if (ev.tipo === 'error') setError(ev.detalle)
        else if (ev.tipo === 'aviso') setAvisoConfianza(ev.texto)
      }
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setCorrigiendo(false)
    }
  }

  const minutos = cola ? Math.round(cola.reduce((a, c) => a + c.minutos, 0)) : 0

  return (
    <div className="panel">
      <h1>Repaso</h1>
      {cola == null && falloCola && <Cargando error={falloCola} reintentar={cargar} />}
      {!pregunta && ultimo && (
        <section className={`correccion nota-${ultimo.nota}`} aria-label="Tu última respuesta">
          <p className="nota">
            Tu última respuesta{ultimo.nombre ? ` (${ultimo.nombre})` : ''} se corrigió mientras recargabas; ya cuenta.
          </p>
          {ultimo.enunciado && <p><strong>{ultimo.enunciado}</strong></p>}
          <p>
            <strong>Nota: {ultimo.nota}</strong>
            {ultimo.ideas_ausentes.length > 0 && <> · Faltaba: {ultimo.ideas_ausentes.join('; ')}</>}
          </p>
          {ultimo.errores.map((e, i) => (
            <p key={i} className="aviso-dudosa">
              {textoError(e)}
            </p>
          ))}
          <Markdown>{ultimo.explicacion}</Markdown>
          <div className="fila">
            <button
              className="boton-mini"
              onClick={() => {
                marcarVisto(ultimo.intento_id)
                setUltimo(null)
              }}
            >
              Entendido
            </button>
          </div>
        </section>
      )}
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
          texto="Los conceptos de una lección entran aquí cuando tiene preguntas (al generar su material) y además la has estudiado: una sesión suya marcada como hecha, o algo ya practicado. Después vuelven justo antes de que los olvides."
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
          {(pregunta.tema || pregunta.leccion_clave) && (
            <p className="nota">
              {[pregunta.tema, [pregunta.leccion_clave, pregunta.leccion_titulo].filter(Boolean).join(' · ')].filter(Boolean).join(' · ')}
            </p>
          )}
          {pregunta.otra_vez && <p className="repaso-otra-vez">{textoOtraVez(pregunta.otra_pregunta)}</p>}
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
                    {test.proxima_fecha
                      ? ` · próximo repaso: ${new Date(test.proxima_fecha).toLocaleDateString('es-ES')}`
                      : test.tipo === 'reintento'
                        ? ' · es la vuelta de hoy: no cambia tu próximo repaso'
                        : ''}
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
            maxLength={MAX_RESPUESTA}
            onChange={(e) => setRespuesta(e.target.value)}
          />
          {!nota && contador(respuesta.length).visible && (
            <p className="nota" aria-live="polite">
              {contador(respuesta.length).texto} caracteres
            </p>
          )}
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
                  {textoError(e)}
                </p>
              ))}
              <Markdown>{explicacion}</Markdown>
              {fin && (
                <div className="fila">
                  {fin.proxima_fecha ? (
                    <span className="nota">
                      Próximo repaso: {new Date(fin.proxima_fecha).toLocaleDateString('es-ES')}
                    </span>
                  ) : (
                    (pregunta.otra_vez || reintentando.current) && (
                      <span className="nota">Es la vuelta de hoy: no cambia tu próximo repaso.</span>
                    )
                  )}
                  <label className="nota">
                    No estoy de acuerdo, mi nota es{' '}
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return
                        pedir<{ aviso?: string }>(`/api/practica/intentos/${fin.intento_id}`, enviarJson({ nota_usuario: e.target.value }, 'PATCH'))
                          .then((r) => setAvisoNota(r.aviso ?? 'Anotado.'))
                          .catch((err) => setAvisoNota(`No he podido guardarla: ${mensajeDe(err)}`))
                      }}
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
                        reintentando.current = true
                        setAvisoNota(null)
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
              {avisoNota && (
                <p className="nota" role="status">
                  {avisoNota}
                </p>
              )}
            </div>
          )}
          </>
          )}
          {error && <TextoError texto={error} />}
        </section>
        </MarcoFoco>
      )}
    </div>
  )
}
