import { lazy, Suspense } from 'react'
import Vacio from './componentes/Vacio.tsx'
import Pensando from './componentes/Pensando.tsx'
import FalloPantalla from './componentes/FalloPantalla.tsx'
import EstudioLibre from './EstudioLibre.tsx'
import { familiaDe, type IdModo } from './modos.ts'
import PanelPractica from './paneles/PanelPractica.tsx'
import PanelTutor from './paneles/PanelTutor.tsx'
import PanelGuia from './paneles/PanelGuia.tsx'

// Las pantallas menos usadas se cargan al abrirlas (Hoy, Tutor, Repaso y Estudio libre van con la app).
const PanelCalendario = lazy(() => import('./paneles/PanelCalendario.tsx'))
const PanelEtiquetar = lazy(() => import('./paneles/PanelEtiquetar.tsx'))
const PanelMaterial = lazy(() => import('./paneles/PanelMaterial.tsx'))
const PanelProgreso = lazy(() => import('./paneles/PanelProgreso.tsx'))
const PanelTriaje = lazy(() => import('./paneles/PanelTriaje.tsx'))
const PanelPronunciacion = lazy(() => import('./paneles/PanelPronunciacion.tsx'))
const PanelFuentes = lazy(() => import('./paneles/PanelFuentes.tsx'))
const PanelPlan = lazy(() => import('./paneles/PanelPlan.tsx'))
const PanelExamen = lazy(() => import('./paneles/PanelExamen.tsx'))
const PanelVideo = lazy(() => import('./paneles/PanelVideo.tsx'))
const PanelHablar = lazy(() => import('./paneles/PanelHablar.tsx'))
const PanelAutomatizar = lazy(() => import('./paneles/PanelAutomatizar.tsx'))
const PanelLlamada = lazy(() => import('./paneles/PanelLlamada.tsx'))
const PanelBiblioteca = lazy(() => import('./paneles/PanelBiblioteca.tsx'))
const PanelNotas = lazy(() => import('./paneles/PanelNotas.tsx'))
const PanelProyectos = lazy(() => import('./paneles/PanelProyectos.tsx'))
const PanelAjustes = lazy(() => import('./paneles/PanelAjustes.tsx'))

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
  // Una entrada con una sola sección (Proyectos) no necesita conmutador.
  if (!familia || familia.length < 2) return null
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
      {/* La clave hace que cada pantalla nueva entre con su fundido (animo.css). */}
      <div key={props.modo} className="pantalla">
        <FalloPantalla>
          {/* Las pantallas menos usadas se cargan al abrirlas: la app arranca con menos código. */}
          <Suspense fallback={<p className="vacio">Cargando…</p>}>
            <Panel {...props} />
          </Suspense>
        </FalloPantalla>
      </div>
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
    case 'notas':
      return <PanelNotas />
    case 'buscar':
      return <PanelBiblioteca key="buscar" vista="buscar" />
    case 'web':
      return <PanelBiblioteca key="web" vista="web" />
    case 'proyectos':
      return <PanelProyectos />
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
    case 'pronunciacion':
      return <PanelPronunciacion />
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
    case 'ajustes':
      return <PanelAjustes />
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
