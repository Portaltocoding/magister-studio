import Vacio from './componentes/Vacio.tsx'
import Pensando from './componentes/Pensando.tsx'
import EstudioLibre from './EstudioLibre.tsx'
import type { IdModo } from './modos.ts'
import PanelCalendario from './paneles/PanelCalendario.tsx'
import PanelEtiquetar from './paneles/PanelEtiquetar.tsx'
import PanelMaterial from './paneles/PanelMaterial.tsx'
import PanelPractica from './paneles/PanelPractica.tsx'
import PanelProgreso from './paneles/PanelProgreso.tsx'
import PanelTriaje from './paneles/PanelTriaje.tsx'
import PanelTutor from './paneles/PanelTutor.tsx'
import PanelFuentes from './paneles/PanelFuentes.tsx'
import PanelPlan from './paneles/PanelPlan.tsx'
import PanelExamen from './paneles/PanelExamen.tsx'

interface Props {
  modo: IdModo
  conversacionId: number | null
  tipoConversacion: 'libre' | 'plan'
  alNuevoPlan: () => void
  alCrearConversacion: (id: number) => void
  alCambiarConversaciones: () => void
  irA: (modo: IdModo) => void
}

// Recibe el modo como dato; no sabe nada de la barra lateral.
export default function Central({
  modo,
  conversacionId,
  tipoConversacion,
  alNuevoPlan,
  alCrearConversacion,
  alCambiarConversaciones,
  irA,
}: Props) {
  switch (modo) {
    case 'libre':
      return (
        <EstudioLibre
          key={tipoConversacion}
          conversacionId={conversacionId}
          tipo={tipoConversacion}
          alCrear={alCrearConversacion}
          alCambiar={alCambiarConversaciones}
        />
      )
    case 'tutor':
      return <PanelTutor irA={irA} />
    case 'roadmap':
      return <PanelPlan alNuevoPlan={alNuevoPlan} />
    case 'calendario':
      return <PanelCalendario />
    case 'temas':
      return <PanelFuentes />
    case 'proyectos':
      return <Pendiente texto="El camino que sale de lo que construyes y su diario de decisiones." />
    case 'fichas':
      return <PanelMaterial key="fichas" vista="fichas" />
    case 'video':
      return <PanelMaterial key="video" vista="video" />
    case 'repaso':
      return <PanelPractica irA={irA} />
    case 'examen':
      return <PanelExamen irA={irA} />
    case 'progreso':
      return <PanelProgreso irA={irA} />
    case 'triaje':
      return <PanelTriaje />
    case 'etiquetar':
      return <PanelEtiquetar />
    case 'animaciones':
      return (
        <div className="panel">
          <h1>Animaciones de espera</h1>
          <p className="nota">Salen al azar mientras el tutor piensa o genera.</p>
          <div className="galeria-animaciones">
            {(['rubik', 'hanoi', 'ordenar', 'vida', 'lissajous'] as const).map((v) => (
              <figure key={v}>
                <Pensando variante={v} />
                <figcaption>{{ rubik: 'Cubo de Rubik', hanoi: 'Torre de Hanói', ordenar: 'Ordenación', vida: 'Juego de la vida', lissajous: 'Lissajous' }[v]}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )
    case 'construccion':
      return <Pendiente texto="El método de este libro aplicado a otro tema." />
    case 'hablar':
      return <Pendiente texto="Entrada por voz con la frase central." />
  }
}

function Pendiente({ texto }: { texto: string }) {
  return (
    <div className="panel">
      <Vacio etiqueta="Próximamente" titulo="Esta parte aún no está hecha" texto={texto} />
    </div>
  )
}
