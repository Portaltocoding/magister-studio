import { useEffect, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import Pensando from '../componentes/Pensando.tsx'

// Automatizar: reglas que enciendes y Magister cumple solo, cada pocos minutos, de una en una.

interface Reglas {
  preparar_siguiente: { activa: boolean; dias_antes: number }
  diapositivas_al_preparar: { activa: boolean }
  video_al_preparar: { activa: boolean; estilo: string; minutos: number }
  solo_de_noche: boolean
}

interface Respuesta {
  reglas: Reglas
  registro: { momento: string; texto: string }[]
}

const ESTILOS = [
  ['clase', 'Clase'],
  ['resumen', 'Resumen rápido'],
  ['analogias', 'Con analogías'],
  ['examen', 'Para el examen'],
]

function Interruptor({ activo, alCambiar, etiqueta }: { activo: boolean; alCambiar: (v: boolean) => void; etiqueta: string }) {
  return (
    <button type="button" role="switch" aria-checked={activo} aria-label={etiqueta} className={`conmutador ${activo ? 'activo' : ''}`} onClick={() => alCambiar(!activo)}>
      <span />
    </button>
  )
}

export default function PanelAutomatizar() {
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    pedir<Respuesta>('/api/automatizaciones').then(setDatos)
  }, [])

  if (!datos) return <Pensando texto="Cargando…" />
  const r = datos.reglas

  const guardar = async (nuevas: Reglas) => {
    setDatos({ ...datos, reglas: nuevas })
    setDatos(await pedir<Respuesta>('/api/automatizaciones', { ...enviarJson(nuevas), method: 'PUT' }))
  }
  const ahora = async () => {
    setAviso('Revisando…')
    const x = await pedir<{ hecho: string | null }>('/api/automatizaciones/ahora', { method: 'POST' })
    setAviso(x.hecho ?? (r.solo_de_noche ? 'Nada ahora: está en «solo de noche».' : 'Nada que hacer ahora mismo.'))
    setDatos(await pedir<Respuesta>('/api/automatizaciones'))
  }

  return (
    <div className="panel automatizar">
      <h1>Automatizar</h1>
      <p className="nota">Enciende lo que quieras que Magister haga solo. Lo revisa cada 10 minutos y pone en cola una tarea cada vez, nunca si ya hay otra en marcha.</p>

      <ul className="reglas">
        <li className="regla">
          <div>
            <strong>Preparar la próxima lección</strong>
            <p className="nota">
              Apuntes y fichas de la lección que toca en el calendario, con{' '}
              <select
                value={r.preparar_siguiente.dias_antes}
                onChange={(e) => guardar({ ...r, preparar_siguiente: { ...r.preparar_siguiente, dias_antes: Number(e.target.value) } })}
              >
                {[1, 2, 3, 7].map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? '1 día' : `${d} días`}
                  </option>
                ))}
              </select>{' '}
              de antelación.
            </p>
          </div>
          <Interruptor etiqueta="Preparar la próxima lección" activo={r.preparar_siguiente.activa} alCambiar={(v) => guardar({ ...r, preparar_siguiente: { ...r.preparar_siguiente, activa: v } })} />
        </li>
        <li className="regla">
          <div>
            <strong>Diapositivas de cada lección preparada</strong>
            <p className="nota">Cuando una lección tiene apuntes y aún no tiene diapositivas, las hace.</p>
          </div>
          <Interruptor etiqueta="Diapositivas" activo={r.diapositivas_al_preparar.activa} alCambiar={(v) => guardar({ ...r, diapositivas_al_preparar: { activa: v } })} />
        </li>
        <li className="regla">
          <div>
            <strong>Vídeo de cada lección preparada</strong>
            <p className="nota">
              Cuando una lección tiene apuntes y ningún vídeo, hace uno{' '}
              <select value={r.video_al_preparar.estilo} onChange={(e) => guardar({ ...r, video_al_preparar: { ...r.video_al_preparar, estilo: e.target.value } })}>
                {ESTILOS.map(([id, n]) => (
                  <option key={id} value={id}>
                    {n.toLowerCase()}
                  </option>
                ))}
              </select>{' '}
              de{' '}
              <select value={r.video_al_preparar.minutos} onChange={(e) => guardar({ ...r, video_al_preparar: { ...r.video_al_preparar, minutos: Number(e.target.value) } })}>
                {[3, 6, 10].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
              .
            </p>
          </div>
          <Interruptor etiqueta="Vídeo" activo={r.video_al_preparar.activa} alCambiar={(v) => guardar({ ...r, video_al_preparar: { ...r.video_al_preparar, activa: v } })} />
        </li>
        <li className="regla regla-condicion">
          <div>
            <strong>Solo de noche</strong>
            <p className="nota">Todo lo de arriba, solo entre las 0:00 y las 7:00, para no gastar cuota mientras estudias. El ordenador tiene que estar encendido y Magister abierto.</p>
          </div>
          <Interruptor etiqueta="Solo de noche" activo={r.solo_de_noche} alCambiar={(v) => guardar({ ...r, solo_de_noche: v })} />
        </li>
      </ul>

      <div className="botones">
        <button className="boton" onClick={ahora}>
          Revisar ahora
        </button>
        {aviso && <span className="nota" role="status">{aviso}</span>}
      </div>

      <section className="pg-seccion">
        <h2>Lo que ha hecho</h2>
        {datos.registro.length ? (
          <ul className="registro-auto">
            {datos.registro.map((x, i) => (
              <li key={i}>
                <time>{new Date(x.momento).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                <span>{x.texto}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nota">Todavía nada. Cuando una regla ponga algo en cola, aparecerá aquí.</p>
        )}
      </section>
    </div>
  )
}
