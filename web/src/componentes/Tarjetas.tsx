import { useCallback, useEffect, useMemo, useState } from 'react'
import Markdown from './Markdown.tsx'
import { enviarJson, pedir } from '../api.ts'
import { reaccionar } from './animo.ts'
import { barajar } from '../barajar.ts'
import { t, type Clave } from '../i18n/i18n.ts'
import { usarIdioma } from '../i18n/usarIdioma.ts'
import { localeActual } from './formato.ts'

export interface Ficha {
  id: string
  tipo: string
  enunciado: string
  fantasma: string
  donde: string | null
  opciones?: { texto: string; buena: boolean }[] | null
}

const TIPOS = ['conceptual', 'calculo', 'fallo', 'escenario', 'hablada', 'test']
const nombreTipo = (tipo: string): string => (TIPOS.includes(tipo) ? t(`tarjetas.tipo.${tipo}` as Clave) : tipo)

type Resultado = 'sabia' | 'no'

// Fichas de una en una: lees, contestas de memoria, giras y te marcas. Teclado: espacio gira, flechas mueven, 1 y 2 marcan.
export default function Tarjetas({ fichas, bloques }: { fichas: Ficha[]; bloques: Record<string, string> }) {
  usarIdioma() // los textos siguen al idioma
  const [solo, setSolo] = useState<string[] | null>(null)
  const lista = useMemo(() => (solo ? fichas.filter((f) => solo.includes(f.id)) : fichas), [fichas, solo])
  const [i, setI] = useState(0)
  const [girada, setGirada] = useState(false)
  const [res, setRes] = useState<Record<string, Resultado>>({})
  const [todas, setTodas] = useState(false)
  // Lo que marcas cuenta para tu repaso, una vez por ficha en esta sesión (repetir las falladas no cuenta doble).
  const [contadas] = useState(() => new Set<string>())
  const [aviso, setAviso] = useState<string | null>(null)
  const f = lista[Math.min(i, lista.length - 1)]
  const hechas = lista.filter((x) => res[x.id]).length
  const fin = lista.length > 0 && hechas === lista.length

  const ir = useCallback(
    (d: number) => {
      setGirada(false)
      setI((x) => Math.max(0, Math.min(lista.length - 1, x + d)))
    },
    [lista.length],
  )
  const marcar = useCallback(
    (r: Resultado) => {
      if (!f) return
      setRes((x) => ({ ...x, [f.id]: r }))
      reaccionar(r === 'sabia' ? 'acierto' : 'fallo')
      if (!contadas.has(f.id)) {
        contadas.add(f.id)
        pedir<{ proxima_fecha: string | null }>(
          '/api/practica/autoevaluacion',
          enviarJson({ pregunta_id: f.id, nota: r === 'sabia' ? 'bien' : 'fallo', origen: 'ficha', clave: `ficha-${f.id}-${Date.now()}` }),
        )
          .then((x) =>
            setAviso(
              x.proxima_fecha
                ? t('tarjetas.anotadoVuelve', { fecha: new Date(x.proxima_fecha).toLocaleDateString(localeActual(), { day: 'numeric', month: 'short' }) })
                : t('tarjetas.anotado'),
            ),
          )
          .catch(() => setAviso(t('tarjetas.noAnota')))
      }
      const siguiente = lista.findIndex((x, k) => k > i && !res[x.id])
      if (siguiente >= 0) {
        setGirada(false)
        setI(siguiente)
      }
    },
    [f, lista, i, res, contadas],
  )

  useEffect(() => {
    if (todas) return
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, button, a, summary, [role=tab]')) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setGirada((g) => !g)
      } else if (e.key === 'ArrowRight') ir(1)
      else if (e.key === 'ArrowLeft') ir(-1)
      else if (girada && e.key === '1') marcar('sabia')
      else if (girada && e.key === '2') marcar('no')
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ir, marcar, girada, todas])

  if (!fichas.length) return <p className="vacio">{t('tarjetas.sinFichas')}</p>

  const sabidas = lista.filter((x) => res[x.id] === 'sabia').length
  const falladas = lista.filter((x) => res[x.id] === 'no').map((x) => x.id)

  return (
    <div className="tarjetas">
      <div className="tarjetas-barra">
        <div className="puntos-fichas" role="tablist" aria-label={t('tarjetas.fichas')}>
          {lista.map((x, k) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={k === i}
              aria-label={t('tarjetas.fichaN', { n: k + 1 })}
              className={`punto-ficha ${k === i ? 'actual' : ''} ${res[x.id] ?? ''}`}
              onClick={() => {
                setGirada(false)
                setI(k)
              }}
            />
          ))}
        </div>
        <span className="nota">
          {t('tarjetas.resumen', { sabidas, falladas: falladas.length, sin: lista.length - hechas })}
        </span>
        {aviso && <span className="nota tarjetas-aviso">{aviso}</span>}
        <button className="boton-mini" onClick={() => setTodas(!todas)}>
          {todas ? t('tarjetas.unaAUna') : t('tarjetas.verTodas')}
        </button>
      </div>

      {todas ? (
        <ol className="fichas-lista">
          {lista.map((x) => (
            <li key={x.id}>
              <span className="chip">{nombreTipo(x.tipo)}</span>
              <div className="ficha-enunciado">
                <Markdown>{x.enunciado}</Markdown>
              </div>
              {x.opciones && x.opciones.length > 0 && (
                <ol className="ficha-opciones">
                  {barajar(x.opciones, x.id).map((o) => (
                    <li key={o.texto}>{o.texto}</li>
                  ))}
                </ol>
              )}
              <details>
                <summary>{t('tarjetas.verRespuesta')}</summary>
                <div className="ficha-respuesta">
                  <Markdown>{x.fantasma}</Markdown>
                </div>
              </details>
            </li>
          ))}
        </ol>
      ) : fin ? (
        <div className="ficha ficha-fin">
          <p className="ficha-num">{t('tarjetas.hecho')}</p>
          <h2>{t('tarjetas.alaPrimera', { sabidas, total: lista.length })}</h2>
          <p>{falladas.length ? t('tarjetas.repiteFalladas') : t('tarjetas.todasBien')}</p>
          <div className="botones">
            {falladas.length > 0 && (
              <button
                className="boton boton-principal"
                onClick={() => {
                  setSolo(falladas)
                  setRes({})
                  setI(0)
                  setGirada(false)
                }}
              >
                {t('tarjetas.repetirFalladas', { n: falladas.length })}
              </button>
            )}
            <button
              className="boton"
              onClick={() => {
                setSolo(null)
                setRes({})
                setI(0)
                setGirada(false)
              }}
            >
              {t('tarjetas.empezarNuevo')}
            </button>
          </div>
        </div>
      ) : (
        f && (
          <>
            <div
              className={`ficha ${girada ? 'girada' : ''}`}
              onClick={() => setGirada(!girada)}
              role="button"
              tabIndex={0}
              aria-label={girada ? t('tarjetas.respuesta') : t('tarjetas.preguntaAria')}
            >
              <div className="ficha-cabecera">
                <span className="ficha-num">
                  {i + 1} / {lista.length}
                </span>
                <span className="chip">{nombreTipo(f.tipo)}</span>
              </div>
              <div className="ficha-enunciado">
                <Markdown>{f.enunciado}</Markdown>
              </div>
              {f.opciones && f.opciones.length > 0 && (
                <ol className="ficha-opciones">
                  {barajar(f.opciones, f.id).map((o) => (
                    <li key={o.texto} className={girada && o.buena ? 'buena' : ''}>
                      {o.texto}
                    </li>
                  ))}
                </ol>
              )}
              {girada ? (
                <div className="ficha-respuesta">
                  <Markdown>{f.fantasma}</Markdown>
                  {f.donde && bloques[f.donde] && <p className="nota">{t('tarjetas.estaEn', { bloque: bloques[f.donde] })}</p>}
                </div>
              ) : (
                <p className="ficha-pista">{t('tarjetas.pista')}</p>
              )}
            </div>
            <div className="ficha-acciones">
              <button className="boton" disabled={i === 0} onClick={() => ir(-1)} aria-label={t('tarjetas.anterior')}>
                ←
              </button>
              {girada ? (
                <>
                  <button className="voto voto-bien grande" onClick={() => marcar('sabia')}>
                    {t('tarjetas.sabia')} <kbd>1</kbd>
                  </button>
                  <button className="voto voto-mal grande" onClick={() => marcar('no')}>
                    {t('tarjetas.noSabia')} <kbd>2</kbd>
                  </button>
                </>
              ) : (
                <button className="boton boton-principal" onClick={() => setGirada(true)}>
                  {t('tarjetas.verRespuesta')} <kbd>{t('tarjetas.espacio')}</kbd>
                </button>
              )}
              <button className="boton" disabled={i >= lista.length - 1} onClick={() => ir(1)} aria-label={t('tarjetas.siguiente')}>
                →
              </button>
            </div>
          </>
        )
      )}
    </div>
  )
}
