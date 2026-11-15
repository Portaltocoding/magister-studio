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
      return <PanelPractica />
    case 'progreso':
      return <PanelProgreso />
    case 'triaje':
      return <PanelTriaje />
    case 'etiquetar':
      return <PanelEtiquetar />
    case 'construccion':
      return <Pendiente texto="El método de este libro aplicado a otro tema." />
    case 'hablar':
      return <Pendiente texto="Entrada por voz con la frase central." />
  }
}

function Pendiente({ texto }: { texto: string }) {
  return <p className="vacio">Próximamente: {texto}</p>
}
