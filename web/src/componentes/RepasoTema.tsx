import { useEffect, useState } from 'react'
import { enviarJson, pedir } from '../api.ts'
import MarcoFoco from './MarcoFoco.tsx'
import { irARuta } from './Vacio.tsx'
import Volcado from './Volcado.tsx'
import { tituloSencillo, usarIndice } from './indice.tsx'

// Repaso del tema: cada repaso de una lección empieza intentando recordarla entera, como te vas a examinar.
// Luego estudias solo lo flojo. Toca a los 2, 5, 7, 14, 21 y 30 días.

export interface TemaARepasar {
  plan_id: number
  clave: string
  titulo: string
  toca: string
  vencido: boolean
  hechos: number
  ultima_nota: number | null
  material_id: number
}

const ESTILOS: [string, string, string][] = [
  ['oral', 'Oral o entrevista', 'Lo cuentas en voz alta y el tutor te pregunta'],
  ['desarrollo', 'Desarrollo', 'Escribes o dictas el tema entero'],
  ['test', 'Tipo test', 'Empiezas por un test de la lección'],
  ['cortas', 'Preguntas cortas', 'Empiezas por las fichas'],
  ['sin_examen', 'Sin examen', 'Solo quieres entenderlo y recordarlo'],
]

const fecha = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

export default function RepasoTema({ alPracticar, alExaminar }: { alPracticar: () => void; alExaminar: () => void }) {
  const [temas, setTemas] = useState<TemaARepasar[] | null>(null)
  const [estilo, setEstilo] = useState<string | null>(null)
  const [volcando, setVolcando] = useState<TemaARepasar | null>(null)
  const indice = usarIndice(temas?.[0]?.plan_id)

  const cargar = () => pedir<TemaARepasar[]>('/api/estudio/repasos-de-tema').then(setTemas).catch(() => setTemas([]))
  useEffect(() => {
    cargar()
  }, [])
  useEffect(() => {
    if (temas?.[0]) pedir<{ estilo: string }>(`/api/planes/${temas[0].plan_id}/estilo-examen`).then((r) => setEstilo(r.estilo))
  }, [temas])

  if (!temas?.length) return null
  const planId = temas[0].plan_id

  const empezar = (t: TemaARepasar) => {
    if (estilo === 'oral') irARuta(`#/llamada/oral/${t.clave}`)
    else if (estilo === 'test') alExaminar()
    else if (estilo === 'cortas') alPracticar()
    else setVolcando(t)
  }

  if (volcando)
    return (
      <MarcoFoco titulo={`Repaso del tema · ${volcando.clave}`} placa="RT" alSalir={() => setVolcando(null)}>
        <Volcado
          planId={volcando.plan_id}
          clave={volcando.clave}
          titulo={volcando.titulo}
          alEstudiar={() => irARuta(`#/foco/${volcando.material_id}`)}
          alCerrar={() => {
            setVolcando(null)
            cargar()
          }}
        />
      </MarcoFoco>
    )

  return (
    <section className="repaso-tema">
      <h2>Repaso del tema</h2>
      <p className="nota">
        Empieza recordando la lección entera, como te vas a examinar; luego estudia solo lo flojo. Tus errores marcan el camino.
      </p>
      <div className="repaso-tema-estilo" role="radiogroup" aria-label="Cómo te examinas">
        <span className="nota">Cómo te examinas:</span>
        {ESTILOS.map(([id, nombre, desc]) => (
          <button
            key={id}
            role="radio"
            aria-checked={estilo === id}
            className={`opcion opcion-chip ${estilo === id ? 'elegida' : ''}`}
            title={desc}
            onClick={async () => setEstilo((await pedir<{ estilo: string }>(`/api/planes/${planId}/estilo-examen`, enviarJson({ estilo: id }, 'PUT'))).estilo)}
          >
            {nombre}
          </button>
        ))}
      </div>
      <ul className="repaso-tema-lista">
        {temas.map((t) => (
          <li key={t.clave} className={t.vencido ? 'vencido' : ''}>
            <span className="bloques-clave">{t.clave}</span>
            <span className="repaso-tema-titulo">
              {tituloSencillo(indice, t.clave, t.titulo)}
              <small>
                {t.vencido ? 'Toca hoy' : `Toca el ${fecha(t.toca)}`}
                {t.ultima_nota != null ? ` · última vez: ${String(t.ultima_nota).replace('.', ',')}` : ' · aún sin repasar entera'}
              </small>
            </span>
            <button className={`boton ${t.vencido ? 'boton-principal' : ''}`} onClick={() => empezar(t)}>
              Recordarla entera
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
