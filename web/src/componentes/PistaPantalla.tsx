// La primera vez que entras en una pantalla, la mascota te dice para qué sirve en una frase y se ofrece a contestarte.
// Sale una vez por pantalla (se recuerda en este navegador) y se pueden apagar todas.
import { useState } from 'react'
import Mascota from '../Mascota.tsx'
import { abrirAsesor } from './Asesor.tsx'

export const PISTAS: Record<string, string> = {
  hoy: 'Aquí empieza cada día: lo que te toca repasar y la lección de hoy. Si no sabes por dónde seguir, vuelve aquí.',
  libre: 'Pregunta lo que quieras, como a un profesor. Si escribes «hazme un plan de…», te monta un plan de estudio con su calendario.',
  roadmap: 'Tu plan: las lecciones en orden, cuánto llevas y qué vídeos te propongo. Si te atrasas, «Me he atrasado» lo recoloca.',
  calendario: 'Cuándo toca cada sesión de estudio. Si un día no puedes, muévela y el resto se recoloca.',
  temas: 'Lo que estudias y de dónde sale: tus PDF, apuntes y webs. De aquí sacan los apuntes sus explicaciones y sus citas.',
  fichas: 'Los apuntes y las fichas de cada lección. «Estudiar» te lleva idea a idea; lo demás (rehacer, el PDF) es opcional.',
  foco: 'Una lección idea a idea, sin distracciones. Cuando acabes una, te pregunta para ver si se ha quedado.',
  video: 'Vídeos que te explican una lección antes de estudiarla. Si no sabes cuál, el roadmap te propone los de las lecciones más duras.',
  repaso: 'Las preguntas que te tocan hoy para no olvidar. Las que sabes vuelven más tarde; las que fallas, antes.',
  examen: 'Simulacros con tiempo y corrección al momento, como el examen de verdad.',
  progreso: 'Qué dominas y qué no, concepto a concepto. Lo flojo es lo que más te conviene repasar.',
  proyectos: 'Aprende construyendo algo: un proyecto por niveles, con cada paso explicado.',
  notas: 'Tus notas, y lo que guardas mientras lees o estudias.',
}

const VISTAS = 'magister-pistas-vistas'
const APAGADAS = 'magister-pistas-apagadas'

function leerVistas(): string[] {
  try {
    if (localStorage.getItem(APAGADAS) === '1') return Object.keys(PISTAS)
    return JSON.parse(localStorage.getItem(VISTAS) ?? '[]') as string[]
  } catch {
    return Object.keys(PISTAS) // sin almacenamiento, mejor no insistir en cada visita
  }
}

function guardar(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor)
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}

export default function PistaPantalla({ modo }: { modo: string }) {
  const [vistas, setVistas] = useState(leerVistas)
  const texto = PISTAS[modo]
  if (!texto || vistas.includes(modo)) return null
  const cerrar = () => {
    const nuevas = [...vistas, modo]
    setVistas(nuevas)
    guardar(VISTAS, JSON.stringify(nuevas))
  }
  return (
    <aside className="pista-pantalla" role="note" aria-label="Para qué sirve esta pantalla">
      <span className="pista-mascota" aria-hidden>
        <Mascota mini quieta />
      </span>
      <p>{texto}</p>
      <div className="pista-botones">
        <button type="button" className="boton-mini" onClick={() => (cerrar(), abrirAsesor())}>
          Pregúntame
        </button>
        <button type="button" className="boton-mini" onClick={cerrar}>
          Entendido
        </button>
        <button
          type="button"
          className="pista-apagar"
          onClick={() => {
            guardar(APAGADAS, '1')
            setVistas(Object.keys(PISTAS))
          }}
        >
          No más pistas
        </button>
      </div>
    </aside>
  )
}
