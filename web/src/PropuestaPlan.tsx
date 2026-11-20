import { useState } from 'react'
import type { NecesitaFuentes, Propuesta } from './api.ts'
import BarraCuota from './componentes/BarraCuota.tsx'
import { numero, pluralT, textoSustituye } from './componentes/formato.ts'
import { idiomaActual, t } from './i18n/i18n.ts'
import { usarIdioma } from './i18n/usarIdioma.ts'

// Si una lección necesita fuentes (ADR-0021): lo decide el plan y lo cambias en Roadmap. Aquí y no en PanelPlan, que se
// carga aparte (lazy).
export const etiquetaFuentes = (k: NecesitaFuentes): string => t(`prop.fuentes.${k}`)
export const NIVELES_FUENTES: NecesitaFuentes[] = ['no', 'conviene', 'imprescindible']

interface Props {
  propuesta: Propuesta
  ocupado: boolean
  alAceptar: (buscarFuentes: boolean) => void
  alCambiar: (texto: string) => void
  alDescartar: () => void
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString(idiomaActual() === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short' }) : '·'

// La cara de la pausa del grafo: el plan propuesto espera tu decisión.
export default function PropuestaPlan({ propuesta, ocupado, alAceptar, alCambiar, alDescartar }: Props) {
  usarIdioma()
  const [cambiando, setCambiando] = useState(false)
  const [texto, setTexto] = useState('')
  const [pulsado, setPulsado] = useState(false)
  const bloqueado = ocupado || pulsado
  // «Aceptar y buscar fuentes» busca en las lecciones que las necesitan: dos llamadas por cada una. Aceptar sin más no
  // gasta modelo; «Rehacer» vuelve a planificar.
  const aBuscar = propuesta.lecciones.filter((l) => l.necesita_fuentes !== 'no').length
  // Ya hay un plan aceptado de este tema: aceptar este lo sustituye (lo dice la tarjeta y lo dicen los botones).
  const sustituye = propuesta.sustituye ?? null
  const idAviso = 'propuesta-sustituye'

  return (
    <section className="propuesta" aria-label={t('prop.aria')}>
      <h2>{t('prop.titulo')}{propuesta.tema ? `: ${propuesta.tema}` : ''}</h2>
      <p className="nota">
        {t('prop.resumen', { total: numero(propuesta.total_horas), cap: numero(propuesta.capacidad_horas), fin: fecha(propuesta.fin), sesiones: pluralT(propuesta.sesiones.length, 'prop.sesion', 'prop.sesiones') })}
      </p>
      {sustituye && (
        <p className="aviso-sustituye" role="note" id={idAviso}>
          {textoSustituye(sustituye)}
        </p>
      )}
      {propuesta.razonamiento && <p className="razonamiento">{propuesta.razonamiento}</p>}
      <ol className="lecciones">
        {propuesta.lecciones.map((l) => (
          <li key={l.clave}>
            <strong>
              {l.clave} · {l.titulo}
            </strong>{' '}
            <span className="nota-linea">
              {numero(l.horas, 2)} h{l.depende_de.length ? ` · ${t('prop.despuesDe', { lista: l.depende_de.join(', ') })}` : ''}
            </span>{' '}
            {l.necesita_fuentes && (
              // Lo que decide el plan; se cambia en Roadmap, lección a lección, una vez aceptado.
              <span className="chip chip-fuentes" title={`${l.fuentes_por_que ?? ''} ${t('prop.fuentesTitulo')}`.trim()}>
                {etiquetaFuentes(l.necesita_fuentes)}
              </span>
            )}
            <ul>
              {l.objetivos.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            <div className="chips">
              {l.conceptos.map((c) => (
                <span key={c.id} className="chip">
                  {c.nombre}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {cambiando ? (
        <form
          className="entrada"
          onSubmit={(e) => {
            e.preventDefault()
            if (!texto.trim()) return
            setPulsado(true)
            alCambiar(texto.trim())
          }}
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={t('prop.cambiarPlaceholder')}
            aria-label={t('prop.cambiarAria')}
            autoFocus
          />
          <button className="boton boton-principal" disabled={bloqueado || !texto.trim()}>
            {t('prop.rehacer')}
          </button>
        </form>
      ) : (
        <div className="botones">
          <button
            className="boton boton-principal"
            disabled={bloqueado}
            aria-describedby={sustituye ? idAviso : undefined}
            onClick={() => {
              setPulsado(true)
              alAceptar(true)
            }}
          >
            {sustituye ? t('prop.sustituirBuscar') : t('prop.aceptarBuscar')}
          </button>
          <button
            className="boton"
            disabled={bloqueado}
            aria-describedby={sustituye ? idAviso : undefined}
            onClick={() => {
              setPulsado(true)
              alAceptar(false)
            }}
          >
            {sustituye ? t('prop.aceptarSustituir') : t('prop.aceptar')}
          </button>
          <button className="boton" disabled={bloqueado} onClick={() => setCambiando(true)}>
            {t('prop.cambiarAlgo')}
          </button>
          {/* Sin plan y de vuelta a estudio: la conversación sigue. */}
          <button
            className="boton-mini"
            disabled={bloqueado}
            onClick={() => {
              setPulsado(true)
              alDescartar()
            }}
          >
            {t('prop.ahoraNo')}
          </button>
        </div>
      )}
      {/* Lo que gastaría, antes de pulsar: buscar las fuentes de esas lecciones o, si lo cambias, rehacer el plan. */}
      {cambiando ? (
        <BarraCuota accion={{ accion: 'plan' }} compacta />
      ) : (
        aBuscar > 0 && <BarraCuota accion={{ accion: 'research', lecciones: aBuscar }} />
      )}
    </section>
  )
}
