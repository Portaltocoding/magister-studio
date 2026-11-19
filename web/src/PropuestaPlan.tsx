import { useState } from 'react'
import type { NecesitaFuentes, Propuesta } from './api.ts'
import BarraCuota from './componentes/BarraCuota.tsx'

// Si una lección necesita fuentes (ADR-0021): lo decide el plan y lo cambias en Roadmap. Aquí y no en PanelPlan, que se
// carga aparte (lazy).
export const ETIQUETA_FUENTES: Record<NecesitaFuentes, string> = {
  no: 'sin fuentes',
  conviene: 'fuentes: convienen',
  imprescindible: 'fuentes: imprescindibles',
}

interface Props {
  propuesta: Propuesta
  ocupado: boolean
  alAceptar: (buscarFuentes: boolean) => void
  alCambiar: (texto: string) => void
  alDescartar: () => void
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '·'

// La cara de la pausa del grafo: el plan propuesto espera tu decisión.
export default function PropuestaPlan({ propuesta, ocupado, alAceptar, alCambiar, alDescartar }: Props) {
  const [cambiando, setCambiando] = useState(false)
  const [texto, setTexto] = useState('')
  const [pulsado, setPulsado] = useState(false)
  const bloqueado = ocupado || pulsado

  return (
    <section className="propuesta" aria-label="Plan propuesto">
      <h2>Plan propuesto{propuesta.tema ? `: ${propuesta.tema}` : ''}</h2>
      <p className="nota">
        {propuesta.total_horas} h de {propuesta.capacidad_horas} h disponibles · acaba el {fecha(propuesta.fin)} ·{' '}
        {propuesta.sesiones.length} sesiones
      </p>
      {propuesta.razonamiento && <p className="razonamiento">{propuesta.razonamiento}</p>}
      <ol className="lecciones">
        {propuesta.lecciones.map((l) => (
          <li key={l.clave}>
            <strong>
              {l.clave} · {l.titulo}
            </strong>{' '}
            <span className="nota-linea">
              {l.horas} h{l.depende_de.length ? ` · después de ${l.depende_de.join(', ')}` : ''}
            </span>{' '}
            {l.necesita_fuentes && (
              // Lo que decide el plan; se cambia en Roadmap, lección a lección, una vez aceptado.
              <span className="chip chip-fuentes" title={`${l.fuentes_por_que ?? ''} Lo puedes cambiar en Roadmap.`.trim()}>
                {ETIQUETA_FUENTES[l.necesita_fuentes]}
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
            placeholder="Qué cambiarías (menos horas, otro orden, quitar algo...)"
            aria-label="Qué cambiarías del plan"
            autoFocus
          />
          <button className="boton boton-principal" disabled={bloqueado || !texto.trim()}>
            Rehacer
          </button>
        </form>
      ) : (
        <div className="botones">
          <button
            className="boton boton-principal"
            disabled={bloqueado}
            onClick={() => {
              setPulsado(true)
              alAceptar(true)
            }}
          >
            Aceptar y buscar fuentes
          </button>
          <button
            className="boton"
            disabled={bloqueado}
            onClick={() => {
              setPulsado(true)
              alAceptar(false)
            }}
          >
            Aceptar
          </button>
          <button className="boton" disabled={bloqueado} onClick={() => setCambiando(true)}>
            Cambiar algo
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
            Ahora no
          </button>
        </div>
      )}
      {/* Aceptar pone en marcha el plan (y la búsqueda de fuentes): lo que gastaría, antes de pulsar. */}
      {!cambiando && <BarraCuota accion={{ accion: 'plan' }} />}
    </section>
  )
}
