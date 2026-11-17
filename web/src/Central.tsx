import Vacio from './componentes/Vacio.tsx'
import Pensando from './componentes/Pensando.tsx'
import EstudioLibre from './EstudioLibre.tsx'
import { familiaDe, type IdModo } from './modos.ts'
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
import PanelVideo from './paneles/PanelVideo.tsx'
import PanelHablar from './paneles/PanelHablar.tsx'
import PanelAutomatizar from './paneles/PanelAutomatizar.tsx'
import PanelLlamada from './paneles/PanelLlamada.tsx'
import PanelGuia from './paneles/PanelGuia.tsx'

interface Props {
  modo: IdModo
  conversacionId: number | null
  tipoConversacion: 'libre' | 'plan'
  alNuevoPlan: () => void
  alCrearConversacion: (id: number) => void
  alCambiarConversaciones: () => void
  irA: (modo: IdModo) => void
}

// Las pestañas de la entrada en la que estás (Practicar: Repaso y Examen…).
function Pestanas({ modo, irA }: { modo: IdModo; irA: (m: IdModo) => void }) {
  const familia = familiaDe(modo)
  if (!familia) return null
  return (
    <nav className="pestanas-modo" role="tablist" aria-label="Secciones">
      {familia.map(([id, texto]) => (
        <button key={id} type="button" role="tab" aria-selected={id === modo} className={id === modo ? 'actual' : ''} onClick={() => irA(id)}>
          {texto}
        </button>
      ))}
    </nav>
  )
}

export default function Central(props: Props) {
  return (
    <>
      <Pestanas modo={props.modo} irA={props.irA} />
      <Panel {...props} />
    </>
  )
}

// Recibe el modo como dato; no sabe nada de la barra lateral.
function Panel({
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
      return <PanelGuia irA={irA} />
    case 'hoy':
      return <PanelTutor key="hoy" irA={irA} />
    case 'foco':
      return <PanelTutor key="foco" irA={irA} vista="foco" />
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
      return <PanelVideo />
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
            {(['rubik', 'hanoi', 'ordenar', 'fourier', 'lissajous'] as const).map((v) => (
              <figure key={v}>
                <Pensando variante={v} />
                <figcaption>{{ rubik: 'Cubo de Rubik', hanoi: 'Torre de Hanói', ordenar: 'Ordenación', fourier: 'Fourier', lissajous: 'Lissajous' }[v]}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )
    case 'construccion':
      return <Pendiente texto="El método de este libro aplicado a otro tema." />
    case 'llamada':
      return <PanelLlamada alCambiar={alCambiarConversaciones} />
    case 'automatizar':
      return <PanelAutomatizar />
    case 'hablar':
      return <PanelHablar alCambiar={alCambiarConversaciones} />
  }
}

function Pendiente({ texto }: { texto: string }) {
  return (
    <div className="panel">
      <Vacio etiqueta="Próximamente" titulo="Esta parte aún no está hecha" texto={texto} />
    </div>
  )
}
